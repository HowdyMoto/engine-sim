/**
 * Base constraint type, ported from
 * `simple-2d-constraint-solver/include/constraint.h`.
 *
 * `Output` uses flat typed arrays instead of C multidimensional arrays:
 * `J[row * 6 + col]`, `limits[row * 2 + side]`.
 */
import type { RigidBody } from './rigidBody';
import type { SystemState } from './systemState';

export const MAX_CONSTRAINT_COUNT = 3;
export const MAX_BODY_COUNT = 2;

const DBL_MAX = Number.MAX_VALUE;

export class ConstraintOutput {
  C = new Float64Array(MAX_CONSTRAINT_COUNT);
  J = new Float64Array(MAX_CONSTRAINT_COUNT * 3 * MAX_BODY_COUNT);
  J_dot = new Float64Array(MAX_CONSTRAINT_COUNT * 3 * MAX_BODY_COUNT);
  v_bias = new Float64Array(MAX_CONSTRAINT_COUNT);
  limits = new Float64Array(MAX_CONSTRAINT_COUNT * 2);
  ks = new Float64Array(MAX_CONSTRAINT_COUNT);
  kd = new Float64Array(MAX_CONSTRAINT_COUNT);
}

export abstract class Constraint {
  index = -1;
  bodyCount: number;
  bodies: (RigidBody | null)[] = [null, null];

  /** Reaction forces resolved by the solver: `F_x[row * MAX_BODY_COUNT + body]`. */
  F_x = new Float64Array(MAX_CONSTRAINT_COUNT * MAX_BODY_COUNT);
  F_y = new Float64Array(MAX_CONSTRAINT_COUNT * MAX_BODY_COUNT);
  F_t = new Float64Array(MAX_CONSTRAINT_COUNT * MAX_BODY_COUNT);

  protected constraintCount: number;

  constructor(constraintCount: number, bodyCount: number) {
    this.constraintCount = constraintCount;
    this.bodyCount = bodyCount;
  }

  getConstraintCount(): number {
    return this.constraintCount;
  }

  setBody(body: RigidBody): void {
    this.bodies[0] = body;
  }

  setBody1(body: RigidBody): void {
    this.bodies[0] = body;
  }

  setBody2(body: RigidBody): void {
    this.bodies[1] = body;
  }

  abstract calculate(output: ConstraintOutput, state: SystemState): void;

  protected noLimits(output: ConstraintOutput): void {
    for (let i = 0; i < MAX_CONSTRAINT_COUNT; ++i) {
      output.limits[i * 2 + 0] = -DBL_MAX;
      output.limits[i * 2 + 1] = DBL_MAX;
    }
  }
}
