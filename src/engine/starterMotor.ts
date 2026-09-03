/** Ported from `include/starter_motor.h` / `src/starter_motor.cpp`. */
import * as units from '../core/units';
import { Constraint, type ConstraintOutput } from '../physics/constraint';
import type { SystemState } from '../physics/systemState';
import type { Crankshaft } from './crankshaft';

export class StarterMotor extends Constraint {
  ks = 10.0;
  kd = 1.0;
  maxTorque = units.torque(80.0, units.ft_lb);
  rotationSpeed = -units.rpm(200.0);
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

    output.v_bias[0] = -this.rotationSpeed;

    if (this.rotationSpeed < 0) {
      output.limits[0] = this.enabled ? -this.maxTorque : 0.0;
      output.limits[1] = 0.0;
    } else {
      output.limits[0] = 0.0;
      output.limits[1] = this.enabled ? this.maxTorque : 0.0;
    }
  }
}
