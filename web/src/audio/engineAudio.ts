/**
 * Audio output for the page: an AudioWorklet that plays the sample stream the
 * simulation worker produces, and reports its buffer occupancy back so the
 * worker can keep the queue near its latency target.
 *
 * The processor is delivered as a Blob URL rather than a separate bundle entry
 * so it survives any bundler configuration.
 */

const PROCESSOR_SOURCE = `
class EngineAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 1 << 17;
    this.buffer = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.reportCounter = 0;
    this.starved = 0;
    this.muted = true;
    this.gain = 0;

    // Stay silent until enough audio has arrived to absorb frame-time jitter,
    // otherwise the first tenth of a second plays as crackle while the
    // simulation is still filling the queue.
    this.primed = false;
    this.preroll = Math.round(sampleRate * 0.05);
    this.last = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'samples') {
        this.push(data.samples);
      } else if (data.type === 'reset') {
        this.read = this.write = this.count = 0;
        this.starved = 0;
        this.primed = false;
        this.last = 0;
      } else if (data.type === 'mute') {
        this.muted = data.muted;
      }
    };
  }

  push(samples) {
    const n = samples.length;
    // Drop the oldest audio rather than overrun; only happens after a stall.
    if (this.count + n > this.capacity) {
      const drop = this.count + n - this.capacity;
      this.read = (this.read + drop) % this.capacity;
      this.count -= drop;
    }

    for (let i = 0; i < n; ++i) {
      this.buffer[this.write] = samples[i];
      this.write = (this.write + 1) % this.capacity;
    }
    this.count += n;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel = output[0];
    const n = channel.length;

    // Ramp gain so starting and stopping never clicks.
    const target = this.muted ? 0 : 1;

    if (!this.primed && this.count >= this.preroll) this.primed = true;

    for (let i = 0; i < n; ++i) {
      let sample = 0;

      if (!this.primed) {
        sample = 0;
      } else if (this.count > 0) {
        sample = this.buffer[this.read];
        this.read = (this.read + 1) % this.capacity;
        --this.count;
        this.last = sample;
      } else {
        // Ran dry. Decaying the last sample rather than snapping to zero keeps
        // a brief hiccup from turning into a click.
        this.last *= 0.995;
        sample = this.last;
        ++this.starved;
      }

      this.gain += (target - this.gain) * 0.001;
      channel[i] = sample * this.gain;
    }

    for (let c = 1; c < output.length; ++c) {
      output[c].set(channel);
    }

    this.reportCounter += n;
    if (this.reportCounter >= 1024) {
      this.reportCounter = 0;
      this.port.postMessage({ type: 'status', buffered: this.count, starved: this.starved });
    }

    return true;
  }
}

registerProcessor('engine-audio', EngineAudioProcessor);
`;

export class EngineAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private moduleUrl: string | null = null;

  /** Latest buffer occupancy reported by the worklet, in samples. */
  bufferedSamples = 0;

  /** Samples the worklet had to invent because its buffer ran dry. */
  starvedSamples = 0;

  onStatus: ((bufferedSamples: number) => void) | null = null;

  get sampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  get isRunning(): boolean {
    return this.context?.state === 'running';
  }

  /** Create the context. Must be called from a user gesture to start audio. */
  async start(): Promise<void> {
    if (this.context === null) {
      this.context = new AudioContext({ latencyHint: 'interactive' });

      const blob = new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' });
      this.moduleUrl = URL.createObjectURL(blob);
      await this.context.audioWorklet.addModule(this.moduleUrl);

      this.node = new AudioWorkletNode(this.context, 'engine-audio', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type: string; buffered: number; starved: number };
        if (data.type === 'status') {
          this.bufferedSamples = data.buffered;
          this.starvedSamples = data.starved;
          this.onStatus?.(data.buffered);
        }
      };

      this.gainNode = this.context.createGain();
      this.gainNode.gain.value = 1.0;

      this.node.connect(this.gainNode);
      this.gainNode.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.node?.port.postMessage({ type: 'mute', muted: false });
  }

  /** Probe the hardware sample rate without starting playback. */
  static probeSampleRate(): number {
    try {
      const context = new AudioContext();
      const rate = context.sampleRate;
      void context.close();
      return rate;
    } catch {
      return 44100;
    }
  }

  push(samples: Float32Array): void {
    if (this.node === null || samples.length === 0) return;
    this.node.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }

  setMuted(muted: boolean): void {
    this.node?.port.postMessage({ type: 'mute', muted });
  }

  setVolume(volume: number): void {
    if (this.gainNode === null || this.context === null) return;
    this.gainNode.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  reset(): void {
    this.node?.port.postMessage({ type: 'reset' });
    this.bufferedSamples = 0;
    this.starvedSamples = 0;
  }

  async suspend(): Promise<void> {
    this.setMuted(true);
    if (this.context?.state === 'running') await this.context.suspend();
  }

  dispose(): void {
    this.node?.disconnect();
    this.gainNode?.disconnect();
    void this.context?.close();
    if (this.moduleUrl !== null) URL.revokeObjectURL(this.moduleUrl);

    this.context = null;
    this.node = null;
    this.gainNode = null;
    this.moduleUrl = null;
  }
}

/**
 * Fetch and decode an impulse response .wav into 16-bit samples for the
 * synthesizer's convolution stage.
 */
export async function loadImpulseResponse(url: string): Promise<Int16Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load impulse response: ${response.status}`);

  const bytes = await response.arrayBuffer();

  const context = new OfflineAudioContext(1, 1, 44100);
  const decoded = await context.decodeAudioData(bytes);
  const channel = decoded.getChannelData(0);

  const samples = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; ++i) {
    const v = Math.max(-1, Math.min(1, channel[i]));
    samples[i] = Math.round(v * 32767);
  }

  return samples;
}
