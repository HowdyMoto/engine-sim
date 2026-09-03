/**
 * Application entry point: owns the simulation worker, the audio pipeline and
 * the render loop, and maps input onto the worker's control state.
 */
import * as units from './core/units';
import { clamp } from './core/utilities';
import { ENGINES, DEFAULT_ENGINE_ID } from './engines';
import { EngineAudio, loadImpulseResponse } from './audio/engineAudio';
import { resolveImpulseResponse } from './audio/impulseResponses';
import { EngineRenderer, DEFAULT_THEME } from './ui/renderer';
import { THEMES, getTheme, buildTheme, applyCssTheme } from './ui/themes';
import { compileCustomEngine, customEngineTemplate } from './builder/customEngine';
import { GaugeCluster } from './ui/gauges';
import { ScopeCluster } from './ui/scopes';
import { InputController, type Modifier } from './ui/input';
import { GamepadInput } from './ui/gamepad';
import { ACTIONS, BindingStore, formatDevice, formatKey } from './ui/bindings';
import type { ActionId } from './ui/bindings';
import { S, defaultControlState } from './worker/protocol';
import type { ControlState, EngineInfo, MainToWorker, WorkerToMain } from './worker/protocol';

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
  private scopes: ScopeCluster;
  private input: InputController;

  private info: EngineInfo | null = null;
  private control: ControlState = defaultControlState();
  private latestState: Float32Array | null = null;

  private started = false;
  private paused = false;
  private dynoSpeedRpm = 0;
  private bannerTimer = 0;
  private lastUpdate = performance.now();

  /** Decoded impulse responses, keyed by URL. */
  private impulseResponses = new Map<string, Int16Array>();

  private readonly engineCanvas = element<HTMLCanvasElement>('engine-canvas');
  private renderErrorReported = false;
  private bindings = new BindingStore();
  private gamepad = new GamepadInput(this.bindings);
  private pedalThrottle = 0;
  private pedalClutch = 0;
  /** Starter held via the on-screen button, tracked separately from the key. */
  private starterFromPointer = false;
  private lastFuelVolume = 0;
  private lastFuelTime = 0;
  private fuelRate = 0;
  private readonly gaugeCanvas = element<HTMLCanvasElement>('gauge-canvas');
  private readonly banner = element<HTMLDivElement>('status-banner');
  private readonly help = element<HTMLDivElement>('help');

  constructor() {
    this.renderer = new EngineRenderer(this.engineCanvas, DEFAULT_THEME);
    this.gauges = new GaugeCluster(this.gaugeCanvas, DEFAULT_THEME);
    this.scopes = new ScopeCluster(element<HTMLCanvasElement>('scope-canvas'), DEFAULT_THEME);

    this.input = new InputController(document.body, {
      onToggleIgnition: () => this.toggleIgnition(),
      onToggleDyno: () => this.toggleDyno(),
      onToggleHold: () => this.toggleHold(),
      onGearUp: () => this.changeGear(this.control.gear + 1),
      onGearDown: () => this.changeGear(this.control.gear - 1),
      onLayerUp: () => this.stepLayer(1),
      onLayerDown: () => this.stepLayer(-1),
      onTimeWarp: (factor) => {
        this.send({ simulationSpeed: factor });
        this.showBanner(factor === 1 ? 'Real time' : `Time warp 1 / ${Math.round(1 / factor)}`);
      },
      onScroll: (modifier, delta) => this.handleScroll(modifier, delta),
      onToggleFullscreen: () => {
        if (document.fullscreenElement === null) void document.documentElement.requestFullscreen();
        else void document.exitFullscreen();
      },
      onTogglePause: () => this.togglePause(),
      onToggleHelp: () => this.toggleHelp(),
    }, this.bindings);

    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => this.onWorkerMessage(event.data);

    this.audio.onStatus = (buffered) => {
      this.post({
        type: 'audioStatus',
        bufferedSamples: buffered,
        starvedSamples: this.audio.starvedSamples,
      });
    };

    this.bindUi();
    this.loop();

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.gauges.resize();
      this.scopes.resize();
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

  // One path per toggle, shared by the keyboard, the controller and the
  // on-screen buttons. The new value is computed before sending, because
  // `send` updates `control` in place and reading it back afterwards reports
  // the state just entered rather than the one being left.

  private stepLayer(delta: number): void {
    this.renderer.layer = Math.max(
      -1,
      Math.min(this.renderer.getMaxLayer(), this.renderer.layer + delta),
    );
    this.showBanner(
      this.renderer.layer === -1 ? 'View: all layers' : `View layer ${this.renderer.layer}`,
    );
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.post({ type: 'pause', paused: this.paused });
    this.audio.setMuted(this.paused || !this.started);
    this.showBanner(this.paused ? 'Paused' : 'Resumed');
  }

  private toggleIgnition(): void {
    const next = !this.control.ignition;
    this.send({ ignition: next });
    this.showBanner(next ? 'Ignition on' : 'Ignition off');
  }

  private toggleDyno(): void {
    const next = !this.control.dynoEnabled;
    this.send({ dynoEnabled: next });
    this.showBanner(next ? 'Dyno on' : 'Dyno off');
  }

  private toggleHold(): void {
    const next = !this.control.dynoHold;
    this.send({ dynoHold: next });
    this.showBanner(
      next
        ? this.control.dynoEnabled
          ? 'RPM hold on'
          : 'RPM hold standby — enable the dyno'
        : 'RPM hold off',
    );
  }

  private bindUi(): void {
    const engineSelect = element<HTMLSelectElement>('engine-select');
    for (const definition of ENGINES) {
      const option = document.createElement('option');
      option.value = definition.id;
      option.textContent = definition.label;
      engineSelect.append(option);
    }
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom (JSON)…';
    engineSelect.append(customOption);

    engineSelect.value = DEFAULT_ENGINE_ID;
    engineSelect.addEventListener('change', () => {
      if (engineSelect.value === 'custom') {
        this.openCustomEditor();
        return;
      }
      element('edit-custom').hidden = true;
      this.audio.reset();
      this.post({
        type: 'load',
        engineId: engineSelect.value,
        audioSampleRate: this.audio.sampleRate,
      });
    });

    this.bindCustomEditor();

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

    const themeSelect = element<HTMLSelectElement>('theme-select');
    for (const theme of THEMES) {
      const option = document.createElement('option');
      option.value = theme.id;
      option.textContent = theme.label;
      themeSelect.appendChild(option);
    }
    let savedTheme = 'default';
    try {
      savedTheme = localStorage.getItem('engine-sim-theme') ?? 'default';
    } catch {
      /* storage unavailable */
    }
    themeSelect.value = getTheme(savedTheme).id;

    const applyTheme = (id: string): void => {
      const named = getTheme(id);
      const theme = buildTheme(named.palette);
      applyCssTheme(named.palette);
      this.renderer.setTheme(theme);
      this.gauges.setTheme(theme);
      this.scopes.setTheme(theme);
    };
    themeSelect.addEventListener('change', () => {
      applyTheme(themeSelect.value);
      try {
        localStorage.setItem('engine-sim-theme', themeSelect.value);
      } catch {
        /* storage unavailable */
      }
      this.showBanner(`Theme: ${getTheme(themeSelect.value).label}`);
    });
    if (themeSelect.value !== 'default') applyTheme(themeSelect.value);

    // Camera: wheel zooms about the cursor, drag pans, double-click resets.
    this.engineCanvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = this.engineCanvas.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.0012);
        this.renderer.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
      },
      { passive: false },
    );
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    this.engineCanvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      dragX = event.clientX;
      dragY = event.clientY;
      this.engineCanvas.setPointerCapture(event.pointerId);
    });
    this.engineCanvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      this.renderer.panBy(event.clientX - dragX, event.clientY - dragY);
      dragX = event.clientX;
      dragY = event.clientY;
    });
    this.engineCanvas.addEventListener('pointerup', () => {
      dragging = false;
    });
    this.engineCanvas.addEventListener('dblclick', () => {
      this.renderer.resetView();
      this.showBanner('View reset');
    });

    const volume = element<HTMLInputElement>('volume');
    volume.addEventListener('input', () => {
      this.audio.setVolume(Number(volume.value));
    });
    this.audio.setVolume(Number(volume.value));

    const throttle = element<HTMLInputElement>('throttle');
    throttle.addEventListener('input', () => {
      this.input.setBaseSpeedSetting(Number(throttle.value));
    });

    element('start-button').addEventListener('click', () => void this.start());
    element('help-button').addEventListener('click', () => this.toggleHelp());
    element('help-close').addEventListener('click', () => this.toggleHelp(false));

    element('toggle-ignition').addEventListener('click', () => this.toggleIgnition());
    element('toggle-dyno').addEventListener('click', () => this.toggleDyno());
    element('toggle-hold').addEventListener('click', () => this.toggleHold());

    element('gear-up').addEventListener('click', () => this.changeGear(this.control.gear + 1));
    element('gear-down').addEventListener('click', () => this.changeGear(this.control.gear - 1));

    this.bindBindingsDialog();

    // The starter is a hold control with three sources - this button, the
    // bound key and a controller button - so the button only sets a flag and
    // the render loop combines all three. Sending the control straight from
    // here would be undone on the next frame, when the loop saw the key up.
    //
    // Pointer capture makes the release reliable: without it, dragging off the
    // button swallows the pointerup and the starter latches on.
    const starterButton = element('toggle-starter');
    starterButton.addEventListener('pointerdown', (event) => {
      this.starterFromPointer = true;
      starterButton.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    const releaseStarter = (event: PointerEvent) => {
      this.starterFromPointer = false;
      if (starterButton.hasPointerCapture(event.pointerId)) {
        starterButton.releasePointerCapture(event.pointerId);
      }
    };
    starterButton.addEventListener('pointerup', releaseStarter);
    starterButton.addEventListener('pointercancel', releaseStarter);
    // A pointer that vanishes without either event (tab switch, mouse leaving
    // the window mid-press) must not leave the starter engaged.
    window.addEventListener('blur', () => {
      this.starterFromPointer = false;
    });
  }

  private async start(): Promise<void> {
    element('start-overlay').setAttribute('hidden', '');
    this.started = true;

    await this.audio.start();

    const select = element<HTMLSelectElement>('engine-select');
    this.post({
      type: 'load',
      engineId: select.value,
      audioSampleRate: this.audio.sampleRate,
    });
  }

  /**
   * Load the impulse response each exhaust system asks for and hand it to the
   * worker. Engines with separate collectors get separate responses.
   */
  private async sendImpulseResponses(info: EngineInfo): Promise<void> {
    for (let channel = 0; channel < info.impulseResponses.length; ++channel) {
      const { name, volume } = info.impulseResponses[channel];
      const { url, gain } = resolveImpulseResponse(name);

      try {
        let samples = this.impulseResponses.get(url);
        if (samples === undefined) {
          samples = await loadImpulseResponse(url);
          this.impulseResponses.set(url, samples);
        }

        this.post({ type: 'impulseResponse', channel, samples, volume: volume * gain });
      } catch {
        // The engine still runs without reverb; say so and carry on.
        this.showBanner('Impulse response unavailable — running dry');
        return;
      }
    }
  }

  private onWorkerMessage(message: WorkerToMain): void {
    switch (message.type) {
      case 'loaded': {
        this.info = message.info;
        // The last frame belongs to the previous engine; drop it so nothing
        // renders a mismatched buffer before the first new frame arrives.
        this.latestState = null;
        this.renderer.setEngine(message.info);
        this.gauges.setEngine(message.info);
        this.scopes.setEngine(message.info);
        this.renderer.resize();
        this.gauges.resize();
        this.scopes.resize();

        element('engine-name').textContent = message.info.name;
        element('r-displacement').textContent = `${(message.info.displacement / units.L).toFixed(
          2,
        )} L`;

        this.control = {
          ...defaultControlState(),
          simulationFrequency: message.info.simulationFrequency,
        };
        this.dynoSpeedRpm = units.toRpm(message.info.dynoMinSpeed);

        void this.sendImpulseResponses(message.info);
        break;
      }

      case 'frame':
        this.latestState = message.state;
        this.scopes.ingest(message.state, message.scope);
        if (message.audio.length > 0 && this.started && !this.paused) {
          this.scopes.pushAudio(message.audio);
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
        this.showBanner(`Throttle ${(this.input.getBaseSpeedSetting() * 100).toFixed(0)}%`);
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

    // Controller and keyboard stay live at the same time: whichever asks for
    // more throttle (or more clutch slip) wins, so a pedal never fights a key.
    const pad = this.gamepad.poll();
    this.pedalThrottle = pad.throttle ?? 0;
    this.pedalClutch = pad.clutch ?? 0;

    // With the bindings dialog open, a press is the user choosing a binding,
    // not driving the engine - otherwise testing a starter paddle would crank
    // it. Travel is still read above so the preview bars stay live.
    const binding = this.bindingsOpen;

    if (!binding) {
      if (pad.pressed.gearUp) this.changeGear(this.control.gear + 1);
      if (pad.pressed.gearDown) this.changeGear(this.control.gear - 1);
      if (pad.pressed.ignition) this.toggleIgnition();
      if (pad.pressed.dyno) this.toggleDyno();
      if (pad.pressed.rpmHold) this.toggleHold();
      if (pad.pressed.layerUp) this.stepLayer(1);
      if (pad.pressed.layerDown) this.stepLayer(-1);
      if (pad.pressed.pause) this.togglePause();
    }

    const speedControl = binding ? 0 : Math.max(analog.speedControl, this.pedalThrottle);
    const clutchPressure = binding ? 1 : Math.min(analog.clutchPressure, 1 - this.pedalClutch);

    if (this.started) {
      // Three independent sources hold the starter, so it is engaged when any
      // of them is down and released only when all of them are up.
      const starter =
        !binding && (this.input.starterHeld || this.starterFromPointer || pad.held.starter);
      const update: Partial<ControlState> = {
        speedControl,
        clutchPressure,
        dynoSpeed: units.rpm(this.dynoSpeedRpm),
      };

      if (starter !== this.control.starter) update.starter = starter;

      this.send(update);
    }

    this.updateControlPanel(speedControl, clutchPressure, pad.connected);

    if (this.latestState !== null) {
      // A rendering exception must never kill the loop: log it, drop the
      // frame, keep the app alive.
      try {
        this.renderer.render(this.latestState);
        this.gauges.render(this.latestState);
        this.scopes.render();
        this.updateReadouts(this.latestState);
      } catch (error) {
        if (!this.renderErrorReported) {
          this.renderErrorReported = true;
          console.error('render failed; frame dropped', error);
          this.showBanner('Rendering error — frame dropped (see console)', 6000);
        }
      }
    }

    if (this.bannerTimer !== 0 && now > this.bannerTimer) {
      this.banner.hidden = true;
      this.bannerTimer = 0;
    }

    requestAnimationFrame(this.loop);
  };

  private openCustomEditor(): void {
    const dialog = element<HTMLDialogElement>('custom-dialog');
    const textarea = element<HTMLTextAreaElement>('custom-json');

    if (textarea.value.trim() === '') {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('engine-sim-custom');
      } catch {
        /* storage unavailable */
      }
      textarea.value = saved ?? JSON.stringify(customEngineTemplate(), null, 2);
    }

    element('custom-error').hidden = true;
    dialog.showModal();
  }

  private customApplied = false;

  private bindCustomEditor(): void {
    const dialog = element<HTMLDialogElement>('custom-dialog');
    const textarea = element<HTMLTextAreaElement>('custom-json');
    const errorBox = element('custom-error');
    const engineSelect = element<HTMLSelectElement>('engine-select');

    element('edit-custom').addEventListener('click', () => this.openCustomEditor());

    element('custom-template').addEventListener('click', () => {
      textarea.value = JSON.stringify(customEngineTemplate(), null, 2);
      errorBox.hidden = true;
    });

    element('custom-apply').addEventListener('click', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textarea.value);
      } catch (error) {
        errorBox.textContent = `Not valid JSON: ${(error as Error).message}`;
        errorBox.hidden = false;
        return;
      }

      // Compile here too so mistakes surface in the dialog, not the banner.
      try {
        compileCustomEngine(parsed as Parameters<typeof compileCustomEngine>[0]);
      } catch (error) {
        errorBox.textContent = (error as Error).message;
        errorBox.hidden = false;
        return;
      }

      try {
        localStorage.setItem('engine-sim-custom', textarea.value);
      } catch {
        /* storage unavailable */
      }

      this.customApplied = true;
      dialog.close();
      element('edit-custom').hidden = false;
      this.audio.reset();
      this.post({
        type: 'load',
        engineId: 'custom',
        customJson: textarea.value,
        audioSampleRate: this.audio.sampleRate,
      });
    });

    dialog.addEventListener('close', () => {
      // Cancelled without applying: fall back to the loaded engine.
      if (this.customApplied) {
        this.customApplied = false;
        return;
      }
      if (engineSelect.value === 'custom' && this.info?.id !== 'custom') {
        engineSelect.value = this.info?.id ?? DEFAULT_ENGINE_ID;
      }
    });
  }

  private updateControlPanel(throttle: number, clutch: number, padConnected: boolean): void {
    const set = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el !== null && el.textContent !== text) el.textContent = text;
    };

    const throttleBar = document.getElementById('bar-throttle');
    if (throttleBar !== null) throttleBar.style.height = `${Math.round(throttle * 100)}%`;
    // The clutch bar reads as pedal input, the way a racing display draws
    // it: pressed pedal (disengaged clutch) fills the bar.
    const clutchInput = 1 - clutch;
    const clutchBar = document.getElementById('bar-clutch');
    if (clutchBar !== null) clutchBar.style.height = `${Math.round(clutchInput * 100)}%`;
    set('bar-throttle-pct', String(Math.round(throttle * 100)));
    set('bar-clutch-pct', String(Math.round(clutchInput * 100)));

    const dot = document.getElementById('bindings-status');
    if (dot !== null && dot.dataset.connected !== String(padConnected)) {
      dot.dataset.connected = String(padConnected);
      dot.title = padConnected ? 'Controller connected' : 'No controller';
    }

    // Live pedal previews while the bindings dialog is open.
    const dialog = document.getElementById('bindings-dialog') as HTMLDialogElement | null;
    if (dialog?.open) {
      const throttlePreview = document.getElementById('bind-preview-throttle');
      if (throttlePreview !== null) {
        throttlePreview.style.width = `${Math.round(this.pedalThrottle * 100)}%`;
      }
      const clutchPreview = document.getElementById('bind-preview-clutch');
      if (clutchPreview !== null) {
        clutchPreview.style.width = `${Math.round(this.pedalClutch * 100)}%`;
      }

      const devices = this.gamepad.connectedPads();
      set(
        'bindings-devices',
        devices.length === 0
          ? 'No controller detected — press a pedal or button to wake it.'
          : `Connected: ${devices.join(', ')}`,
      );
    }
  }

  /** Action whose keyboard binding is being captured, if any. */
  private keyCaptureTarget: ActionId | null = null;

  /** True while the bindings dialog has the controls. */
  private bindingsOpen = false;

  private refreshBindingRows(): void {
    for (const action of ACTIONS) {
      const binding = this.bindings.get(action.id);

      const keyLabel = document.getElementById(`bind-key-${action.id}`);
      if (keyLabel !== null) {
        const capturing = this.keyCaptureTarget === action.id;
        keyLabel.textContent = capturing ? 'press a key…' : formatKey(binding.key);
        keyLabel.dataset.capturing = String(capturing);
        keyLabel.dataset.unbound = String(!capturing && binding.key === undefined);
      }

      const deviceLabel = document.getElementById(`bind-dev-${action.id}`);
      if (deviceLabel !== null) {
        const capturing = this.gamepad.capturing === action.id;
        deviceLabel.textContent = capturing ? 'press a control…' : formatDevice(binding.device);
        deviceLabel.dataset.capturing = String(capturing);
        deviceLabel.dataset.unbound = String(!capturing && binding.device === undefined);
      }
    }

    const warning = document.getElementById('bindings-persist-warning');
    if (warning !== null) warning.hidden = this.bindings.persistent;
  }

  private cancelAllCapture(): void {
    this.gamepad.cancelCapture();
    this.input.cancelKeyCapture();
    this.keyCaptureTarget = null;
  }

  /**
   * One row per action, built from the catalogue rather than written out in
   * HTML, so adding an action cannot leave the dialog out of step with it.
   */
  private buildBindingRows(): void {
    const container = element('bindings-rows');
    container.textContent = '';

    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'binding-row';

      const name = document.createElement('span');
      name.className = 'binding-name';
      name.append(action.label);

      const hint = document.createElement('small');
      hint.textContent = action.hint;
      name.append(hint);

      // Analogue actions get a live travel bar, so a bound pedal can be
      // checked without leaving the dialog.
      if (action.kind === 'analog') {
        const preview = document.createElement('div');
        preview.className = 'binding-preview';
        const fill = document.createElement('div');
        fill.id = `bind-preview-${action.id}`;
        preview.append(fill);
        name.append(preview);
      }

      row.append(name, this.bindingCell(action.id, 'key'), this.bindingCell(action.id, 'dev'));
      container.append(row);
    }
  }

  private bindingCell(id: ActionId, which: 'key' | 'dev'): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'binding-cell';

    const label = document.createElement('b');
    label.id = `bind-${which}-${id}`;
    label.textContent = 'unbound';

    const bind = document.createElement('button');
    bind.type = 'button';
    bind.textContent = 'Bind';
    if (which === 'key') bind.dataset.bindKey = id;
    else bind.dataset.bindDev = id;

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'binding-clear';
    clear.textContent = '✕';
    clear.title = 'Clear this binding';
    if (which === 'key') clear.dataset.clearKey = id;
    else clear.dataset.clearDev = id;

    cell.append(label, bind, clear);
    return cell;
  }

  private bindBindingsDialog(): void {
    const dialog = element<HTMLDialogElement>('bindings-dialog');
    this.buildBindingRows();

    element('bindings-setup').addEventListener('click', () => {
      this.refreshBindingRows();
      this.bindingsOpen = true;
      this.input.suspended = true;
      dialog.showModal();
    });

    dialog.addEventListener('close', () => {
      this.bindingsOpen = false;
      this.input.suspended = false;
      this.cancelAllCapture();
    });

    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-bind-key]')) {
      button.addEventListener('click', () => {
        const target = button.dataset.bindKey as ActionId;
        // Only one capture can be armed, or a pedal press would land in the
        // keyboard slot.
        this.cancelAllCapture();
        this.keyCaptureTarget = target;
        this.input.startKeyCapture((key) => {
          this.keyCaptureTarget = null;
          if (key !== null) this.bindings.setKey(target, key);
          this.refreshBindingRows();
        });
        this.refreshBindingRows();
      });
    }

    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-bind-dev]')) {
      button.addEventListener('click', () => {
        const target = button.dataset.bindDev as ActionId;
        this.cancelAllCapture();
        this.gamepad.startCapture(target, () => this.refreshBindingRows());
        this.refreshBindingRows();
      });
    }

    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-clear-key]')) {
      button.addEventListener('click', () => {
        this.cancelAllCapture();
        this.bindings.clearKey(button.dataset.clearKey as ActionId);
        this.refreshBindingRows();
      });
    }

    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-clear-dev]')) {
      button.addEventListener('click', () => {
        this.cancelAllCapture();
        this.bindings.clearDevice(button.dataset.clearDev as ActionId);
        this.refreshBindingRows();
      });
    }

    element('bindings-reset').addEventListener('click', () => {
      this.cancelAllCapture();
      this.bindings.resetAll();
      this.refreshBindingRows();
      this.showBanner('Bindings reset to defaults');
    });

    // Fill the rows now rather than only on open, so they never show the
    // placeholder text if anything reveals the dialog another way.
    this.refreshBindingRows();
  }

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
    set('gear-display', gear < 0 ? 'N' : String(gear + 1));
    set('r-clutch', `${(state[S.ClutchPressure] * 100).toFixed(0)}%`);
    set('r-speed', `${(state[S.VehicleSpeed] / units.mph).toFixed(0)} mph`);

    // Fuel: cumulative burn, and a smoothed rate like the original's cluster.
    const fuel = state[S.FuelConsumed];
    const now = performance.now() / 1000;
    if (this.lastFuelTime > 0 && now > this.lastFuelTime) {
      const rate = Math.max(0, (fuel - this.lastFuelVolume) / (now - this.lastFuelTime));
      this.fuelRate += (rate - this.fuelRate) * 0.05;
    }
    this.lastFuelVolume = fuel;
    this.lastFuelTime = now;
    set(
      'r-fuel',
      fuel < units.volume(1.0, units.L)
        ? `${(fuel / units.volume(1.0, units.mL)).toFixed(1)} mL`
        : `${(fuel / units.volume(1.0, units.L)).toFixed(2)} L`,
    );
    set('r-fuel-rate', `${((this.fuelRate * 3600) / units.volume(1.0, units.L)).toFixed(1)} L/h`);

    set('d-frequency', `${(state[S.SimulationFrequency] / 1000).toFixed(1)} kHz`);
    set('d-fluid', state[S.FluidSteps].toFixed(0));
    set('d-load', `${(state[S.FrameLoad] * 100).toFixed(0)}%`);
    set('d-latency', `${(state[S.AudioLatency] * 1000).toFixed(0)} ms`);
    set('d-steps', state[S.StepsThisFrame].toFixed(0));

    const warp = state[S.SimulationSpeed];
    set('d-warp', warp >= 1 ? '1x' : `1/${Math.round(1 / warp)}x`);
    set('d-drops', `${(this.audio.starvedSamples / this.audio.sampleRate).toFixed(2)} s`);
    set('d-wasm', state[S.WasmActive] > 0.5 ? 'WASM' : 'JS');

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
      throttleSlider.value = String(this.input.getBaseSpeedSetting());
    }
  }
}

new App();
