/** Ported from `simple-2d-constraint-solver/include/force_generator.h`. */
import type { SystemState } from './systemState';

export abstract class ForceGenerator {
  index = -1;
  abstract apply(state: SystemState): void;
}
