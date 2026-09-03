import { describe, expect, it } from 'vitest';

import { BindingStore } from './bindings';
import { GamepadInput } from './gamepad';
import type { PadLike } from './gamepad';

function makePad(id: string, axes: number[], pressed: boolean[] = []): PadLike {
  return { id, axes, buttons: pressed.map((p) => ({ pressed: p })) };
}

/** A store with no persistence, so tests never touch real storage. */
function store(): BindingStore {
  return new BindingStore(null);
}

describe('capture', () => {
  it('binds the axis that moves the most', () => {
    const pad = makePad('Fanatec CSL', [0, -1, -1]);
    const bindings = store();
    const input = new GamepadInput(bindings, () => [pad]);

    let done = false;
    input.startCapture('throttle', () => {
      done = true;
    });
    input.poll();
    expect(done).toBe(false);

    // Jiggle one axis a little, press the real pedal a lot.
    pad.axes = [0.1, -0.2, -1];
    input.poll();
    expect(done).toBe(true);

    const binding = bindings.get('throttle').device;
    expect(binding).toEqual({
      kind: 'axis',
      gamepadId: 'Fanatec CSL',
      axis: 1,
      rest: -1,
      pressed: -0.2,
    });
  });

  it('binds a newly pressed button', () => {
    const pad = makePad('Wheel', [0], [false, false, false]);
    const bindings = store();
    const input = new GamepadInput(bindings, () => [pad]);

    input.startCapture('gearUp', () => {});
    input.poll();
    expect(bindings.get('gearUp').device).toBeUndefined();

    pad.buttons = [{ pressed: false }, { pressed: true }, { pressed: false }];
    input.poll();
    expect(bindings.get('gearUp').device).toEqual({
      kind: 'button',
      gamepadId: 'Wheel',
      button: 1,
    });
  });

  it('ignores a button already held when capture started', () => {
    // Several wheels report a permanently-pressed calibration button, which
    // would otherwise be bound the instant Bind is clicked.
    const pad = makePad('Wheel', [0], [true, false]);
    const bindings = store();
    const input = new GamepadInput(bindings, () => [pad]);

    input.startCapture('starter', () => {});
    input.poll();
    expect(bindings.get('starter').device).toBeUndefined();

    pad.buttons = [{ pressed: true }, { pressed: true }];
    input.poll();
    expect(bindings.get('starter').device).toEqual({
      kind: 'button',
      gamepadId: 'Wheel',
      button: 1,
    });
  });

  it('does not bind a device that appears mid-capture until it moves', () => {
    let pad: PadLike | null = null;
    const bindings = store();
    const input = new GamepadInput(bindings, () => [pad]);

    input.startCapture('ignition', () => {});
    input.poll();

    // Waking a pad by pressing it must not bind that very press.
    pad = makePad('Late', [0], [true]);
    input.poll();
    expect(bindings.get('ignition').device).toBeUndefined();

    pad = makePad('Late', [0], [false]);
    input.poll();
    pad = makePad('Late', [0], [true]);
    input.poll();
    expect(bindings.get('ignition').device).toEqual({
      kind: 'button',
      gamepadId: 'Late',
      button: 0,
    });
  });

  it('cancels cleanly', () => {
    const pad = makePad('Wheel', [0], [false]);
    const bindings = store();
    const input = new GamepadInput(bindings, () => [pad]);

    input.startCapture('dyno', () => {});
    expect(input.capturing).toBe('dyno');
    input.cancelCapture();
    expect(input.capturing).toBeNull();

    pad.buttons = [{ pressed: true }];
    input.poll();
    expect(bindings.get('dyno').device).toBeUndefined();
  });
});

