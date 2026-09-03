/**
 * Input bindings: one keyboard key and one controller input per action.
 *
 * Every control the driver actually uses while the engine is running lives in
 * one catalogue, and each entry carries both a keyboard binding and a device
 * binding. Either one alone drives the action, so a wheel-and-pedals rig and
 * the keyboard stay live at the same time.
 *
 * Device bindings are captured rather than assumed. Pedal sets disagree about
 * which axis is which, rest anywhere in (-1, +1) and may travel in either
 * direction, so "press the one you want" is the only portable answer: the axis
 * that moves most during capture wins, its rest and pressed values become the
 * calibration, and the observed range keeps widening during play so a timid
 * capture press still ends up calibrated to full travel.
 *
 * Everything persists to localStorage under a versioned key, and every value
 * is re-validated on load. A corrupt or truncated blob degrades to defaults
 * for the affected actions instead of throwing, so a bad write can never brick
 * the controls.
 */
import { clamp } from '../core/utilities';

export type ActionId =
  | 'throttle'
  | 'clutch'
  | 'starter'
  | 'ignition'
  | 'dyno'
  | 'rpmHold'
  | 'gearUp'
  | 'gearDown'
  | 'layerUp'
  | 'layerDown'
  | 'pause';

/**
 * How an action consumes its input.
 *
 * `analog` reads 0..1 travel, `hold` is active while pressed, `toggle` and
 * `edge` both fire once per press and differ only in what they do with it.
 */
export type ActionKind = 'analog' | 'hold' | 'toggle' | 'edge';

export interface ActionDef {
  id: ActionId;
  label: string;
  kind: ActionKind;
  /** Keyboard key bound when nothing is saved. */
  defaultKey: string;
  hint: string;
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'throttle',
    label: 'Throttle',
    kind: 'analog',
    defaultKey: 'r',
    hint: 'Pedal travel, or hold the key for wide open',
  },
  {
    id: 'clutch',
    label: 'Clutch',
    kind: 'analog',
    defaultKey: 'Shift',
    hint: 'Pressing the pedal disengages the clutch',
  },
  {
    id: 'starter',
    label: 'Starter',
    kind: 'hold',
    defaultKey: 's',
    hint: 'Cranks while held',
  },
  { id: 'ignition', label: 'Ignition', kind: 'toggle', defaultKey: 'a', hint: 'Toggles on press' },
  { id: 'dyno', label: 'Dynamometer', kind: 'toggle', defaultKey: 'd', hint: 'Toggles on press' },
  {
    id: 'rpmHold',
    label: 'RPM hold',
    kind: 'toggle',
    defaultKey: 'h',
    hint: 'Needs the dyno enabled',
  },
  { id: 'gearUp', label: 'Shift up', kind: 'edge', defaultKey: 'ArrowUp', hint: 'One gear per press' },
  {
    id: 'gearDown',
    label: 'Shift down',
    kind: 'edge',
    defaultKey: 'ArrowDown',
    hint: 'One gear per press',
  },
  {
    id: 'layerUp',
    label: 'View layer in',
    kind: 'edge',
    defaultKey: 'm',
    hint: 'Show one rod journal depth at a time',
  },
  {
    id: 'layerDown',
    label: 'View layer out',
    kind: 'edge',
    defaultKey: ',',
    hint: 'Back towards showing every layer',
  },
  { id: 'pause', label: 'Pause', kind: 'toggle', defaultKey: 'p', hint: 'Freezes the simulation' },
];

export const ACTION_IDS: ActionId[] = ACTIONS.map((a) => a.id);

const ACTION_BY_ID = new Map<ActionId, ActionDef>(ACTIONS.map((a) => [a.id, a]));

