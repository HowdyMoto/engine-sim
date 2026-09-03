/**
 * Keyboard and mouse handling.
 *
 * Every action in the binding catalogue resolves through the shared store, so
 * remapping a key in the bindings dialog takes effect here with no other
 * wiring. The rest - throttle presets, the scroll modifiers, time warp,
 * fullscreen and help - stay fixed, matching the original's control scheme.
 */
import { clamp } from '../core/utilities';
import type { BindingStore } from './bindings';

export type Modifier = 'z' | 'x' | 'c' | 'v' | 'b' | 'n' | 'g' | ' ';

export interface InputEvents {
  onToggleIgnition(): void;
  onToggleDyno(): void;
  onToggleHold(): void;
  onGearUp(): void;
  onGearDown(): void;
  onEnginePrev(): void;
  onEngineNext(): void;
  onLayerUp(): void;
  onLayerDown(): void;
  onTimeWarp(factor: number): void;
  onScroll(modifier: Modifier | null, delta: number): void;
  onToggleFullscreen(): void;
  onTogglePause(): void;
  onToggleHelp(): void;
}

/** Normalise a KeyboardEvent into the form bindings are stored in. */
export function normalizeKey(event: KeyboardEvent): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export class InputController {
  private held = new Set<string>();

  /** Smoothed speed control, matching the original's 0.5 blend per frame. */
  speedSetting = 0;

  /**
   * Persistent throttle position, set by the on-screen slider or Space+scroll.
   *
   * The original has no slider: Q/W/E are momentary and the throttle falls
   * back to zero on release unless Space is held. Keeping a base position lets
   * the slider hold a throttle open while the momentary keys still override it,
   * which is the same behaviour when the base is left at zero.
   */
  private baseSpeedSetting = 0;

  /** Throttle requested this frame, after momentary key overrides. */
  private targetSpeedSetting = 0;

  /** Clutch pressure, 1 = fully engaged. */
  clutchPressure = 1;
  private targetClutchPressure = 1;

  /** Set while the bindings dialog is waiting for a key. */
  private keyCapture: ((key: string | null) => void) | null = null;

  /**
   * While the bindings dialog is open, keys configure bindings rather than
   * drive the engine, so nothing here dispatches. Suspending clears the held
   * set too, or a key held as the dialog opened would stay applied.
   */
  private suspendedFlag = false;

  constructor(
    private target: HTMLElement,
    private events: InputEvents,
    private bindings: BindingStore,
  ) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    target.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.target.removeEventListener('wheel', this.handleWheel);
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /** True while the key bound to the starter is down. */
  get starterHeld(): boolean {
    const key = this.bindings.get('starter').key;
    return key !== undefined && this.held.has(key);
  }

  /**
   * Wait for one keypress and hand it back. Escape cancels, reporting null.
   * The captured key never reaches the normal action dispatch.
   */
  startKeyCapture(onDone: (key: string | null) => void): void {
    this.keyCapture = onDone;
  }

  cancelKeyCapture(): void {
    this.keyCapture = null;
  }

  set suspended(value: boolean) {
    this.suspendedFlag = value;
    if (value) this.held.clear();
  }

  get suspended(): boolean {
    return this.suspendedFlag;
  }

  get capturingKey(): boolean {
    return this.keyCapture !== null;
  }

  private activeModifier(): Modifier | null {
    for (const key of ['z', 'x', 'c', 'v', 'b', 'n', 'g', ' '] as Modifier[]) {
      if (this.held.has(key)) return key;
    }
    return null;
  }

  private handleBlur = (): void => {
    // Keys cannot be observed going up once focus is gone, so anything still
    // held would latch on forever - most visibly the starter.
    this.held.clear();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = normalizeKey(event);

    // Binding capture swallows the key entirely.
    if (this.keyCapture !== null) {
      event.preventDefault();
      event.stopPropagation();
      const done = this.keyCapture;
      this.keyCapture = null;
      done(key === 'Escape' ? null : key);
      return;
    }

    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    if (this.suspendedFlag) return;

    // Repeats only matter for held keys, which we track separately.
    if (event.repeat) return;

    this.held.add(key);
    if (event.shiftKey) this.held.add('Shift');

    // Bindable actions first, so a remapped key wins over the fixed defaults.
    const action = this.bindings.actionForKey(key);
    switch (action) {
      case 'ignition':
        this.events.onToggleIgnition();
        return;
      case 'dyno':
        this.events.onToggleDyno();
        return;
      case 'rpmHold':
        this.events.onToggleHold();
        return;
      case 'gearUp':
        this.events.onGearUp();
        event.preventDefault();
        return;
      case 'gearDown':
        this.events.onGearDown();
        event.preventDefault();
        return;
      case 'enginePrev':
        this.events.onEnginePrev();
        return;
      case 'engineNext':
        this.events.onEngineNext();
        return;
      case 'layerUp':
        this.events.onLayerUp();
        return;
      case 'layerDown':
        this.events.onLayerDown();
        return;
      case 'pause':
        this.events.onTogglePause();
        return;
      case 'throttle':
      case 'clutch':
      case 'starter':
        // Continuous: read from `held` in update().
        if (key === ' ') event.preventDefault();
        return;
      default:
        break;
    }

    switch (key) {
      case 'f':
        this.events.onToggleFullscreen();
        break;
      case '?':
      case '/':
        this.events.onToggleHelp();
        break;
      case '1':
        this.events.onTimeWarp(1.0);
        break;
      case '2':
        this.events.onTimeWarp(1 / 10);
        break;
      case '3':
        this.events.onTimeWarp(1 / 100);
        break;
      case '4':
        this.events.onTimeWarp(1 / 1000);
        break;
      case '5':
        this.events.onTimeWarp(1 / 10000);
        break;
      case ' ':
        event.preventDefault();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        // Unbound arrows would otherwise scroll the page.
        event.preventDefault();
        break;
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(normalizeKey(event));
    if (!event.shiftKey) this.held.delete('Shift');
  };

  private handleWheel = (event: WheelEvent): void => {
    const modifier = this.activeModifier();
    if (modifier !== null) event.preventDefault();
    this.events.onScroll(modifier, -event.deltaY);
  };

  private boundHeld(action: 'throttle' | 'clutch' | 'starter'): boolean {
    const key = this.bindings.get(action).key;
    return key !== undefined && this.held.has(key);
  }

  /**
   * Advance the analogue controls. Mirrors `EngineSimApplication::processEngineInput`:
   * Q/W/E and the bound throttle key select throttle presets, Space enables fine
   * adjustment, the bound clutch key disengages and Space slows re-engagement.
   */
  update(dt: number): { speedControl: number; clutchPressure: number } {
    let target = this.baseSpeedSetting;

    if (this.held.has('q')) target = 0.01;
    else if (this.held.has('w')) target = 0.1;
    else if (this.held.has('e')) target = 0.2;
    else if (this.boundHeld('throttle')) target = 1.0;

    this.targetSpeedSetting = target;
    this.speedSetting = target * 0.5 + 0.5 * this.speedSetting;

    if (this.held.has('t')) this.targetClutchPressure -= 0.2 * dt;
    else if (this.held.has('u')) this.targetClutchPressure += 0.2 * dt;
    else if (this.boundHeld('clutch')) this.targetClutchPressure = 0.0;
    else if (!this.held.has('y')) this.targetClutchPressure = 1.0;

    this.targetClutchPressure = clamp(this.targetClutchPressure);

    const clutchRc = this.held.has(' ') ? 1.0 : 0.001;
    const s = dt / (dt + clutchRc);
    this.clutchPressure = this.clutchPressure * (1 - s) + this.targetClutchPressure * s;

    return { speedControl: this.speedSetting, clutchPressure: this.clutchPressure };
  }

  /** Fine throttle adjustment via Space + scroll. */
  adjustSpeedSetting(delta: number): void {
    this.baseSpeedSetting = clamp(this.baseSpeedSetting + delta);
  }

  setBaseSpeedSetting(value: number): void {
    this.baseSpeedSetting = clamp(value);
  }

  getBaseSpeedSetting(): number {
    return this.baseSpeedSetting;
  }

  /** Throttle requested this frame, including any momentary key override. */
  getTargetSpeedSetting(): number {
    return this.targetSpeedSetting;
  }
}
