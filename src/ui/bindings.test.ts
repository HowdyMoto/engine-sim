import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  BindingStore,
  defaultBindings,
  formatDevice,
  formatKey,
  mapAxis,
  migrateLegacy,
  parseBindings,
  parseDeviceBinding,
  sameDevice,
  widenAxis,
} from './bindings';
import type { AxisBinding } from './bindings';

/** In-memory stand-in for localStorage. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** Storage that rejects every write, like Safari private browsing. */
function hostileStorage(): Storage {
  const base = fakeStorage();
  return {
    ...base,
    getItem: base.getItem,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  } as Storage;
}

describe('axis calibration', () => {
  it('maps a rest-to-plus pedal', () => {
    const binding: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: -1, pressed: 1 };
    expect(mapAxis(binding, -1)).toBe(0);
    expect(mapAxis(binding, 0)).toBeCloseTo(0.5);
    expect(mapAxis(binding, 1)).toBe(1);
  });

  it('maps an inverted pedal that rests at +1 and presses to -1', () => {
    const binding: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: 1, pressed: -1 };
    expect(mapAxis(binding, 1)).toBe(0);
    expect(mapAxis(binding, -1)).toBe(1);
    expect(mapAxis(binding, 0)).toBeCloseTo(0.5);
  });

  it('clamps overshoot beyond the calibrated range', () => {
    const binding: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: 0, pressed: 0.8 };
    expect(mapAxis(binding, 0.9)).toBe(1);
    expect(mapAxis(binding, -0.2)).toBe(0);
  });

  it('widens the range as deeper travel is observed', () => {
    const binding: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: 0, pressed: 0.5 };
    expect(widenAxis(binding, 0.9)).toBe(true);
    expect(binding.pressed).toBe(0.9);
    expect(widenAxis(binding, -0.1)).toBe(true);
    expect(binding.rest).toBe(-0.1);
    expect(widenAxis(binding, 0.4)).toBe(false);

    const inverted: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: 1, pressed: 0.2 };
    expect(widenAxis(inverted, -0.3)).toBe(true);
    expect(inverted.pressed).toBe(-0.3);
  });
});

describe('stored binding validation', () => {
  it('accepts well-formed axis and button bindings', () => {
    expect(
      parseDeviceBinding({ kind: 'axis', gamepadId: 'w', axis: 2, rest: -1, pressed: 1 }),
    ).toEqual({ kind: 'axis', gamepadId: 'w', axis: 2, rest: -1, pressed: 1 });
    expect(parseDeviceBinding({ kind: 'button', gamepadId: 'w', button: 3 })).toEqual({
      kind: 'button',
      gamepadId: 'w',
      button: 3,
    });
  });

  it('rejects malformed bindings rather than trusting them', () => {
    const bad: unknown[] = [
      null,
      42,
      'axis',
      { kind: 'axis', gamepadId: '', axis: 0, rest: 0, pressed: 1 },
      { kind: 'axis', gamepadId: 'w', axis: -1, rest: 0, pressed: 1 },
      { kind: 'axis', gamepadId: 'w', axis: 1.5, rest: 0, pressed: 1 },
      { kind: 'axis', gamepadId: 'w', axis: 0, rest: NaN, pressed: 1 },
      { kind: 'axis', gamepadId: 'w', axis: 0, rest: 0, pressed: Infinity },
      // A zero-width calibration would divide by ~0 on every poll.
      { kind: 'axis', gamepadId: 'w', axis: 0, rest: 0.5, pressed: 0.5 },
      { kind: 'button', gamepadId: 'w', button: -2 },
      { kind: 'button', gamepadId: 'w' },
      { kind: 'wheel', gamepadId: 'w', axis: 0 },
    ];
    for (const value of bad) expect(parseDeviceBinding(value)).toBeUndefined();
  });

  it('falls back to defaults for anything unusable', () => {
    expect(parseBindings(null)).toEqual(defaultBindings());
    expect(parseBindings('garbage')).toEqual(defaultBindings());
    expect(parseBindings({ actions: { starter: 'nope' } })).toEqual(defaultBindings());
  });

  it('keeps valid entries while discarding invalid neighbours', () => {
    const parsed = parseBindings({
      version: 2,
      actions: {
        starter: { key: 'b', device: { kind: 'button', gamepadId: 'Wheel', button: 4 } },
        ignition: { key: 'z', device: { kind: 'axis', gamepadId: 'Wheel', axis: 0, rest: 0, pressed: 0 } },
      },
    });

    expect(parsed.starter.key).toBe('b');
    expect(parsed.starter.device).toEqual({ kind: 'button', gamepadId: 'Wheel', button: 4 });
    // The zero-width axis is dropped, but the key beside it survives.
    expect(parsed.ignition.key).toBe('z');
    expect(parsed.ignition.device).toBeUndefined();
    // Untouched actions keep their defaults.
    expect(parsed.dyno.key).toBe('d');
  });

  it('treats an explicitly cleared key as cleared, not missing', () => {
    const parsed = parseBindings({ actions: { dyno: { key: null } } });
    expect(parsed.dyno.key).toBeUndefined();
  });

  it('migrates the pedal-only format that shipped first', () => {
    const migrated = migrateLegacy({
      throttle: { kind: 'axis', gamepadId: 'Pedals', axis: 1, rest: -1, pressed: 1 },
      gearUp: { kind: 'button', gamepadId: 'Pedals', button: 4 },
      clutch: { kind: 'axis', gamepadId: 'Pedals', axis: 9, rest: 0, pressed: 0 },
    });

    expect(migrated.throttle?.device).toEqual({
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 1,
      rest: -1,
      pressed: 1,
    });
    expect(migrated.throttle?.key).toBe('r');
    expect(migrated.gearUp?.device).toEqual({ kind: 'button', gamepadId: 'Pedals', button: 4 });
    // Degenerate calibration is dropped rather than migrated.
    expect(migrated.clutch).toBeUndefined();
  });
});