export function actionDef(id: ActionId): ActionDef {
  const def = ACTION_BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown action ${id}`);
  return def;
}

export interface AxisBinding {
  kind: 'axis';
  /** Device identity, matched against connected pads by id. */
  gamepadId: string;
  axis: number;
  /** Raw value at rest. */
  rest: number;
  /** Raw value fully pressed. May be less than rest when travel is inverted. */
  pressed: number;
}

export interface ButtonBinding {
  kind: 'button';
  gamepadId: string;
  button: number;
}

export type DeviceBinding = AxisBinding | ButtonBinding;

export interface Binding {
  key?: string;
  device?: DeviceBinding;
}

export type BindingMap = Record<ActionId, Binding>;

const STORAGE_KEY = 'engine-sim-bindings';
/** Pre-versioning pedal-only bindings, migrated on first load. */
const LEGACY_KEY = 'engine-sim-pedals';
const VERSION = 2;

export function defaultBindings(): BindingMap {
  const map = {} as BindingMap;
  for (const action of ACTIONS) map[action.id] = { key: action.defaultKey };
  return map;
}

// ---- Validation -----------------------------------------------------------
//
// Storage is shared with the user and with older builds, so nothing that comes
// back from it is trusted. Each field is checked individually and a bad field
// discards only its own binding.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1024;
}

function validAxisValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8;
}

export function parseDeviceBinding(raw: unknown): DeviceBinding | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.gamepadId !== 'string' || raw.gamepadId === '') return undefined;

  if (raw.kind === 'axis') {
    if (!validIndex(raw.axis)) return undefined;
    if (!validAxisValue(raw.rest) || !validAxisValue(raw.pressed)) return undefined;
    // A zero-width calibration would divide by ~0 on every poll.
    if (Math.abs(raw.pressed - raw.rest) < 1e-6) return undefined;
    return {
      kind: 'axis',
      gamepadId: raw.gamepadId,
      axis: raw.axis,
      rest: raw.rest,
      pressed: raw.pressed,
    };
  }

  if (raw.kind === 'button') {
    if (!validIndex(raw.button)) return undefined;
    return { kind: 'button', gamepadId: raw.gamepadId, button: raw.button };
  }

  return undefined;
}

function parseKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === '' || raw.length > 24) return undefined;
  return raw;
}

/**
 * Rebuild a binding map from stored JSON, filling anything missing or invalid
 * from the defaults.
 */
export function parseBindings(raw: unknown): BindingMap {
  const result = defaultBindings();
  if (!isRecord(raw)) return result;

  const actions = isRecord(raw.actions) ? raw.actions : raw;

  for (const action of ACTIONS) {
    const entry = actions[action.id];
    if (!isRecord(entry)) continue;

    const binding: Binding = {};
    // An explicit null means "cleared"; absent means "never set", so only a
    // present-and-valid key overrides the default, and null clears it.
    if ('key' in entry) {
      const key = parseKey(entry.key);
      if (key !== undefined) binding.key = key;
    } else {
      binding.key = action.defaultKey;
    }

    const device = parseDeviceBinding(entry.device);
    if (device !== undefined) binding.device = device;

    result[action.id] = binding;
  }

  return result;
}

/** Migrate the pedal-only format that shipped before actions were bindable. */
export function migrateLegacy(raw: unknown): Partial<BindingMap> {
  if (!isRecord(raw)) return {};

  const out: Partial<BindingMap> = {};
  for (const id of ['throttle', 'clutch', 'gearUp', 'gearDown'] as const) {
    const device = parseDeviceBinding(raw[id]);
    if (device !== undefined) out[id] = { key: actionDef(id).defaultKey, device };
  }
  return out;
}

/**
 * Binding storage.
 *
 * Reads and writes are wrapped because storage throws outright in a few real
 * configurations: Safari private browsing, third-party iframes, and any
 * browser with site data disabled. None of those should cost the user their
 * controls, so every failure falls back to in-memory bindings.
 */
export class BindingStore {
  private map: BindingMap;
  /** True when the last write attempt failed, so the UI can say so. */
  persistent = true;

  constructor(private storage: Storage | null = safeStorage()) {
    this.map = this.load();
  }

  private load(): BindingMap {
    if (this.storage === null) {
      this.persistent = false;
      return defaultBindings();
    }

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw !== null) return parseBindings(JSON.parse(raw));

      // First run on a build that had only pedal bindings.
      const legacy = this.storage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        const migrated = { ...defaultBindings(), ...migrateLegacy(JSON.parse(legacy)) };
        this.map = migrated;
        this.save();
        return migrated;
      }
    } catch {
      // Corrupt JSON or storage access denied: start from defaults and let
      // the next save overwrite whatever is there.
      this.persistent = false;
      return defaultBindings();
    }

    return defaultBindings();
  }

  save(): void {
    if (this.storage === null) {
      this.persistent = false;
      return;
    }
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: VERSION, actions: this.map }),
      );
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }

  all(): BindingMap {
    return this.map;
  }

  get(id: ActionId): Binding {
    return this.map[id];
  }

  /** The action bound to a keyboard key, or null. */
  actionForKey(key: string): ActionId | null {
    for (const action of ACTIONS) {
      if (this.map[action.id].key === key) return action.id;
    }
    return null;
  }

  setKey(id: ActionId, key: string): void {
    // A key drives one action only, so binding it steals it from any other.
    for (const action of ACTIONS) {
      if (action.id !== id && this.map[action.id].key === key) {
        this.map[action.id] = { ...this.map[action.id], key: undefined };
      }
    }
    this.map[id] = { ...this.map[id], key };
    this.save();
  }

  setDevice(id: ActionId, device: DeviceBinding): void {
    for (const action of ACTIONS) {
      if (action.id !== id && sameDevice(this.map[action.id].device, device)) {
        this.map[action.id] = { ...this.map[action.id], device: undefined };
      }
    }
    this.map[id] = { ...this.map[id], device };
    this.save();
  }

  clearKey(id: ActionId): void {
    this.map[id] = { ...this.map[id], key: undefined };
    this.save();
  }

  clearDevice(id: ActionId): void {
    this.map[id] = { ...this.map[id], device: undefined };
    this.save();
  }

  resetAll(): void {
    this.map = defaultBindings();
    this.save();
  }

  /** Persist an in-place calibration widen without rebuilding the map. */
  touch(): void {
    this.save();
  }
}

export function sameDevice(a: DeviceBinding | undefined, b: DeviceBinding | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.gamepadId !== b.gamepadId) return false;
  if (a.kind === 'axis' && b.kind === 'axis') return a.axis === b.axis;
  if (a.kind === 'button' && b.kind === 'button') return a.button === b.button;
  return false;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

// ---- Axis calibration -----------------------------------------------------

/** Map a raw axis reading through its calibration to 0..1. */
export function mapAxis(binding: AxisBinding, raw: number): number {
  const span = binding.pressed - binding.rest;
  if (Math.abs(span) < 1e-6) return 0;
  return clamp((raw - binding.rest) / span);
}

/**
 * Widen the calibration when a pedal travels past what capture saw.
 * Returns true when the binding changed and should be persisted.
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

// ---- Display --------------------------------------------------------------

/** Human-readable name for a keyboard key. */
export function formatKey(key: string | undefined): string {
  if (key === undefined) return 'unbound';
  switch (key) {
    case ' ':
      return 'Space';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Escape':
      return 'Esc';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

export function formatDevice(device: DeviceBinding | undefined): string {
  if (device === undefined) return 'unbound';
  const name = device.gamepadId.length > 18
    ? `${device.gamepadId.slice(0, 18)}…`
    : device.gamepadId;
  return device.kind === 'axis'
    ? `Axis ${device.axis} · ${name}`
    : `Button ${device.button} · ${name}`;
}