describe('polling', () => {
  it('reports pedal travel and rising edges', () => {
    const pad = makePad('Pedals', [0, -1], [false]);
    const bindings = store();
    bindings.setDevice('throttle', {
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 1,
      rest: -1,
      pressed: 1,
    });
    bindings.setDevice('gearUp', { kind: 'button', gamepadId: 'Pedals', button: 0 });
    const input = new GamepadInput(bindings, () => [pad]);

    let state = input.poll();
    expect(state.connected).toBe(true);
    expect(state.throttle).toBe(0);
    expect(state.clutch).toBeNull();
    expect(state.pressed.gearUp).toBe(false);

    pad.axes = [0, 0.5];
    pad.buttons = [{ pressed: true }];
    state = input.poll();
    expect(state.throttle).toBeCloseTo(0.75);
    expect(state.pressed.gearUp).toBe(true);
    expect(state.held.gearUp).toBe(true);

    // A held button must not repeat the edge.
    state = input.poll();
    expect(state.pressed.gearUp).toBe(false);
    expect(state.held.gearUp).toBe(true);

    pad.buttons = [{ pressed: false }];
    input.poll();
    pad.buttons = [{ pressed: true }];
    state = input.poll();
    expect(state.pressed.gearUp).toBe(true);
  });

  it('holds the starter for as long as its button is down', () => {
    const pad = makePad('Wheel', [0], [false]);
    const bindings = store();
    bindings.setDevice('starter', { kind: 'button', gamepadId: 'Wheel', button: 0 });
    const input = new GamepadInput(bindings, () => [pad]);

    expect(input.poll().held.starter).toBe(false);
    pad.buttons = [{ pressed: true }];
    expect(input.poll().held.starter).toBe(true);
    expect(input.poll().held.starter).toBe(true);
    pad.buttons = [{ pressed: false }];
    expect(input.poll().held.starter).toBe(false);
  });

  it('drives an on/off action from a pedal axis past half travel', () => {
    const pad = makePad('Pedals', [0]);
    const bindings = store();
    bindings.setDevice('ignition', {
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 0,
      rest: 0,
      pressed: 1,
    });
    const input = new GamepadInput(bindings, () => [pad]);

    expect(input.poll().held.ignition).toBe(false);
    pad.axes = [0.8];
    const state = input.poll();
    expect(state.held.ignition).toBe(true);
    expect(state.pressed.ignition).toBe(true);
  });

  it('returns null travel when the bound device is disconnected', () => {
    let present: PadLike | null = makePad('Pedals', [0.4]);
    const bindings = store();
    bindings.setDevice('throttle', {
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 0,
      rest: 0,
      pressed: 1,
    });
    const input = new GamepadInput(bindings, () => [present]);

    expect(input.poll().throttle).toBeCloseTo(0.4);

    present = null;
    const state = input.poll();
    expect(state.throttle).toBeNull();
    expect(state.connected).toBe(false);
  });

  it('does not fire a stale edge when a device reconnects still pressed', () => {
    let present: PadLike | null = makePad('Wheel', [0], [true]);
    const bindings = store();
    bindings.setDevice('gearUp', { kind: 'button', gamepadId: 'Wheel', button: 0 });
    const input = new GamepadInput(bindings, () => [present]);

    expect(input.poll().pressed.gearUp).toBe(true);
    present = null;
    input.poll();

    // Coming back already-pressed reads as a fresh press, which is the only
    // safe reading: the release was never observed.
    present = makePad('Wheel', [0], [true]);
    expect(input.poll().pressed.gearUp).toBe(true);
  });

  it('keeps calibrating as the pedal travels past the captured range', () => {
    const pad = makePad('Pedals', [0.5]);
    const bindings = store();
    bindings.setDevice('throttle', {
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 0,
      rest: 0,
      pressed: 0.5,
    });
    const input = new GamepadInput(bindings, () => [pad]);

    expect(input.poll().throttle).toBe(1);
    pad.axes = [1.0];
    expect(input.poll().throttle).toBe(1);
    expect(bindings.get('throttle').device).toMatchObject({ pressed: 1 });
    pad.axes = [0.5];
    expect(input.poll().throttle).toBeCloseTo(0.5);
  });

  it('ignores a non-finite axis reading rather than poisoning the calibration', () => {
    const pad = makePad('Pedals', [Number.NaN]);
    const bindings = store();
    bindings.setDevice('throttle', {
      kind: 'axis',
      gamepadId: 'Pedals',
      axis: 0,
      rest: 0,
      pressed: 1,
    });
    const input = new GamepadInput(bindings, () => [pad]);

    expect(input.poll().throttle).toBeNull();
    expect(bindings.get('throttle').device).toMatchObject({ rest: 0, pressed: 1 });
  });

  it('reports nothing for unbound actions', () => {
    const input = new GamepadInput(store(), () => [makePad('Wheel', [1], [true])]);
    const state = input.poll();
    expect(state.throttle).toBeNull();
    expect(state.held.starter).toBe(false);
    expect(state.pressed.ignition).toBe(false);
  });
});
