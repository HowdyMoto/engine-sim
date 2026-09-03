/**
 * Controller input via the Gamepad API.
 *
 * Reads whatever the browser exposes - wheels, pedal sets, shifters, gamepads -
 * and resolves it into per-action state using the shared binding store. Both
 * axes and buttons can drive any action: a pedal gives an analogue action real
 * travel, and a button gives it an on/off 0 or 1, so a rig with only paddles
 * still works.
 *
 * Capture requires a *change* from the moment binding started, not merely a
 * pressed input. Otherwise clicking Bind while a paddle is already held would
 * bind that paddle instantly, which is exactly what happens on wheels that
 * report a permanently-pressed calibration button.
 */
import { ACTIONS, mapAxis, widenAxis } from './bindings';
import type { ActionId, BindingStore, DeviceBinding } from './bindings';

/** Minimal shape of a navigator.getGamepads() entry, so tests can fake one. */
export interface PadLike {
  id: string;
  axes: ArrayLike<number>;
  buttons: ArrayLike<{ pressed: boolean }>;
}

export interface PadState {
  /** 0..1 travel for the analogue actions, null when unbound or absent. */
  throttle: number | null;
  clutch: number | null;
  /** Currently active, per action. */
  held: Record<ActionId, boolean>;
  /** Became active during this poll, per action. */
  pressed: Record<ActionId, boolean>;
  connected: boolean;
}

/** Axis travel past this fraction counts as a press for on/off actions. */
const PRESS_THRESHOLD = 0.5;
/** Axis movement during capture that counts as "the user moved this one". */
const CAPTURE_THRESHOLD = 0.45;

interface Capture {
  action: ActionId;
  axisBaselines: Map<number, number[]>;
  buttonBaselines: Map<number, boolean[]>;
  onDone: (binding: DeviceBinding) => void;
}

function emptyFlags(): Record<ActionId, boolean> {
  const flags = {} as Record<ActionId, boolean>;
  for (const action of ACTIONS) flags[action.id] = false;
  return flags;
}

export class GamepadInput {
  private capture: Capture | null = null;
  private wasHeld = emptyFlags();

  constructor(
    private store: BindingStore,
    private getGamepads: () => (PadLike | null)[] = defaultGamepadSource,
  ) {}

  /** Names of connected devices, for the bindings dialog. */
  connectedPads(): string[] {
    const names: string[] = [];
    for (const pad of this.getGamepads()) {
      if (pad !== null) names.push(pad.id);
    }
    return names;
  }

  get capturing(): ActionId | null {
    return this.capture?.action ?? null;
  }

  /**
   * Listen for the next controller movement and bind it to `action`.
   * `cancelCapture` abandons it; `onDone` fires once something is bound.
   */
  startCapture(action: ActionId, onDone: (binding: DeviceBinding) => void): void {
    const axisBaselines = new Map<number, number[]>();
    const buttonBaselines = new Map<number, boolean[]>();

    const pads = this.getGamepads();
    for (let i = 0; i < pads.length; ++i) {
      const pad = pads[i];
      if (pad === null) continue;
      axisBaselines.set(i, Array.from(pad.axes));
      buttonBaselines.set(i, Array.from(pad.buttons, (b) => b.pressed));
    }

    this.capture = { action, axisBaselines, buttonBaselines, onDone };
  }

  cancelCapture(): void {
    this.capture = null;
  }

  private findPad(pads: (PadLike | null)[], id: string): PadLike | null {
    for (const pad of pads) {
      if (pad !== null && pad.id === id) return pad;
    }
    return null;
  }

