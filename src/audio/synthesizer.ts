/**
 * Engine audio synthesizer, ported from `include/synthesizer.h` /
 * `src/synthesizer.cpp`.
 *
 * Two structural changes from the original, both forced by the browser:
 *
 * - The C++ renders on a dedicated thread that waits on a condition variable.
 *   Here the whole simulation already lives on a worker, so the render pass
 *   runs synchronously at the end of each input block. The "at most 2000 queued
 *   output samples" cap that throttled the original thread is kept, because the
 *   latency feedback loop in `Simulator` depends on it.
 *
 * - The exhaust reverb runs as block FFT convolution rather than a per-sample
 *   FIR, so the per-sample pass is split into a "dry" stage and a mixing stage
 *   with the convolution in between. Sample ordering within the dry stage is
 *   unchanged, so the noise and filter state evolve exactly as before.
 */
import {
  ButterworthLowPassFilter,
  DerivativeFilter,
  JitterFilter,
  LevelingFilter,
  LowPassFilter,
} from './filters';
import { PartitionedConvolver } from './convolver';
import { RingBuffer } from './ringBuffer';

const MAX_QUEUED_OUTPUT_SAMPLES = 2000;

export interface AudioParameters {
  volume: number;
  convolution: number;
  dF_F_mix: number;
  inputSampleNoise: number;
  inputSampleNoiseFrequencyCutoff: number;
  airNoise: number;
  airNoiseFrequencyCutoff: number;
  levelerTarget: number;
  levelerMaxGain: number;
  levelerMinGain: number;
}

export function defaultAudioParameters(): AudioParameters {
  return {
    volume: 1.0,
    convolution: 1.0,
    dF_F_mix: 0.01,
    inputSampleNoise: 0.5,
    inputSampleNoiseFrequencyCutoff: 10000.0,
    airNoise: 1.0,
    airNoiseFrequencyCutoff: 2000.0,
    levelerTarget: 30000.0,
    levelerMaxGain: 1.9,
    levelerMinGain: 0.00001,
  };
}

export interface SynthesizerParameters {
  inputChannelCount: number;
  inputBufferSize: number;
  audioBufferSize: number;
  inputSampleRate: number;
  audioSampleRate: number;
  initialAudioParameters?: AudioParameters;
}

interface InputChannel {
  data: RingBuffer<Float32Array>;
  transferBuffer: Float32Array;
  dry: Float32Array;
  wet: Float32Array;
  lastInputSample: number;
}

interface ProcessingFilters {
  convolution: PartitionedConvolver;
  derivative: DerivativeFilter;
  jitterFilter: JitterFilter;
  airNoiseLowPass: ButterworthLowPassFilter;
  inputDcFilter: LowPassFilter;
  antialiasing: ButterworthLowPassFilter;
}

export class Synthesizer {
  audioParameters: AudioParameters = defaultAudioParameters();

  private antialiasing = new ButterworthLowPassFilter();
  private levelingFilter = new LevelingFilter();

  private inputChannels: InputChannel[] = [];
  private filters: ProcessingFilters[] = [];

  private inputChannelCount = 0;
  private inputBufferSize = 0;
  private latency = 0;
  private inputWriteOffset = 0;
  private lastInputSampleOffset = 0;

  private audioBuffer = new RingBuffer<Int16Array>((n) => new Int16Array(n));

  private inputSampleRate = 0;
  private audioSampleRate = 44100;

