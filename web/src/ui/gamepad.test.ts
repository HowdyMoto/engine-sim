import { describe, expect, it } from 'vitest';

import { GamepadInput, mapAxis, widenAxis } from './gamepad';
import type { AxisBinding, PadLike } from './gamepad';

function makePad(id: string, axes: number[], pressed: boolean[] = []): PadLike {
  return { id, axes, buttons: pressed.map((p) => ({ pressed: p })) };
}

describe('axis calibration', () => {
  it('maps a rest-to-plus pedal', () => {
    const binding: AxisBinding = { kind: 'axis', gamepadId: 'p', axis: 0, rest: -1, pressed: 1 };
    expect(mapAxis(binding, -1)).toBe(0);
    expect(mapAxis(binding, 0)).toBeCloseTo(0.5);
    expect(mapAxis(binding, 1)).toBe(1);
  });

  it('maps an inverted pedal (rests at +1, presses to -1)', () => {
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

describe('capture', () => {
  it('binds the axis that moves the most', () => {
    const pad = makePad('Fanatec CSL', [0, -1, -1]);
    const input = new GamepadInput(() => [pad]);

    let done = false;
    input.startCapture('throttle', () => {
      done = true;
    });
    input.poll();
    expect(done).toBe(false);

    // Jiggle a different axis a little, press the real pedal a lot.
    pad.axes = [0.1, -0.2, -1];
    input.poll();
    expect(done).toBe(true);

    const binding = input.bindings.throttle!;
    expect(binding.axis).toBe(1);
    expect(binding.rest).toBe(-1);
    expect(binding.pressed).toBe(-0.2);
  });

  it('binds the first pressed button for gear shifts', () => {
    const pad = makePad('Wheel', [0], [false, false, false]);
    const input = new GamepadInput(() => [pad]);

    input.startCapture('gearUp', () => {});
    input.poll();
    expect(input.bindings.gearUp).toBeUndefined();

    pad.buttons = [{ pressed: false }, { pressed: true }, { pressed: false }];
    input.poll();
    expect(input.bindings.gearUp).toEqual({ kind: 'button', gamepadId: 'Wheel', button: 1 });
  });
});

describe('polling', () => {
  it('reports pedal travel and rising gear edges', () => {
    const pad = makePad('Pedals', [0, -1], [false]);
    const input = new GamepadInput(() => [pad]);
    input.bindings = {
      throttle: { kind: 'axis', gamepadId: 'Pedals', axis: 1, rest: -1, pressed: 1 },
      gearUp: { kind: 'button', gamepadId: 'Pedals', button: 0 },
    };

    let state = input.poll();
    expect(state.connected).toBe(true);
    expect(state.throttle).toBe(0);
    expect(state.clutch).toBeNull();
    expect(state.gearUp).toBe(false);

    pad.axes = [0, 0.5];
    pad.buttons = [{ pressed: true }];
    state = input.poll();
    expect(state.throttle).toBeCloseTo(0.75);
    expect(state.gearUp).toBe(true);

    // Held button must not repeat the edge.
    state = input.poll();
    expect(state.gearUp).toBe(false);

    pad.buttons = [{ pressed: false }];
    input.poll();
    pad.buttons = [{ pressed: true }];
    state = input.poll();
    expect(state.gearUp).toBe(true);
  });

  it('returns null travel when the bound pad is disconnected', () => {
    let present: PadLike | null = makePad('Pedals', [0.4]);
    const input = new GamepadInput(() => [present]);
    input.bindings = {
      throttle: { kind: 'axis', gamepadId: 'Pedals', axis: 0, rest: 0, pressed: 1 },
    };

    expect(input.poll().throttle).toBeCloseTo(0.4);

    present = null;
    const state = input.poll();
    expect(state.throttle).toBeNull();
    expect(state.connected).toBe(false);
  });

  it('keeps calibrating as the pedal travels past the captured range', () => {
    const pad = makePad('Pedals', [0.5]);
    const input = new GamepadInput(() => [pad]);
    input.bindings = {
      throttle: { kind: 'axis', gamepadId: 'Pedals', axis: 0, rest: 0, pressed: 0.5 },
    };

    expect(input.poll().throttle).toBe(1);
    pad.axes = [1.0];
    expect(input.poll().throttle).toBe(1);
    expect(input.bindings.throttle!.pressed).toBe(1);
    pad.axes = [0.5];
    expect(input.poll().throttle).toBeCloseTo(0.5);
  });
});
