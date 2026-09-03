/**
 * Constraint-based rigid body system, ported from
 * `optimized_nsv_rigid_body_system.cpp` (plus the shared parts of
 * `rigid_body_system.cpp`).
 *
 * Each step integrates external forces, solves for constraint impulses with a
 * projected Gauss-Seidel sweep, then advances positions with a non-separating
 * velocity (semi-implicit Euler) integrator.
 */
import { Matrix } from './matrix';
import { SparseMatrix } from './sparseMatrix';
import { SystemState } from './systemState';
import { ConstraintOutput, MAX_BODY_COUNT } from './constraint';
import { GaussSeidelSleSolver } from './gaussSeidelSleSolver';
import type { Constraint } from './constraint';
import type { RigidBody } from './rigidBody';
import type { ForceGenerator } from './forceGenerator';

export class RigidBodySystem {
  biasFactor = 1.0;

  readonly state = new SystemState();

  private rigidBodies: RigidBody[] = [];
  private constraints: Constraint[] = [];
  private forceGenerators: ForceGenerator[] = [];

  private sleSolver = new GaussSeidelSleSolver();

  // Intermediate values, retained across frames so stepping allocates nothing.
  private J_sparse = new SparseMatrix();
  private sreg0 = new SparseMatrix();
  private C = new Matrix();
  private M = new Matrix();
  private M_inv = new Matrix();
  private b_err = new Matrix();
  private v_bias = new Matrix();
  private limits = new Matrix();
  private q_dot = new Matrix();
  private q_dot_prime = new Matrix();
  private reg0 = new Matrix();
  private reg1 = new Matrix();
  private right = new Matrix();
  private F_ext = new Matrix();
  private lambda = new Matrix();

  private constraintOutput = new ConstraintOutput();

  /** Wall-clock microseconds spent in the last constraint solve. */
  lastSolveMicroseconds = 0;

  reset(): void {
    this.rigidBodies = [];
    this.constraints = [];
    this.forceGenerators = [];
  }

  addRigidBody(body: RigidBody): void {
    this.rigidBodies.push(body);
    body.index = this.rigidBodies.length - 1;
  }

  removeRigidBody(body: RigidBody): void {
    const last = this.rigidBodies.pop()!;
    if (last !== body) {
      this.rigidBodies[body.index] = last;
      last.index = body.index;
    }
  }

  getRigidBody(i: number): RigidBody {
    return this.rigidBodies[i];
  }

  addConstraint(constraint: Constraint): void {
    this.constraints.push(constraint);
    constraint.index = this.constraints.length - 1;
  }

  addForceGenerator(generator: ForceGenerator): void {
    this.forceGenerators.push(generator);
    generator.index = this.forceGenerators.length - 1;
  }

  getRigidBodyCount(): number {
    return this.rigidBodies.length;
  }

  getConstraintCount(): number {
    return this.constraints.length;
  }

  getFullConstraintCount(): number {
    let count = 0;
    for (const constraint of this.constraints) count += constraint.getConstraintCount();
    return count;
  }

  process(dt: number, steps = 1): void {
    if (this.rigidBodies.length === 0) return;

    this.populateSystemState();
    this.populateMassMatrices();

    const subStep = dt / steps;
    for (let i = 0; i < steps; ++i) {
      this.processForces();
      this.processConstraints(subStep);
      this.integrate(subStep);
    }

    this.propagateResults();
  }

  private populateSystemState(): void {
    const n = this.rigidBodies.length;
    const n_c = this.getFullConstraintCount();
    const m = this.constraints.length;

    this.state.resize(n, n_c);
    const s = this.state;

    for (let i = 0; i < n; ++i) {
      const body = this.rigidBodies[i];
      s.a_x[i] = 0;
      s.a_y[i] = 0;

      s.v_x[i] = body.v_x;
      s.v_y[i] = body.v_y;
      s.p_x[i] = body.p_x;
      s.p_y[i] = body.p_y;

      s.a_theta[i] = 0;
      s.v_theta[i] = body.v_theta;
      s.theta[i] = body.theta;

      s.m[i] = body.m;
    }

    for (let i = 0, j_f = 0; i < m; ++i) {
      s.indexMap[i] = j_f;
      j_f += this.constraints[i].getConstraintCount();
    }
  }

