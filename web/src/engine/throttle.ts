/**
 * Throttle linkages, ported from `throttle.cpp`, `direct_throttle_linkage.cpp`
 * and `governor.cpp`.
 *
 * `setSpeedControl(s)` takes 0 (closed) to 1 (wide open); the engine's throttle
 * value is inverted (1 = closed), matching the original.
 */
import { clamp } from '../core/utilities';
import type { Engine } from './engine';

export abstract class Throttle {
  protected speedControl = 0;

  setSpeedControl(s: number): void {
    this.speedControl = s;
  }

  getSpeedControl(): number {
    return this.speedControl;
  }

  abstract update(dt: number, engine: Engine): void;
}

export class DirectThrottleLinkage extends Throttle {
  private throttlePosition = 1.0;

  constructor(private gamma = 1.0) {
    super();
  }

  override setSpeedControl(s: number): void {
    super.setSpeedControl(s);
    this.throttlePosition = 1 - Math.pow(s, this.gamma);
  }

  override update(_dt: number, engine: Engine): void {
    engine.setThrottle(this.throttlePosition);
  }
}

export interface GovernorParameters {
  minSpeed: number;
  maxSpeed: number;
  minVelocity: number;
  maxVelocity: number;
  k_s: number;
  k_d: number;
  gamma: number;
}

/** Mechanical flyweight governor, as used by the small-engine definitions. */
export class Governor extends Throttle {
  private minSpeed = 0;
  private maxSpeed = 0;
  private minVelocity = 0;
  private maxVelocity = 0;
  private k_s = 0;
  private k_d = 0;
  private gamma = 1.0;

  private targetSpeed = 0;
  private currentThrottle = 1.0;
  private velocity = 0.0;

  constructor(params: GovernorParameters) {
    super();
    this.minSpeed = params.minSpeed;
    this.maxSpeed = params.maxSpeed;
    this.minVelocity = params.minVelocity;
    this.maxVelocity = params.maxVelocity;
    this.k_s = params.k_s;
    this.k_d = params.k_d;
    this.gamma = params.gamma;
  }

  override setSpeedControl(s: number): void {
    super.setSpeedControl(s);
    this.targetSpeed = (1 - s) * this.minSpeed + s * this.maxSpeed;
  }

  override update(dt: number, engine: Engine): void {
    const currentSpeed = engine.getSpeed();
    const ds = this.targetSpeed * this.targetSpeed - currentSpeed * currentSpeed;

    this.velocity += dt * -ds * this.k_s - this.velocity * dt * this.k_d;
    this.velocity = clamp(this.velocity, this.minVelocity, this.maxVelocity);

    if (Math.abs(currentSpeed) < Math.abs(0.5 * this.minSpeed)) {
      this.velocity = 0;
      this.currentThrottle = 1.0;
    }

    this.currentThrottle += this.velocity * dt;
    this.currentThrottle = clamp(this.currentThrottle);

    engine.setThrottle(1 - Math.pow(1 - this.currentThrottle, this.gamma));
  }
}
