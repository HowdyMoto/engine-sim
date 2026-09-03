/** Ported from `include/camshaft.h` / `src/camshaft.cpp`. */
import { PI } from '../core/constants';
import * as units from '../core/units';
import type { Func } from '../core/function';
import type { Crankshaft } from './crankshaft';

export interface CamshaftParameters {
  lobes: number;
  /** Camshaft advance, in camshaft radians. */
  advance?: number;
  crankshaft: Crankshaft;
  lobeProfile: Func;
  baseRadius?: number;
}

export class Camshaft {
  private crankshaft: Crankshaft | null = null;
  private lobeProfile: Func | null = null;
  private lobeAngles: Float64Array = new Float64Array(0);
  private advance = 0;
  private baseRadius = 0;
  private lobes = 0;

  initialize(params: CamshaftParameters): void {
    this.lobeAngles = new Float64Array(Math.max(params.lobes, 1));
    this.lobes = params.lobes;
    this.crankshaft = params.crankshaft;
    this.lobeProfile = params.lobeProfile;
    this.advance = params.advance ?? 0;
    this.baseRadius = params.baseRadius ?? units.distance(600, units.thou);
  }

  valveLift(lobe: number): number {
    return this.sampleLobe(this.getAngle() + this.lobeAngles[lobe]);
  }

  /**
   * Cam-local angle for a lobe, in [0, 2pi): 0 is the lobe tip on the
   * follower (maximum lift). Drives the rendered cam rotation.
   */
  lobePhase(lobe: number): number {
    const phase = (this.getAngle() + this.lobeAngles[lobe]) % (2 * PI);
    return phase < 0 ? phase + 2 * PI : phase;
  }

  /** Peak lift of the lobe profile, for scaling drawn valve travel. */
  peakLift(): number {
    let peak = 0;
    for (let i = 0; i < 256; ++i) {
      const lift = this.sampleLobe(-PI + (i / 256) * 2 * PI);
      if (lift > peak) peak = lift;
    }
    return peak;
  }

  sampleLobe(theta: number): number {
    let clampedTheta = theta % (2 * PI);
    if (clampedTheta < 0) clampedTheta += 2 * PI;
    if (clampedTheta >= PI) clampedTheta -= 2 * PI;

    return this.lobeProfile!.sampleTriangle(clampedTheta);
  }

  /** Lobe centrelines are given in crank degrees; the cam turns at half speed. */
  setLobeCenterline(lobe: number, crankAngle: number): void {
    this.lobeAngles[lobe] = crankAngle / 2;
  }

  getLobeCenterline(lobe: number): number {
    return this.lobeAngles[lobe];
  }

  getAngle(): number {
    const angle = ((this.crankshaft!.getAngle() + this.advance) * 0.5) % (2 * PI);
    return angle < 0 ? angle + 2 * PI : angle;
  }

  getLobeCount(): number {
    return this.lobes;
  }

  getLobeProfile(): Func {
    return this.lobeProfile!;
  }

  getAdvance(): number {
    return this.advance;
  }

  getBaseRadius(): number {
    return this.baseRadius;
  }
}