  private populateMassMatrices(): void {
    const n = this.rigidBodies.length;

    this.M.initialize(1, 3 * n);
    this.M_inv.initialize(1, 3 * n);

    for (let i = 0; i < n; ++i) {
      const body = this.rigidBodies[i];
      this.M.data[i * 3 + 0] = body.m;
      this.M.data[i * 3 + 1] = body.m;
      this.M.data[i * 3 + 2] = body.I;

      this.M_inv.data[i * 3 + 0] = 1 / body.m;
      this.M_inv.data[i * 3 + 1] = 1 / body.m;
      this.M_inv.data[i * 3 + 2] = 1 / body.I;
    }
  }

  private processForces(): void {
    const n = this.rigidBodies.length;
    const s = this.state;

    for (let i = 0; i < n; ++i) {
      s.f_x[i] = 0.0;
      s.f_y[i] = 0.0;
      s.t[i] = 0.0;
    }

    for (const generator of this.forceGenerators) generator.apply(s);
  }

  private processConstraints(dt: number): void {
    const n = this.rigidBodies.length;
    const m_f = this.getFullConstraintCount();
    const m = this.constraints.length;
    const s = this.state;

    this.J_sparse.initialize(3 * n, m_f);
    this.v_bias.initialize(1, m_f);
    this.C.initialize(1, m_f);
    this.limits.initialize(2, m_f);

    const out = this.constraintOutput;

    for (let j = 0, j_f = 0; j < m; ++j) {
      const constraint = this.constraints[j];
      constraint.calculate(out, s);

      const n_f = constraint.getConstraintCount();
      for (let k = 0; k < n_f; ++k, ++j_f) {
        for (let i = 0; i < constraint.bodyCount; ++i) {
          const index = constraint.bodies[i]!.index;
          if (index === -1) continue;
          this.J_sparse.setBlock(j_f, i, index);
        }

        for (let i = 0; i < constraint.bodyCount * 3; ++i) {
          const bodyIndex = constraint.bodies[(i / 3) | 0]!.index;
          if (bodyIndex === -1) continue;
          this.J_sparse.set(j_f, (i / 3) | 0, i % 3, out.J[k * 6 + i]);
        }

        this.v_bias.data[j_f] = out.v_bias[k];
        this.C.data[j_f] = out.C[k];
        this.limits.data[j_f * 2 + 0] = out.limits[k * 2 + 0] * dt;
        this.limits.data[j_f * 2 + 1] = out.limits[k * 2 + 1] * dt;
      }
    }

    this.q_dot.resize(1, n * 3);
    for (let i = 0; i < n; ++i) {
      this.q_dot.data[i * 3 + 0] = s.v_x[i];
      this.q_dot.data[i * 3 + 1] = s.v_y[i];
      this.q_dot.data[i * 3 + 2] = s.v_theta[i];
    }

    this.F_ext.initializeValue(1, 3 * n, 0.0);
    for (let i = 0; i < n; ++i) {
      this.F_ext.data[i * 3 + 0] = s.f_x[i];
      this.F_ext.data[i * 3 + 1] = s.f_y[i];
      this.F_ext.data[i * 3 + 2] = s.t[i];
    }

    // q_dot_prime = q_dot + M_inv * F_ext * dt
    this.F_ext.scale(dt, this.reg0);
    this.reg0.leftScale(this.M_inv, this.reg1);
    this.reg1.addMatrix(this.q_dot, this.q_dot_prime);

    // b_err = (bias_factor / dt) * C
    this.C.scale(this.biasFactor / dt, this.b_err);

    // right = -(J * q_dot_prime + v_bias + b_err)
    this.J_sparse.multiply(this.q_dot_prime, this.reg0);
    this.reg0.addMatrix(this.v_bias, this.reg1);
    this.reg1.addMatrix(this.b_err, this.reg0);
    this.reg0.negate(this.right);

    this.sleSolver.solveWithLimits(
      this.J_sparse,
      this.M_inv,
      this.right,
      this.limits,
      this.lambda,
      this.lambda,
    );

    // Constraint force derivation: R = transpose(J.leftScale(lambda / dt))
    this.lambda.scale(1 / dt, this.reg0);
    this.J_sparse.leftScale(this.reg0, this.sreg0);

    for (let i = 0; i < m_f; ++i) {
      for (let j = 0; j < 2; ++j) {
        s.r_x[i * 2 + j] = this.sreg0.get(i, j, 0);
        s.r_y[i * 2 + j] = this.sreg0.get(i, j, 1);
        s.r_t[i * 2 + j] = this.sreg0.get(i, j, 2);
      }
    }

    for (let i = 0; i < n; ++i) {
      s.a_x[i] = this.F_ext.data[i * 3 + 0];
      s.a_y[i] = this.F_ext.data[i * 3 + 1];
      s.a_theta[i] = this.F_ext.data[i * 3 + 2];
    }

    for (let i = 0, j_f = 0; i < m; ++i) {
      const constraint = this.constraints[i];
      const n_f = constraint.getConstraintCount();
      for (let j = 0; j < n_f; ++j, ++j_f) {
        for (let k = 0; k < constraint.bodyCount; ++k) {
          const body = constraint.bodies[k]!.index;
          s.a_x[body] += s.r_x[j_f * 2 + k];
          s.a_y[body] += s.r_y[j_f * 2 + k];
          s.a_theta[body] += s.r_t[j_f * 2 + k];
        }
      }
    }

    for (let i = 0; i < n; ++i) {
      const invMass = this.M_inv.data[i * 3 + 0];
      const invInertia = this.M_inv.data[i * 3 + 2];

      s.a_x[i] *= invMass;
      s.a_y[i] *= invMass;
      s.a_theta[i] *= invInertia;
    }
  }

