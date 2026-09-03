/** Torque-limited rotational damping on a single body (`rotation_friction_constraint.cpp`). */
import { Constraint, type ConstraintOutput } from '../constraint';
import type { SystemState } from '../systemState';

export class RotationFrictionConstraint extends Constraint {
  ks = 10.0;
  kd = 1.0;
  maxTorque = Number.MAX_VALUE;
  minTorque = -Number.MAX_VALUE;

  constructor() {
    super(1, 1);
  }

  override calculate(output: ConstraintOutput, _state: SystemState): void {
    output.C[0] = 0;

    output.J[0] = 0.0;
    output.J[1] = 0.0;
    output.J[2] = 1.0;

    output.J_dot[0] = 0;
    output.J_dot[1] = 0;
    output.J_dot[2] = 0;

    output.kd[0] = this.kd;
    output.ks[0] = this.ks;
    output.v_bias[0] = 0;

    output.limits[0] = this.minTorque;
    output.limits[1] = this.maxTorque;
  }
}