  initialize(p: SynthesizerParameters): void {
    this.inputChannelCount = p.inputChannelCount;
    this.inputBufferSize = p.inputBufferSize;
    this.inputSampleRate = p.inputSampleRate;
    this.audioSampleRate = p.audioSampleRate;
    this.audioParameters = p.initialAudioParameters ?? defaultAudioParameters();

    this.inputWriteOffset = 0;
    this.lastInputSampleOffset = 0;
    this.latency = 0;

    this.audioBuffer.initialize(p.audioBufferSize);

    this.inputChannels = [];
    this.filters = [];

    for (let i = 0; i < p.inputChannelCount; ++i) {
      const data = new RingBuffer<Float32Array>((n) => new Float32Array(n));
      data.initialize(p.inputBufferSize);
      this.inputChannels.push({
        data,
        transferBuffer: new Float32Array(p.inputBufferSize),
        dry: new Float32Array(MAX_QUEUED_OUTPUT_SAMPLES),
        wet: new Float32Array(MAX_QUEUED_OUTPUT_SAMPLES),
        lastInputSample: 0,
      });

      const f: ProcessingFilters = {
        convolution: new PartitionedConvolver(),
        derivative: new DerivativeFilter(),
        jitterFilter: new JitterFilter(),
        airNoiseLowPass: new ButterworthLowPassFilter(),
        inputDcFilter: new LowPassFilter(),
        antialiasing: new ButterworthLowPassFilter(),
      };

      f.airNoiseLowPass.setCutoffFrequency(
        this.audioParameters.airNoiseFrequencyCutoff,
        this.audioSampleRate,
      );
      f.derivative.dt = 1 / this.audioSampleRate;
      f.inputDcFilter.setCutoffFrequency(10.0);
      f.inputDcFilter.dt = 1 / this.audioSampleRate;
      f.jitterFilter.initialize(
        10,
        this.audioParameters.inputSampleNoiseFrequencyCutoff,
        this.audioSampleRate,
      );
      f.antialiasing.setCutoffFrequency(1900.0, this.audioSampleRate);

      this.filters.push(f);
    }

    this.levelingFilter.p_target = this.audioParameters.levelerTarget;
    this.levelingFilter.p_maxLevel = this.audioParameters.levelerMaxGain;
    this.levelingFilter.p_minLevel = this.audioParameters.levelerMinGain;
    this.antialiasing.setCutoffFrequency(this.audioSampleRate * 0.45, this.audioSampleRate);
  }

  getChannelCount(): number {
    return this.inputChannelCount;
  }

  /**
   * Load a recorded impulse response for one exhaust channel. Samples are
   * normalised 16-bit values, as in the original's .wav loader: everything
   * after the last sample above the noise floor is discarded, and the tail is
   * capped at 10 000 taps.
   */
  initializeImpulseResponse(
    impulseResponse: Int16Array,
    volume: number,
    index: number,
  ): void {
    if (index >= this.filters.length) return;

    let clippedLength = 0;
    for (let i = 0; i < impulseResponse.length; ++i) {
      if (Math.abs(impulseResponse[i]) > 100) clippedLength = i + 1;
    }

    const sampleCount = Math.min(10000, clippedLength);
    if (sampleCount === 0) return;

    const ir = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; ++i) {
      ir[i] = (volume * impulseResponse[i]) / 32767;
    }

