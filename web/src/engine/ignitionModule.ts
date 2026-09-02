/** Ported from `include/ignition_module.h` / `src/ignition_module.cpp`. */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { positiveMod } from '../core/utilities';
import type { Func } from '../core/function';
import type { Crankshaft } from './crankshaft';

export interface IgnitionModuleParameters {
  cylinderCount: number;
  crankshaft: Crankshaft;
  timingCurve: Func;
  revLimit?: number;
  limiterDuration?: number;
}

interface SparkPlug {
  angle: number;
  ignitionEvent: boolean;
  enabled: boolean;
}

export class IgnitionModule {
  enabled = false;

  private timingCurve: Func | null = null;
  private plugs: SparkPlug[] = [];
  private crankshaft: Crankshaft | null = null;
  private cylinderCount = 0;

  private lastCrankshaftAngle = 0.0;
  private revLimit = units.rpm(6000.0);
  private revLimitTimer = 0.0;
  private limiterDuration = 0.5 * units.sec;

  initialize(params: IgnitionModuleParameters): void {
    this.cylinderCount = params.cylinderCount;
    this.plugs = [];
    for (let i = 0; i < this.cylinderCount; ++i) {
      this.plugs.push({ angle: 0, ignitionEvent: false, enabled: false });
    }
    this.crankshaft = params.crankshaft;
    this.timingCurve = params.timingCurve;
    this.revLimit = params.revLimit ?? this.revLimit;
    this.limiterDuration = params.limiterDuration ?? this.limiterDuration;
  }

  /** Fire cylinder `cylinderIndex` at `angle` radians into the four-stroke cycle. */
  setFiringOrder(cylinderIndex: number, angle: number): void {
    this.plugs[cylinderIndex].angle = angle;
    this.plugs[cylinderIndex].enabled = true;
  }

  reset(): void {
    this.lastCrankshaftAngle = this.crankshaft!.getCycleAngle();
    this.resetIgnitionEvents();
  }

  update(dt: number): void {
    const cycleAngle = this.crankshaft!.getCycleAngle();

    if (this.enabled && this.revLimitTimer === 0) {
      const fourPi = 4 * PI;
      const advance = this.getTimingAdvance();

      for (let i = 0; i < this.cylinderCount; ++i) {
        let adjustedAngle = positiveMod(this.plugs[i].angle - advance, fourPi);
        const r0 = this.lastCrankshaftAngle;
        let r1 = cycleAngle;

        if (this.crankshaft!.body.v_theta < 0) {
          if (r1 < r0) {
            r1 += fourPi;
            adjustedAngle += fourPi;
          }

          if (adjustedAngle >= r0 && adjustedAngle < r1) {
            this.plugs[i].ignitionEvent = this.plugs[i].enabled;
          }
        } else {
          if (r1 > r0) {
            r1 -= fourPi;
            adjustedAngle -= fourPi;
          }

          if (adjustedAngle >= r1 && adjustedAngle < r0) {
            this.plugs[i].ignitionEvent = this.plugs[i].enabled;
          }
        }
      }
    }

    this.revLimitTimer -= dt;
    if (Math.abs(this.crankshaft!.body.v_theta) > this.revLimit) {
      this.revLimitTimer = this.limiterDuration;
    }

    if (this.revLimitTimer < 0) this.revLimitTimer = 0;

    this.lastCrankshaftAngle = cycleAngle;
  }

  getIgnitionEvent(index: number): boolean {
    return this.plugs[index].ignitionEvent;
  }

  resetIgnitionEvents(): void {
    for (let i = 0; i < this.cylinderCount; ++i) {
      this.plugs[i].ignitionEvent = false;
    }
  }

  getFiringAngle(index: number): number {
    return this.plugs[index].angle;
  }

  getTimingAdvance(): number {
    return this.timingCurve!.sampleTriangle(-this.crankshaft!.body.v_theta);
  }

  isRevLimiterActive(): boolean {
    return this.revLimitTimer > 0;
  }

  getRevLimit(): number {
    return this.revLimit;
  }
}