describe('binding store', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const first = new BindingStore(storage);
    first.setKey('starter', 'b');
    first.setDevice('ignition', { kind: 'button', gamepadId: 'Wheel', button: 7 });

    const second = new BindingStore(storage);
    expect(second.get('starter').key).toBe('b');
    expect(second.get('ignition').device).toEqual({
      kind: 'button',
      gamepadId: 'Wheel',
      button: 7,
    });
  });

  it('loads and rewrites legacy pedal bindings on first run', () => {
    const storage = fakeStorage({
      'engine-sim-pedals': JSON.stringify({
        throttle: { kind: 'axis', gamepadId: 'Pedals', axis: 2, rest: 1, pressed: -1 },
      }),
    });

    const store = new BindingStore(storage);
    expect(store.get('throttle').device).toEqual({
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 2,
      rest: 1,
      pressed: -1,
    });
    // The migration is persisted under the new key.
    expect(storage.getItem('engine-sim-bindings')).not.toBeNull();
  });

  it('survives corrupt stored JSON', () => {
    const store = new BindingStore(fakeStorage({ 'engine-sim-bindings': '{not json' }));
    expect(store.get('starter').key).toBe('s');
  });

  it('keeps working in memory when storage refuses writes', () => {
    const store = new BindingStore(hostileStorage());
    store.setKey('starter', 'b');
    expect(store.get('starter').key).toBe('b');
    expect(store.persistent).toBe(false);
  });

  it('reports no storage at all as non-persistent', () => {
    const store = new BindingStore(null);
    expect(store.persistent).toBe(false);
    expect(store.get('ignition').key).toBe('a');
  });

  it('gives a key to only one action at a time', () => {
    const store = new BindingStore(fakeStorage());
    // 'a' is the ignition default; stealing it must clear ignition.
    store.setKey('dyno', 'a');
    expect(store.get('dyno').key).toBe('a');
    expect(store.get('ignition').key).toBeUndefined();
    expect(store.actionForKey('a')).toBe('dyno');
  });

  it('gives a controller input to only one action at a time', () => {
    const store = new BindingStore(fakeStorage());
    const button = { kind: 'button', gamepadId: 'Wheel', button: 2 } as const;
    store.setDevice('gearUp', button);
    store.setDevice('gearDown', { ...button });
    expect(store.get('gearUp').device).toBeUndefined();
    expect(store.get('gearDown').device).toEqual(button);
  });

  it('resets every action back to its default key', () => {
    const store = new BindingStore(fakeStorage());
    store.setKey('starter', 'b');
    store.setDevice('starter', { kind: 'button', gamepadId: 'W', button: 1 });
    store.resetAll();
    expect(store.get('starter').key).toBe('s');
    expect(store.get('starter').device).toBeUndefined();
  });

  it('has a default key for every catalogued action', () => {
    const store = new BindingStore(null);
    for (const action of ACTIONS) {
      expect(store.get(action.id).key).toBe(action.defaultKey);
    }
  });
});

describe('display', () => {
  it('names keys the way a keyboard does', () => {
    expect(formatKey('a')).toBe('A');
    expect(formatKey(' ')).toBe('Space');
    expect(formatKey('ArrowUp')).toBe('↑');
    expect(formatKey('Shift')).toBe('Shift');
    expect(formatKey(undefined)).toBe('unbound');
  });

  it('names controller inputs and truncates long device ids', () => {
    expect(formatDevice(undefined)).toBe('unbound');
    expect(formatDevice({ kind: 'button', gamepadId: 'Wheel', button: 3 })).toBe(
      'Button 3 · Wheel',
    );
    const long = formatDevice({
      kind: 'axis',
      gamepadId: 'Logitech G29 Driving Force Racing Wheel',
      axis: 2,
      rest: 0,
      pressed: 1,
    });
    expect(long.startsWith('Axis 2 · Logitech G29')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });

  it('compares device identity by kind, device and index', () => {
    const a = { kind: 'button', gamepadId: 'W', button: 1 } as const;
    expect(sameDevice(a, { ...a })).toBe(true);
    expect(sameDevice(a, { ...a, button: 2 })).toBe(false);
    expect(sameDevice(a, { ...a, gamepadId: 'X' })).toBe(false);
    expect(sameDevice(a, undefined)).toBe(false);
    expect(
      sameDevice(a, { kind: 'axis', gamepadId: 'W', axis: 1, rest: 0, pressed: 1 }),
    ).toBe(false);
  });
});
