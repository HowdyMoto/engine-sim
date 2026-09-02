/** Pins a local point on a body to a world position (`fixed_position_constraint.cpp`). */
import { Constraint, type ConstraintOutput } from '../constraint';
import type { SystemState } from '../systemState';

export class FixedPositionConstraint extends Constraint {
  local_x = 0;
  local_y = 0;
  world_x = 0;
  world_y = 0;
  ks = 10.0;
  kd = 1.0;

  constructor() {
    super(2, 1);
  }

  setWorldPosition(x: number, y: number): void {
    this.world_x = x;
    this.world_y = y;
  }

  setLocalPosition(x: number, y: number): void {
    this.local_x = x;
    this.local_y = y;
  }

  override calculate(output: ConstraintOutput, state: SystemState): void {
    const body = this.bodies[0]!.index;

    const q1 = state.p_x[body];
    const q2 = state.p_y[body];
    const q3 = state.theta[body];
    const q3_dot = state.v_theta[body];

    const cos_q3 = Math.cos(q3);
    const sin_q3 = Math.sin(q3);

    const current_x = q1 + cos_q3 * this.local_x - sin_q3 * this.local_y;
    const current_y = q2 + sin_q3 * this.local_x + cos_q3 * this.local_y;

    const J = output.J;
    const J_dot = output.J_dot;

    J[0] = 1.0;
    J[1] = 0.0;
    J[2] = -sin_q3 * this.local_x - cos_q3 * this.local_y;

    J[6] = 0.0;
    J[7] = 1.0;
    J[8] = cos_q3 * this.local_x - sin_q3 * this.local_y;

    J_dot[0] = 0;
    J_dot[1] = 0;
    J_dot[2] = -cos_q3 * q3_dot * this.local_x + sin_q3 * q3_dot * this.local_y;

    J_dot[6] = 0;
    J_dot[7] = 0;
    J_dot[8] = -sin_q3 * q3_dot * this.local_x - cos_q3 * q3_dot * this.local_y;

    output.ks[0] = output.ks[1] = this.ks;
    output.kd[0] = output.kd[1] = this.kd;

    output.C[0] = current_x - this.world_x;
    output.C[1] = current_y - this.world_y;

    output.v_bias[0] = 0;
    output.v_bias[1] = 0;

    this.noLimits(output);
  }
}