  /** Non-separating velocity (semi-implicit Euler) step; `nsv_ode_solver.cpp`. */
  private integrate(dt: number): void {
    const s = this.state;
    s.dt = dt;

    for (let i = 0; i < s.n; ++i) {
      s.v_x[i] += s.a_x[i] * dt;
      s.v_y[i] += s.a_y[i] * dt;
      s.v_theta[i] += s.a_theta[i] * dt;

      s.p_x[i] += s.v_x[i] * dt;
      s.p_y[i] += s.v_y[i] * dt;
      s.theta[i] += s.v_theta[i] * dt;
    }
  }

  private propagateResults(): void {
    const n = this.rigidBodies.length;
    const s = this.state;

    for (let i = 0; i < n; ++i) {
      const body = this.rigidBodies[i];
      body.v_x = s.v_x[i];
      body.v_y = s.v_y[i];
      body.p_x = s.p_x[i];
      body.p_y = s.p_y[i];
      body.v_theta = s.v_theta[i];
      body.theta = s.theta[i];
    }

    const m = this.constraints.length;
    for (let i = 0, i_f = 0; i < m; ++i) {
      const constraint = this.constraints[i];
      for (let j = 0; j < constraint.getConstraintCount(); ++j, ++i_f) {
        for (let k = 0; k < constraint.bodyCount; ++k) {
          constraint.F_x[j * MAX_BODY_COUNT + k] = s.r_x[i_f * 2 + k];
          constraint.F_y[j * MAX_BODY_COUNT + k] = s.r_y[i_f * 2 + k];
          constraint.F_t[j * MAX_BODY_COUNT + k] = s.r_t[i_f * 2 + k];
        }
      }
    }
  }
}
