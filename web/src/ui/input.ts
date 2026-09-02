/**
 * Keyboard and mouse handling, matching the original's control scheme
 * (see the key table in the project README).
 */
import { clamp } from '../core/utilities';

export type Modifier = 'z' | 'x' | 'c' | 'v' | 'b' | 'n' | 'g' | ' ';

export interface InputEvents {
  onToggleIgnition(): void;
  onToggleDyno(): void;
  onToggleHold(): void;
  onGearUp(): void;
  onGearDown(): void;
  onLayerUp(): void;
  onLayerDown(): void;
  onTimeWarp(factor: number): void;
  onScroll(modifier: Modifier | null, delta: number): void;
  onToggleFullscreen(): void;
  onTogglePause(): void;
  onToggleHelp(): void;
}

export class InputController {
  private held = new Set<string>();

  /** Smoothed speed control, matching the original's 0.5 blend per frame. */
  speedSetting = 0;
  private targetSpeedSetting = 0;

  /** Clutch pressure, 1 = fully engaged. */
  clutchPressure = 1;
  private targetClutchPressure = 1;

  constructor(
    private target: HTMLElement,
    private events: InputEvents,
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

  get starterHeld(): boolean {
    return this.held.has('s');
  }

  private activeModifier(): Modifier | null {
    for (const key of ['z', 'x', 'c', 'v', 'b', 'n', 'g', ' '] as Modifier[]) {
      if (this.held.has(key)) return key;
    }
    return null;
  }

  private handleBlur = (): void => {
    this.held.clear();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // Repeats only matter for held keys, which we track separately.
    if (event.repeat) return;

    this.held.add(key);
    if (event.shiftKey) this.held.add('Shift');

    switch (key) {
      case 'a':
        this.events.onToggleIgnition();
        break;
      case 'd':
        this.events.onToggleDyno();
        break;
      case 'h':
        this.events.onToggleHold();
        break;
      case 'ArrowUp':
        this.events.onGearUp();
        event.preventDefault();
        break;
      case 'ArrowDown':
        this.events.onGearDown();
        event.preventDefault();
        break;
      case 'm':
        this.events.onLayerUp();
        break;
      case ',':
        this.events.onLayerDown();
        break;
      case 'f':
        this.events.onToggleFullscreen();
        break;
      case 'p':
        this.events.onTogglePause();
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
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    this.held.delete(key);
    if (!event.shiftKey) this.held.delete('Shift');
  };

  private handleWheel = (event: WheelEvent): void => {
    const modifier = this.activeModifier();
    if (modifier !== null) event.preventDefault();
    this.events.onScroll(modifier, -event.deltaY);
  };

  /**
   * Advance the analogue controls. Mirrors `EngineSimApplication::processEngineInput`:
   * Q/W/E/R select throttle presets, Space enables fine adjustment, Shift is the
   * clutch and Space slows clutch engagement.
   */
  update(dt: number): { speedControl: number; clutchPressure: number } {
    const fineControl = this.held.has(' ');

    if (!fineControl) this.targetSpeedSetting = 0;

    if (this.held.has('q')) this.targetSpeedSetting = 0.01;
    else if (this.held.has('w')) this.targetSpeedSetting = 0.1;
    else if (this.held.has('e')) this.targetSpeedSetting = 0.2;
    else if (this.held.has('r')) this.targetSpeedSetting = 1.0;

    this.speedSetting = this.targetSpeedSetting * 0.5 + 0.5 * this.speedSetting;

    if (this.held.has('t')) this.targetClutchPressure -= 0.2 * dt;
    else if (this.held.has('u')) this.targetClutchPressure += 0.2 * dt;
    else if (this.held.has('Shift')) this.targetClutchPressure = 0.0;
    else if (!this.held.has('y')) this.targetClutchPressure = 1.0;

    this.targetClutchPressure = clamp(this.targetClutchPressure);

    const clutchRc = this.held.has(' ') ? 1.0 : 0.001;
    const s = dt / (dt + clutchRc);
    this.clutchPressure = this.clutchPressure * (1 - s) + this.targetClutchPressure * s;

    return { speedControl: this.speedSetting, clutchPressure: this.clutchPressure };
  }

  /** Fine throttle adjustment via Space + scroll. */
  adjustSpeedSetting(delta: number): void {
    this.targetSpeedSetting = clamp(this.targetSpeedSetting + delta);
  }

  getTargetSpeedSetting(): number {
    return this.targetSpeedSetting;
  }
}