  /**
   * Current travel for one binding, 0..1, or null when the device is gone.
   * Axis bindings widen their calibration as they go.
   */
  private read(pads: (PadLike | null)[], binding: DeviceBinding): number | null {
    const pad = this.findPad(pads, binding.gamepadId);
    if (pad === null) return null;

    if (binding.kind === 'axis') {
      if (binding.axis >= pad.axes.length) return null;
      const raw = pad.axes[binding.axis];
      if (!Number.isFinite(raw)) return null;
      if (widenAxis(binding, raw)) this.store.touch();
      return mapAxis(binding, raw);
    }

    if (binding.button >= pad.buttons.length) return null;
    return pad.buttons[binding.button].pressed ? 1 : 0;
  }

  poll(): PadState {
    const pads = this.getGamepads();

    if (this.capture !== null) this.pollCapture(pads);

    const state: PadState = {
      throttle: null,
      clutch: null,
      held: emptyFlags(),
      pressed: emptyFlags(),
      connected: false,
    };

    for (const pad of pads) {
      if (pad !== null) {
        state.connected = true;
        break;
      }
    }

    for (const action of ACTIONS) {
      const binding = this.store.get(action.id).device;
      if (binding === undefined) {
        this.wasHeld[action.id] = false;
        continue;
      }

      const travel = this.read(pads, binding);
      if (travel === null) {
        this.wasHeld[action.id] = false;
        continue;
      }

      if (action.id === 'throttle') state.throttle = travel;
      if (action.id === 'clutch') state.clutch = travel;

      const held = travel > PRESS_THRESHOLD;
      state.held[action.id] = held;
      state.pressed[action.id] = held && !this.wasHeld[action.id];
      this.wasHeld[action.id] = held;
    }

    return state;
  }

  private pollCapture(pads: (PadLike | null)[]): void {
    const capture = this.capture!;

    for (let i = 0; i < pads.length; ++i) {
      const pad = pads[i];
      if (pad === null) continue;

      // A pad that appeared mid-capture supplies its current pose as the
      // baseline, so waking a device by pressing it does not bind that press.
      let axisBaseline = capture.axisBaselines.get(i);
      let buttonBaseline = capture.buttonBaselines.get(i);
      if (axisBaseline === undefined || buttonBaseline === undefined) {
        capture.axisBaselines.set(i, Array.from(pad.axes));
        capture.buttonBaselines.set(i, Array.from(pad.buttons, (b) => b.pressed));
        continue;
      }

      // Buttons first: a deliberate press is less ambiguous than axis drift.
      for (let b = 0; b < pad.buttons.length; ++b) {
        if (!pad.buttons[b].pressed) {
          // Seeing it released re-arms it, so a button that happened to be
          // held when capture began still binds on the next real press.
          buttonBaseline[b] = false;
          continue;
        }
        if (!(buttonBaseline[b] ?? false)) {
          this.finish({ kind: 'button', gamepadId: pad.id, button: b });
          return;
        }
      }

      let bestAxis = -1;
      let bestDelta = CAPTURE_THRESHOLD;
      for (let a = 0; a < pad.axes.length; ++a) {
        const raw = pad.axes[a];
        if (!Number.isFinite(raw)) continue;
        const delta = Math.abs(raw - (axisBaseline[a] ?? 0));
        if (delta > bestDelta) {
          bestDelta = delta;
          bestAxis = a;
        }
      }

      if (bestAxis !== -1) {
        this.finish({
          kind: 'axis',
          gamepadId: pad.id,
          axis: bestAxis,
          rest: axisBaseline[bestAxis] ?? 0,
          pressed: pad.axes[bestAxis],
        });
        return;
      }
    }
  }

  private finish(binding: DeviceBinding): void {
    const capture = this.capture!;
    this.capture = null;
    this.store.setDevice(capture.action, binding);
    // A fresh binding starts unheld, so an in-progress press is not replayed
    // as an edge the moment binding completes.
    this.wasHeld[capture.action] = true;
    capture.onDone(binding);
  }
}

function defaultGamepadSource(): (PadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return navigator.getGamepads();
  } catch {
    // Chrome throws here when the page is not a secure context.
    return [];
  }
}