    this.filters[index].convolution.initialize(ir);
  }

  setInputSampleRate(sampleRate: number): void {
    this.inputSampleRate = sampleRate;
  }

  getInputSampleRate(): number {
    return this.inputSampleRate;
  }

  getAudioSampleRate(): number {
    return this.audioSampleRate;
  }

  /** Input buffer occupancy expressed in seconds. */
  getLatency(): number {
    return this.latency / this.audioSampleRate;
  }

  getLevelerGain(): number {
    return this.levelingFilter.getAttenuation();
  }

  queuedOutputSamples(): number {
    return this.audioBuffer.size();
  }

  /**
   * Resample one simulation sample per channel up to the audio rate, writing
   * however many audio samples the elapsed simulation time calls for.
   */
  writeInput(data: Float64Array): void {
    this.inputWriteOffset += this.audioSampleRate / this.inputSampleRate;
    if (this.inputWriteOffset >= this.inputBufferSize) {
      this.inputWriteOffset -= this.inputBufferSize;
    }

    for (let i = 0; i < this.inputChannelCount; ++i) {
      const channel = this.inputChannels[i];
      const buffer = channel.data;
      const lastInputSample = channel.lastInputSample;
      const baseIndex = buffer.writeIndex();
      const distance = this.inputDistance(this.inputWriteOffset, this.lastInputSampleOffset);

      let s = this.inputDistance(baseIndex, this.lastInputSampleOffset);
      for (; s <= distance; s += 1.0) {
        if (s >= this.inputBufferSize) s -= this.inputBufferSize;

        const f = distance !== 0 ? s / distance : 1;
        const sample = lastInputSample * (1 - f) + data[i] * f;

        buffer.write(this.filters[i].antialiasing.f(sample));
      }

      channel.lastInputSample = data[i];
    }

    this.lastInputSampleOffset = this.inputWriteOffset;
  }

  /**
   * End of a simulation frame: render whatever input is buffered into audio
   * output, then record the remaining input latency.
   */
  endInputBlock(): void {
    if (this.inputChannelCount === 0) return;

    const available = this.inputChannels[0].data.size();
    const room = Math.max(0, MAX_QUEUED_OUTPUT_SAMPLES - this.audioBuffer.size());
    const n = Math.min(room, available);

    if (n > 0) {
      for (let i = 0; i < this.inputChannelCount; ++i) {
        this.inputChannels[i].data.readInto(n, this.inputChannels[i].transferBuffer);
      }

      for (let i = 0; i < this.inputChannelCount; ++i) {
        this.filters[i].airNoiseLowPass.setCutoffFrequency(
          this.audioParameters.airNoiseFrequencyCutoff,
          this.audioSampleRate,
        );
        this.filters[i].jitterFilter.setJitterScale(this.audioParameters.inputSampleNoise);
      }

      this.renderBlock(n);

      for (let i = 0; i < this.inputChannelCount; ++i) {
        this.inputChannels[i].data.removeBeginning(n);
      }
    }

    this.latency = this.inputChannels[0].data.size();
  }

  /** Drain up to `samples` rendered samples; returns how many were available. */
  readAudioOutput(samples: number, buffer: Int16Array): number {
    const newDataLength = this.audioBuffer.size();
    const toRead = Math.min(samples, newDataLength);

    if (toRead > 0) this.audioBuffer.readAndRemove(toRead, buffer);
    if (toRead < samples) buffer.fill(0, toRead, samples);

    return toRead;
  }

  private inputDistance(s1: number, s0: number): number {
    return s1 < s0 ? this.inputBufferSize - s0 + s1 : s1 - s0;
  }

  /**
   * Render `n` audio samples: per-sample conditioning of each exhaust channel,
   * then block convolution, then mixing, levelling and quantisation.
   */
  private renderBlock(n: number): void {
    const params = this.audioParameters;
    const airNoise = params.airNoise;
    const dF_F_mix = params.dF_F_mix;
    const convAmount = params.convolution;
    const channelCount = this.inputChannelCount;

    // Dry stage, sample-major so the shared noise filter advances exactly as
    // it does in the original.
    for (let s = 0; s < n; ++s) {
      for (let i = 0; i < channelCount; ++i) {
        const filters = this.filters[i];

        const jitteredSample = filters.jitterFilter.f(
          this.inputChannels[i].transferBuffer[s],
        );

        const f_in = jitteredSample;
        const f_dc = filters.inputDcFilter.f(f_in);
        const f = f_in - f_dc;
        const f_p = filters.derivative.f(f_in);

        const noise = 2.0 * Math.random() - 1.0;
        // The original indexes channel 0's noise filter for every channel.
        const r = this.filters[0].airNoiseLowPass.f(noise);
        const r_mixed = airNoise * r + (1 - airNoise);

        let v_in = f_p * dF_F_mix + f * r_mixed * (1 - dF_F_mix);
        if (!Number.isFinite(v_in)) v_in = 0;

        this.inputChannels[i].dry[s] = v_in;
      }
    }

    for (let i = 0; i < channelCount; ++i) {
      const channel = this.inputChannels[i];
      this.filters[i].convolution.process(channel.dry, channel.wet, n);
    }

    this.levelingFilter.p_target = params.levelerTarget;
    this.levelingFilter.p_maxLevel = params.levelerMaxGain;
    this.levelingFilter.p_minLevel = params.levelerMinGain;

    for (let s = 0; s < n; ++s) {
      let signal = 0;
      for (let i = 0; i < channelCount; ++i) {
        const channel = this.inputChannels[i];
        signal += convAmount * channel.wet[s] + (1 - convAmount) * channel.dry[s];
      }

      signal = this.antialiasing.f(signal);

      const v_leveled = this.levelingFilter.f(signal) * params.volume;
      let r_int = Math.round(v_leveled);
      if (r_int > 32767) r_int = 32767;
      else if (r_int < -32768) r_int = -32768;

      this.audioBuffer.write(r_int);
    }
  }
}
