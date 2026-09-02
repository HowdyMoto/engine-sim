/** Confines a local point on a body to a line (`line_constraint.cpp`). */
import { Constraint, type ConstraintOutput } from '../constraint';
import type { SystemState } from '../systemState';

export class LineConstraint extends Constraint {
  local_x = 0;
  local_y = 0;
  p0_x = 0;
  p0_y = 0;
  dx = 0;
  dy = 0;
  ks = 10.0;
  kd = 1.0;

  constructor() {
    super(1, 1);
  }

  override calculate(output: ConstraintOutput, state: SystemState): void {
    const body = this.bodies[0]!.index;

    const q1 = state.p_x[body];
    const q2 = state.p_y[body];
    const q3 = state.theta[body];
    const q3_dot = state.v_theta[body];

    const cos_q3 = Math.cos(q3);
    const sin_q3 = Math.sin(q3);

    const bodyX = q1 + cos_q3 * this.local_x - sin_q3 * this.local_y;
    const bodyY = q2 + sin_q3 * this.local_x + cos_q3 * this.local_y;

    const perpX = -this.dy;
    const perpY = this.dx;

    const deltaX = bodyX - this.p0_x;
    const deltaY = bodyY - this.p0_y;

    const C = deltaX * perpX + deltaY * perpY;

    output.J[0] = perpX;
    output.J[1] = perpY;
    output.J[2] =
      (-sin_q3 * this.local_x - cos_q3 * this.local_y) * perpX +
      (cos_q3 * this.local_x - sin_q3 * this.local_y) * perpY;

    output.J_dot[0] = 0.0;
    output.J_dot[1] = 0.0;
    output.J_dot[2] =
      (-cos_q3 * q3_dot * this.local_x + sin_q3 * q3_dot * this.local_y) * perpX +
      (-sin_q3 * q3_dot * this.local_x - cos_q3 * q3_dot * this.local_y) * perpY;

    output.ks[0] = this.ks;
    output.kd[0] = this.kd;

    output.C[0] = C;
    output.v_bias[0] = 0;

    this.noLimits(output);
  }
}
