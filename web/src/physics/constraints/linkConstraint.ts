/** Pins a local point on one body to a local point on another (`link_constraint.cpp`). */
import { Constraint, type ConstraintOutput } from '../constraint';
import type { SystemState } from '../systemState';

export class LinkConstraint extends Constraint {
  local_x_1 = 0;
  local_y_1 = 0;
  local_x_2 = 0;
  local_y_2 = 0;
  ks = 10.0;
  kd = 1.0;

  constructor() {
    super(2, 2);
  }

  setLocalPosition1(x: number, y: number): void {
    this.local_x_1 = x;
    this.local_y_1 = y;
  }

  setLocalPosition2(x: number, y: number): void {
    this.local_x_2 = x;
    this.local_y_2 = y;
  }

  override calculate(output: ConstraintOutput, state: SystemState): void {
    const body = this.bodies[0]!.index;
    const linkedBody = this.bodies[1]!.index;

    const q1 = state.p_x[body];
    const q2 = state.p_y[body];
    const q3 = state.theta[body];

    const q4 = state.p_x[linkedBody];
    const q5 = state.p_y[linkedBody];
    const q6 = state.theta[linkedBody];

    const q3_dot = state.v_theta[body];
    const q6_dot = state.v_theta[linkedBody];

    const cos_q3 = Math.cos(q3);
    const sin_q3 = Math.sin(q3);
    const cos_q6 = Math.cos(q6);
    const sin_q6 = Math.sin(q6);

    const bodyX = q1 + cos_q3 * this.local_x_1 - sin_q3 * this.local_y_1;
    const bodyY = q2 + sin_q3 * this.local_x_1 + cos_q3 * this.local_y_1;

    const linkedBodyX = q4 + cos_q6 * this.local_x_2 - sin_q6 * this.local_y_2;
    const linkedBodyY = q5 + sin_q6 * this.local_x_2 + cos_q6 * this.local_y_2;

    const J = output.J;
    const J_dot = output.J_dot;

    J[0] = 1.0;
    J[1] = 0.0;
    J[2] = -sin_q3 * this.local_x_1 - cos_q3 * this.local_y_1;
    J[3] = -1.0;
    J[4] = 0.0;
    J[5] = sin_q6 * this.local_x_2 + cos_q6 * this.local_y_2;

    J[6] = 0.0;
    J[7] = 1.0;
    J[8] = cos_q3 * this.local_x_1 - sin_q3 * this.local_y_1;
    J[9] = 0.0;
    J[10] = -1.0;
    J[11] = -cos_q6 * this.local_x_2 + sin_q6 * this.local_y_2;

    J_dot[0] = 0;
    J_dot[1] = 0;
    J_dot[2] = -cos_q3 * q3_dot * this.local_x_1 + sin_q3 * q3_dot * this.local_y_1;
    J_dot[3] = 0;
    J_dot[4] = 0;
    J_dot[5] = cos_q6 * q6_dot * this.local_x_2 - sin_q6 * q6_dot * this.local_y_2;

    J_dot[6] = 0;
    J_dot[7] = 0;
    J_dot[8] = -sin_q3 * q3_dot * this.local_x_1 - cos_q3 * q3_dot * this.local_y_1;
    J_dot[9] = 0;
    J_dot[10] = 0;
    J_dot[11] = sin_q6 * q6_dot * this.local_x_2 + cos_q6 * q6_dot * this.local_y_2;

    output.kd[0] = output.kd[1] = this.kd;
    output.ks[0] = output.ks[1] = this.ks;

    output.C[0] = bodyX - linkedBodyX;
    output.C[1] = bodyY - linkedBodyY;

    output.v_bias[0] = 0;
    output.v_bias[1] = 0;

    this.noLimits(output);
  }
}
