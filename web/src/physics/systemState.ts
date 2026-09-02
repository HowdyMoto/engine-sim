/**
 * Struct-of-arrays state for the whole rigid body system, ported from
 * `simple-2d-constraint-solver/include/system_state.h`.
 */
export class SystemState {
  indexMap: Int32Array = new Int32Array(0);

  a_theta: Float64Array = new Float64Array(0);
  v_theta: Float64Array = new Float64Array(0);
  theta: Float64Array = new Float64Array(0);

  a_x: Float64Array = new Float64Array(0);
  a_y: Float64Array = new Float64Array(0);
  v_x: Float64Array = new Float64Array(0);
  v_y: Float64Array = new Float64Array(0);
  p_x: Float64Array = new Float64Array(0);
  p_y: Float64Array = new Float64Array(0);

  f_x: Float64Array = new Float64Array(0);
  f_y: Float64Array = new Float64Array(0);
  t: Float64Array = new Float64Array(0);

  /** Per-constraint reaction forces, two bodies per constraint row. */
  r_x: Float64Array = new Float64Array(0);
  r_y: Float64Array = new Float64Array(0);
  r_t: Float64Array = new Float64Array(0);

  m: Float64Array = new Float64Array(0);

  n = 0;
  n_c = 0;
  dt = 0;

  resize(bodyCount: number, constraintCount: number): void {
    if (this.n >= bodyCount && this.n_c >= constraintCount) return;

    this.n = bodyCount;
    this.n_c = constraintCount;

    this.indexMap = new Int32Array(Math.max(constraintCount, 1));

    const n = Math.max(bodyCount, 1);
    this.a_theta = new Float64Array(n);
    this.v_theta = new Float64Array(n);
    this.theta = new Float64Array(n);

    this.a_x = new Float64Array(n);
    this.a_y = new Float64Array(n);
    this.v_x = new Float64Array(n);
    this.v_y = new Float64Array(n);
    this.p_x = new Float64Array(n);
    this.p_y = new Float64Array(n);

    this.f_x = new Float64Array(n);
    this.f_y = new Float64Array(n);
    this.t = new Float64Array(n);

    this.m = new Float64Array(n);

    const nc2 = Math.max(constraintCount * 2, 1);
    this.r_x = new Float64Array(nc2);
    this.r_y = new Float64Array(nc2);
    this.r_t = new Float64Array(nc2);
  }

  localToWorld(x: number, y: number, out: { x: number; y: number }, body: number): void {
    const x0 = this.p_x[body];
    const y0 = this.p_y[body];
    const theta = this.theta[body];

    const cos_theta = Math.cos(theta);
    const sin_theta = Math.sin(theta);

    out.x = cos_theta * x - sin_theta * y + x0;
    out.y = sin_theta * x + cos_theta * y + y0;
  }

  velocityAtPoint(x: number, y: number, out: { x: number; y: number }, body: number): void {
    this.localToWorld(x, y, out, body);
    const w_x = out.x;
    const w_y = out.y;

    const v_theta = this.v_theta[body];
    const angularToLinear_x = -v_theta * (w_y - this.p_y[body]);
    const angularToLinear_y = v_theta * (w_x - this.p_x[body]);

    out.x = this.v_x[body] + angularToLinear_x;
    out.y = this.v_y[body] + angularToLinear_y;
  }

  applyForce(x_l: number, y_l: number, f_x: number, f_y: number, body: number): void {
    const cos_theta = Math.cos(this.theta[body]);
    const sin_theta = Math.sin(this.theta[body]);

    const w_x = cos_theta * x_l - sin_theta * y_l + this.p_x[body];
    const w_y = sin_theta * x_l + cos_theta * y_l + this.p_y[body];

    this.f_x[body] += f_x;
    this.f_y[body] += f_y;

    this.t[body] += (w_y - this.p_y[body]) * -f_x + (w_x - this.p_x[body]) * f_y;
  }
}
