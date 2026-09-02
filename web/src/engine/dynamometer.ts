/** Ported from `include/dynamometer.h` / `src/dynamometer.cpp`. */
import * as units from '../core/units';
import { Constraint, type ConstraintOutput, MAX_BODY_COUNT } from '../physics/constraint';
import type { SystemState } from '../physics/systemState';
import type { Crankshaft } from './crankshaft';

export class Dynamometer extends Constraint {
  rotationSpeed = 0.0;
  ks = 10.0;
  kd = 1.0;
  maxTorque = units.torque(10000.0, units.ft_lb);

  hold = false;
  enabled = false;

  constructor() {
    super(1, 1);
  }

  connectCrankshaft(crankshaft: Crankshaft): void {
    this.bodies[0] = crankshaft.body;
  }

  override calculate(output: ConstraintOutput, _state: SystemState): void {
    output.J[0] = 0;
    output.J[1] = 0;
    output.J[2] = 1;

    output.J_dot[0] = 0;
    output.J_dot[1] = 0;
    output.J_dot[2] = 0;

    output.ks[0] = this.ks;
    output.kd[0] = this.kd;
    output.C[0] = 0;

    if (this.bodies[0]!.v_theta < 0) {
      output.v_bias[0] = this.rotationSpeed;
      output.limits[0] = this.hold && this.enabled ? -this.maxTorque : 0.0;
      output.limits[1] = this.enabled ? this.maxTorque : 0.0;
    } else {
      output.v_bias[0] = -this.rotationSpeed;
      output.limits[0] = this.enabled ? -this.maxTorque : 0.0;
      output.limits[1] = this.hold && this.enabled ? this.maxTorque : 0.0;
    }
  }

  getTorque(): number {
    const F_t = this.F_t[0 * MAX_BODY_COUNT + 0];
    return this.bodies[0]!.v_theta > 0 ? -F_t : F_t;
  }
}
