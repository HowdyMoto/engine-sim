/**
 * Sim-racing pedal and shifter input via the Gamepad API.
 *
 * Pedal sets expose throttle and clutch as axes and paddle shifters as
 * buttons, but which axis is which varies by manufacturer, and pedals rest
 * anywhere (-1, 0 or +1) and may run in either direction. So bindings are
 * captured, not assumed: "press the pedal you want" - the axis that moves the
 * most during capture becomes the binding, its rest and pressed values become
 * the calibration, and the observed range keeps widening during play so a
 * short capture press still calibrates to full travel. Bindings persist in
 * localStorage keyed by device id.
 */
import { clamp } from '../core/utilities';

export interface AxisBinding {
  kind: 'axis';
  /** Device identity; matched against connected pads, index as tiebreak. */
  gamepadId: string;
  axis: number;
  /** Raw value at rest. */
  rest: number;
  /** Raw value fully pressed. May be smaller than rest - direction flips. */
  pressed: number;
}

export interface ButtonBinding {
  kind: 'button';
  gamepadId: string;
  button: number;
}

export type BindingTarget = 'throttle' | 'clutch' | 'gearUp' | 'gearDown';

export interface PedalBindings {
  throttle?: AxisBinding;
  clutch?: AxisBinding;
  gearUp?: ButtonBinding;
  gearDown?: ButtonBinding;
}

export interface PedalState {
  /** 0..1 pedal travel, or null when unbound / disconnected. */
  throttle: number | null;
  clutch: number | null;
  /** Rising edges this poll. */
  gearUp: boolean;
  gearDown: boolean;
  connected: boolean;
}

/** Minimal shape of navigator.getGamepads() results, for tests. */
export interface PadLike {
  id: string;
  axes: ArrayLike<number>;
  buttons: ArrayLike<{ pressed: boolean }>;
}

const STORAGE_KEY = 'engine-sim-pedals';
const CAPTURE_THRESHOLD = 0.45;

/** Map a raw axis value through a binding's calibration to 0..1. */
export function mapAxis(binding: AxisBinding, raw: number): number {
  const span = binding.pressed - binding.rest;
  if (Math.abs(span) < 1e-6) return 0;
  return clamp((raw - binding.rest) / span);
}

/**
 * Widen the calibration when the pedal travels beyond what capture saw.
 * Returns true when the binding changed.
 */
export function widenAxis(binding: AxisBinding, raw: number): boolean {
  const span = binding.pressed - binding.rest;
  if (span >= 0) {
    if (raw > binding.pressed) {
      binding.pressed = raw;
      return true;
    }
    if (raw < binding.rest) {
      binding.rest = raw;
      return true;
    }
  } else {
    if (raw < binding.pressed) {
      binding.pressed = raw;
      return true;
    }
    if (raw > binding.rest) {
      binding.rest = raw;
      return true;
    }
  }
  return false;
}

interface Capture {
  target: BindingTarget;
  /** Axis baselines per pad index at capture start. */
  baselines: Map<number, number[]>;
  onDone: (binding: AxisBinding | ButtonBinding) => void;
}

export class GamepadInput {
  bindings: PedalBindings = {};

  private capture: Capture | null = null;
  private previousButtons = new Map<string, boolean[]>();

