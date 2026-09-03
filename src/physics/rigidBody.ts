/** Ported from `simple-2d-constraint-solver/include/rigid_body.h`. */
export class RigidBody {
  p_x = 0;
  p_y = 0;

  v_x = 0;
  v_y = 0;

  theta = 0;
  v_theta = 0;

  /** Mass (kg). */
  m = 0;
  /** Moment of inertia (kg m^2). */
  I = 0;

  index = -1;

  reset(): void {
    this.p_x = this.p_y = 0;
    this.v_x = this.v_y = 0;
    this.theta = 0;
    this.v_theta = 0;
    this.m = 0;
    this.I = 0;
  }

  energy(): number {
    const speed_2 = this.v_x * this.v_x + this.v_y * this.v_y;
    return 0.5 * this.m * speed_2 + 0.5 * this.I * this.v_theta * this.v_theta;
  }

  localToWorld(x: number, y: number, out: { x: number; y: number }): void {
    const cos_theta = Math.cos(this.theta);
    const sin_theta = Math.sin(this.theta);

    out.x = cos_theta * x - sin_theta * y + this.p_x;
    out.y = sin_theta * x + cos_theta * y + this.p_y;
  }

  worldToLocal(x: number, y: number, out: { x: number; y: number }): void {
    const cos_theta = Math.cos(this.theta);
    const sin_theta = Math.sin(this.theta);

    out.x = cos_theta * (x - this.p_x) + sin_theta * (y - this.p_y);
    out.y = -sin_theta * (x - this.p_x) + cos_theta * (y - this.p_y);
  }
}
