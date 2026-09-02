/**
 * Application entry point: owns the simulation worker, the audio pipeline and
 * the render loop, and maps input onto the worker's control state.
 */
import * as units from './core/units';
import { clamp } from './core/utilities';
import { ENGINES, DEFAULT_ENGINE_ID } from './engines';
import { EngineAudio, loadImpulseResponse } from './audio/engineAudio';
import { EngineRenderer, DEFAULT_THEME } from './ui/renderer';
import { GaugeCluster } from './ui/gauges';
import { InputController, type Modifier } from './ui/input';
import { S, defaultControlState } from './worker/protocol';
import type { ControlState, EngineInfo, MainToWorker, WorkerToMain } from './worker/protocol';

/** Served from the public directory; the same response the original loads. */
const IMPULSE_RESPONSE_URL = new URL('./ir/smooth_39.wav', document.baseURI).href;

const QUALITY_PRESETS: Record<string, { frequencyScale: number; fluidSteps: number }> = {
  high: { frequencyScale: 1.0, fluidSteps: 8 },
  medium: { frequencyScale: 0.75, fluidSteps: 4 },
  low: { frequencyScale: 0.5, fluidSteps: 2 },
};

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T;
}

class App {
  private worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), {
    type: 'module',
  });

  private audio = new EngineAudio();
  private renderer: EngineRenderer;
  private gauges: GaugeCluster;
  private input: InputController;

  private info: EngineInfo | null = null;
  private control: ControlState = defaultControlState();
  private latestState: Float32Array | null = null;

  private started = false;
  private paused = false;
  private dynoSpeedRpm = 0;
  private bannerTimer = 0;
  private lastUpdate = performance.now();

  private impulseResponse: Int16Array | null = null;

  private readonly engineCanvas = element<HTMLCanvasElement>('engine-canvas');
  private readonly gaugeCanvas = element<HTMLCanvasElement>('gauge-canvas');
  private readonly banner = element<HTMLDivElement>('status-banner');
  private readonly help = element<HTMLDivElement>('help');

  constructor() {
    this.renderer = new EngineRenderer(this.engineCanvas, DEFAULT_THEME);
    this.gauges = new GaugeCluster(this.gaugeCanvas, DEFAULT_THEME);

    this.input = new InputController(document.body, {
      onToggleIgnition: () => {
        this.send({ ignition: !this.control.ignition });
        this.showBanner(this.control.ignition ? 'Ignition off' : 'Ignition on');
      },
      onToggleDyno: () => {
        this.send({ dynoEnabled: !this.control.dynoEnabled });
        this.showBanner(this.control.dynoEnabled ? 'Dyno off' : 'Dyno on');
      },
      onToggleHold: () => {
        const hold = !this.control.dynoHold;
        this.send({ dynoHold: hold });
        this.showBanner(
          hold
            ? this.control.dynoEnabled
              ? 'RPM hold on'
              : 'RPM hold standby — enable the dyno'
            : 'RPM hold off',
        );
      },
      onGearUp: () => this.changeGear(this.control.gear + 1),
      onGearDown: () => this.changeGear(this.control.gear - 1),
      onLayerUp: () => {
        this.renderer.layer = Math.min(this.renderer.getMaxLayer(), this.renderer.layer + 1);
        this.showBanner(`View layer ${this.renderer.layer}`);
      },
      onLayerDown: () => {
        this.renderer.layer = Math.max(-1, this.renderer.layer - 1);
        this.showBanner(
          this.renderer.layer === -1 ? 'View: all layers' : `View layer ${this.renderer.layer}`,
        );
      },
      onTimeWarp: (factor) => {
        this.send({ simulationSpeed: factor });
        this.showBanner(factor === 1 ? 'Real time' : `Time warp 1 / ${Math.round(1 / factor)}`);
      },
      onScroll: (modifier, delta) => this.handleScroll(modifier, delta),
      onToggleFullscreen: () => {
        if (document.fullscreenElement === null) void document.documentElement.requestFullscreen();
        else void document.exitFullscreen();
      },
      onTogglePause: () => {
        this.paused = !this.paused;
        this.post({ type: 'pause', paused: this.paused });
        this.audio.setMuted(this.paused || !this.started);
        this.showBanner(this.paused ? 'Paused' : 'Resumed');
      },
      onToggleHelp: () => this.toggleHelp(),
    });

    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => this.onWorkerMessage(event.data);

    this.audio.onStatus = (buffered) => {
      this.post({ type: 'audioStatus', bufferedSamples: buffered });
    };

    this.bindUi();
    this.loop();

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.gauges.resize();
    });

    document.addEventListener('visibilitychange', () => {
      // Timers are throttled in background tabs; muting avoids a burst of stale
      // audio when the tab comes back.
      this.audio.setMuted(document.hidden || this.paused || !this.started);
    });
  }

  private post(message: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private send(update: Partial<ControlState>): void {
    this.control = { ...this.control, ...update };
    this.post({ type: 'control', control: update });
  }

  private bindUi(): void {
    const engineSelect = element<HTMLSelectElement>('engine-select');
    for (const definition of ENGINES) {
      const option = document.createElement('option');
      option.value = definition.id;
      option.textContent = definition.label;
      engineSelect.append(option);
    }
    engineSelect.value = DEFAULT_ENGINE_ID;
    engineSelect.addEventListener('change', () => {
      this.audio.reset();
      this.post({
        type: 'load',
        engineId: engineSelect.value,
        audioSampleRate: this.audio.sampleRate,
      });
    });

    const qualitySelect = element<HTMLSelectElement>('quality-select');
    qualitySelect.addEventListener('change', () => {
      if (qualitySelect.value === 'auto') {
        this.post({ type: 'autoQuality', enabled: true });
        this.showBanner('Quality: auto');
        return;
      }

      const preset = QUALITY_PRESETS[qualitySelect.value];
      const nominal = this.info?.simulationFrequency ?? 10000;
      this.post({
        type: 'setQuality',
        simulationFrequency: Math.round(nominal * preset.frequencyScale),
        fluidSimulationSteps: preset.fluidSteps,
      });
      this.showBanner(`Quality: ${qualitySelect.value}`);
    });

    const volume = element<HTMLInputElement>('volume');
    volume.addEventListener('input', () => {
      this.audio.setVolume(Number(volume.value));
    });
    this.audio.setVolume(Number(volume.value));

    const throttle = element<HTMLInputElement>('throttle');
    throttle.addEventListener('input', () => {
      this.input.adjustSpeedSetting(Number(throttle.value) - this.input.getTargetSpeedSetting());
    });

    element('start-button').addEventListener('click', () => void this.start());
    element('help-button').addEventListener('click', () => this.toggleHelp());
    element('help-close').addEventListener('click', () => this.toggleHelp(false));

    element('toggle-ignition').addEventListener('click', () =>
      this.send({ ignition: !this.control.ignition }),
    );
    element('toggle-dyno').addEventListener('click', () =>
      this.send({ dynoEnabled: !this.control.dynoEnabled }),
    );
    element('toggle-hold').addEventListener('click', () =>
      this.send({ dynoHold: !this.control.dynoHold }),
    );

    const starterButton = element('toggle-starter');
    const startCranking = () => this.send({ starter: true });
    const stopCranking = () => this.send({ starter: false });
    starterButton.addEventListener('pointerdown', startCranking);
    starterButton.addEventListener('pointerup', stopCranking);
    starterButton.addEventListener('pointerleave', stopCranking);
  }

  private async start(): Promise<void> {
    element('start-overlay').setAttribute('hidden', '');
    this.started = true;

    await this.audio.start();

    if (this.impulseResponse === null) {
      try {
        this.impulseResponse = await loadImpulseResponse(IMPULSE_RESPONSE_URL);
      } catch {
        // The engine still runs without reverb; just note it and carry on.
        this.showBanner('Impulse response unavailable — running dry');
      }
    }

    const select = element<HTMLSelectElement>('engine-select');
    this.post({
      type: 'load',
      engineId: select.value,
      audioSampleRate: this.audio.sampleRate,
    });

    if (this.impulseResponse !== null) {
      this.post({ type: 'impulseResponse', samples: this.impulseResponse });
    }
  }

  private onWorkerMessage(message: WorkerToMain): void {
    switch (message.type) {
      case 'loaded': {
        this.info = message.info;
        this.renderer.setEngine(message.info);
        this.gauges.setEngine(message.info);
        this.renderer.resize();
        this.gauges.resize();

        element('engine-name').textContent = message.info.name;
        element('r-displacement').textContent = `${(message.info.displacement / units.L).toFixed(
          2,
        )} L`;

        this.control = {
          ...defaultControlState(),
          simulationFrequency: message.info.simulationFrequency,
        };
        this.dynoSpeedRpm = units.toRpm(message.info.dynoMinSpeed);

        if (this.impulseResponse !== null) {
          this.post({ type: 'impulseResponse', samples: this.impulseResponse });
        }
        break;
      }

      case 'frame':
        this.latestState = message.state;
        if (message.audio.length > 0 && this.started && !this.paused) {
          this.audio.push(message.audio);
        }
        break;

      case 'error':
        this.showBanner(`Simulation error: ${message.message}`, 6000);
        break;
    }
  }

  private handleScroll(modifier: Modifier | null, delta: number): void {
    const step = delta > 0 ? 1 : -1;

    switch (modifier) {
      case 'z': {
        const volume = element<HTMLInputElement>('volume');
        volume.value = String(clamp(Number(volume.value) + step * 0.05, 0, 1.5));
        this.audio.setVolume(Number(volume.value));
        this.showBanner(`Volume ${(Number(volume.value) * 100).toFixed(0)}%`);
        break;
      }
      case 'x': {
        const value = clamp(this.control.convolution + step * 0.05);
        this.send({ convolution: value });
        this.showBanner(`Convolution ${(value * 100).toFixed(0)}%`);
        break;
      }
      case 'c': {
        const value = clamp(this.control.highFrequencyGain + step * 0.002, 0, 1);
        this.send({ highFrequencyGain: value });
        this.showBanner(`HF gain ${value.toFixed(3)}`);
        break;
      }
      case 'v': {
        const value = clamp(this.control.lowFrequencyNoise + step * 0.05);
        this.send({ lowFrequencyNoise: value });
        this.showBanner(`LF noise ${value.toFixed(2)}`);
        break;
      }
      case 'b': {
        const value = clamp(this.control.highFrequencyNoise + step * 0.05);
        this.send({ highFrequencyNoise: value });
        this.showBanner(`HF noise ${value.toFixed(2)}`);
        break;
      }
      case 'n': {
        const value = clamp(this.control.simulationFrequency + step * 1000, 2000, 60000);
        this.post({
          type: 'setQuality',
          simulationFrequency: value,
          fluidSimulationSteps: this.control.fluidSimulationSteps,
        });
        this.control = { ...this.control, simulationFrequency: value };
        element<HTMLSelectElement>('quality-select').value = 'high';
        this.showBanner(`Simulation ${(value / 1000).toFixed(0)} kHz`);
        break;
      }
      case 'g': {
        if (this.info === null) break;
        const stepRpm = units.toRpm(this.info.dynoHoldStep);
        this.dynoSpeedRpm = clamp(
          this.dynoSpeedRpm + step * stepRpm,
          units.toRpm(this.info.dynoMinSpeed),
          units.toRpm(this.info.dynoMaxSpeed),
        );
        this.showBanner(`Hold speed ${this.dynoSpeedRpm.toFixed(0)} rpm`);
        break;
      }
      case ' ':
        this.input.adjustSpeedSetting(step * 0.01);
        this.showBanner(`Throttle ${(this.input.getTargetSpeedSetting() * 100).toFixed(0)}%`);
        break;
      default:
        break;
    }
  }

  private changeGear(gear: number): void {
    if (this.info === null) return;

    const next = clamp(gear, -1, this.info.gearCount - 1);
    if (next === this.control.gear) return;

    this.send({ gear: next });
    this.showBanner(next === -1 ? 'Neutral' : `Gear ${next + 1}`);
  }

  private showBanner(text: string, duration = 1600): void {
    this.banner.textContent = text;
    this.banner.hidden = false;
    this.bannerTimer = performance.now() + duration;
  }

  private toggleHelp(force?: boolean): void {
    const show = force ?? this.help.hasAttribute('hidden');
    if (show) this.help.removeAttribute('hidden');
    else this.help.setAttribute('hidden', '');
  }

  /**
   * Advance the dyno ramp exactly as the original does: with hold off, the dyno
   * winds up while the engine is making torque and winds down when it is not,
   * cutting out at the redline.
   */
  private updateDyno(dt: number, state: Float32Array | null): void {
    if (this.info === null || state === null) return;

    if (this.control.dynoEnabled) {
      if (!this.control.dynoHold) {
        if (state[S.DynoTorque] > units.torque(1.0, units.ft_lb)) {
          this.dynoSpeedRpm += units.toRpm(units.rpm(500)) * dt;
        } else {
          this.dynoSpeedRpm *= 1 / (1 + dt);
        }

        if (units.rpm(this.dynoSpeedRpm) > this.info.redline) {
          this.send({ dynoEnabled: false });
          this.dynoSpeedRpm = 0;
        }
      }
    } else if (!this.control.dynoHold) {
      this.dynoSpeedRpm = 0;
    }

    this.dynoSpeedRpm = clamp(
      this.dynoSpeedRpm,
      units.toRpm(this.info.dynoMinSpeed),
      units.toRpm(this.info.dynoMaxSpeed),
    );
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;

    const analog = this.input.update(dt);
    this.updateDyno(dt, this.latestState);

    if (this.started) {
      const starter = this.input.starterHeld;
      const update: Partial<ControlState> = {
        speedControl: analog.speedControl,
        clutchPressure: analog.clutchPressure,
        dynoSpeed: units.rpm(this.dynoSpeedRpm),
      };

      if (starter !== this.control.starter) update.starter = starter;

      this.send(update);
    }

    if (this.latestState !== null) {
      this.renderer.render(this.latestState);
      this.gauges.render(this.latestState);
      this.updateReadouts(this.latestState);
    }

    if (this.bannerTimer !== 0 && now > this.bannerTimer) {
      this.banner.hidden = true;
      this.bannerTimer = 0;
    }

    requestAnimationFrame(this.loop);
  };

  private updateReadouts(state: Float32Array): void {
    const set = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el !== null && el.textContent !== text) el.textContent = text;
    };

    const gear = state[S.Gear];

    set('r-rpm', state[S.Rpm].toFixed(0));
    set('r-throttle', `${(state[S.Throttle] * 100).toFixed(0)}%`);
    // The original reports manifold vacuum relative to ambient, in inHg.
    const vacuum = Math.min(state[S.ManifoldPressure] - units.pressure(1.0, units.atm), 0);
    set('r-manifold', `${(vacuum / units.inHg).toFixed(1)} inHg`);
    set('r-afr', state[S.IntakeAfr].toFixed(1));
    set('r-gear', gear < 0 ? 'N' : String(gear + 1));
    set('r-clutch', `${(state[S.ClutchPressure] * 100).toFixed(0)}%`);
    set('r-speed', `${(state[S.VehicleSpeed] / units.mph).toFixed(0)} mph`);

    set('d-frequency', `${(state[S.SimulationFrequency] / 1000).toFixed(1)} kHz`);
    set('d-fluid', state[S.FluidSteps].toFixed(0));
    set('d-load', `${(state[S.FrameLoad] * 100).toFixed(0)}%`);
    set('d-latency', `${(state[S.AudioLatency] * 1000).toFixed(0)} ms`);
    set('d-steps', state[S.StepsThisFrame].toFixed(0));

    const warp = state[S.SimulationSpeed];
    set('d-warp', warp >= 1 ? '1x' : `1/${Math.round(1 / warp)}x`);

    const toggle = (id: string, active: boolean) => {
      const el = document.getElementById(id);
      if (el !== null) el.dataset.active = String(active);
    };

    toggle('toggle-ignition', state[S.IgnitionEnabled] > 0.5);
    toggle('toggle-starter', state[S.StarterEnabled] > 0.5);
    toggle('toggle-dyno', state[S.DynoEnabled] > 0.5);
    toggle('toggle-hold', state[S.DynoHold] > 0.5);

    const throttleSlider = element<HTMLInputElement>('throttle');
    if (document.activeElement !== throttleSlider) {
      throttleSlider.value = String(this.input.getTargetSpeedSetting());
    }
  }
}

new App();