  constructor(
    private getGamepads: () => (PadLike | null)[] = () =>
      typeof navigator !== 'undefined' && navigator.getGamepads
        ? navigator.getGamepads()
        : [],
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) this.bindings = JSON.parse(raw) as PedalBindings;
    } catch {
      /* storage unavailable or corrupt - start unbound */
      this.bindings = {};
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      /* storage unavailable */
    }
  }

  clearBinding(target: BindingTarget): void {
    delete this.bindings[target];
    this.save();
  }

  /**
   * Begin listening for the next pedal movement or button press and bind it
   * to `target`. Resolves through `onDone`; `cancelCapture` abandons it.
   */
  startCapture(target: BindingTarget, onDone: (b: AxisBinding | ButtonBinding) => void): void {
    const baselines = new Map<number, number[]>();
    const pads = this.getGamepads();
    for (let i = 0; i < pads.length; ++i) {
      const pad = pads[i];
      if (pad) baselines.set(i, Array.from(pad.axes));
    }
    this.capture = { target, baselines, onDone };
  }

  cancelCapture(): void {
    this.capture = null;
  }

  get capturing(): BindingTarget | null {
    return this.capture?.target ?? null;
  }

  /** Names of connected devices, for the setup dialog. */
  connectedPads(): string[] {
    const names: string[] = [];
    for (const pad of this.getGamepads()) {
      if (pad) names.push(pad.id);
    }
    return names;
  }

  private findPad(pads: (PadLike | null)[], id: string): PadLike | null {
    for (const pad of pads) {
      if (pad !== null && pad.id === id) return pad;
    }
    return null;
  }

  poll(): PedalState {
    const pads = this.getGamepads();

    if (this.capture !== null) this.pollCapture(pads);

    const state: PedalState = {
      throttle: null,
      clutch: null,
      gearUp: false,
      gearDown: false,
      connected: false,
    };

    for (const pad of pads) {
      if (pad !== null) {
        state.connected = true;
        break;
      }
    }

    for (const target of ['throttle', 'clutch'] as const) {
      const binding = this.bindings[target];
      if (binding === undefined) continue;
      const pad = this.findPad(pads, binding.gamepadId);
      if (pad === null || binding.axis >= pad.axes.length) continue;

      const raw = pad.axes[binding.axis];
      if (widenAxis(binding, raw)) this.save();
      state[target] = mapAxis(binding, raw);
    }

    for (const target of ['gearUp', 'gearDown'] as const) {
      const binding = this.bindings[target];
      if (binding === undefined) continue;
      const pad = this.findPad(pads, binding.gamepadId);
      if (pad === null || binding.button >= pad.buttons.length) continue;

      const pressed = pad.buttons[binding.button].pressed;
      const key = `${binding.gamepadId}:${binding.button}`;
      const wasPressed = this.previousButtons.get(key)?.[0] ?? false;
      this.previousButtons.set(key, [pressed]);
      state[target] = pressed && !wasPressed;
    }

    return state;
  }

  private pollCapture(pads: (PadLike | null)[]): void {
    const capture = this.capture!;
    const wantsAxis = capture.target === 'throttle' || capture.target === 'clutch';

    for (let i = 0; i < pads.length; ++i) {
      const pad = pads[i];
      if (pad === null) continue;

      if (wantsAxis) {
        let baseline = capture.baselines.get(i);
        if (baseline === undefined) {
          // Pad connected mid-capture: its current pose is the baseline.
          baseline = Array.from(pad.axes);
          capture.baselines.set(i, baseline);
          continue;
        }

        let bestAxis = -1;
        let bestDelta = CAPTURE_THRESHOLD;
        for (let a = 0; a < pad.axes.length; ++a) {
          const delta = Math.abs(pad.axes[a] - (baseline[a] ?? 0));
          if (delta > bestDelta) {
            bestDelta = delta;
            bestAxis = a;
          }
        }

        if (bestAxis !== -1) {
          const binding: AxisBinding = {
            kind: 'axis',
            gamepadId: pad.id,
            axis: bestAxis,
            rest: baseline[bestAxis] ?? 0,
            pressed: pad.axes[bestAxis],
          };
          this.bindings[capture.target as 'throttle' | 'clutch'] = binding;
          this.save();
          this.capture = null;
          capture.onDone(binding);
          return;
        }
      } else {
        for (let b = 0; b < pad.buttons.length; ++b) {
          if (pad.buttons[b].pressed) {
            const binding: ButtonBinding = { kind: 'button', gamepadId: pad.id, button: b };
            this.bindings[capture.target as 'gearUp' | 'gearDown'] = binding;
            this.save();
            this.capture = null;
            capture.onDone(binding);
            return;
          }
        }
      }
    }
  }
}
