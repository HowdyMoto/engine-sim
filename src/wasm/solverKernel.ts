/**
 * WASM backend for the projected Gauss-Seidel constraint solve.
 *
 * The inputs live in JS-owned matrices that resize as constraints come and
 * go, so each solve copies them into a fixed arena in wasm linear memory
 * (a few hundred doubles - the copy is noise next to 128 sweeps), runs the
 * kernel, and copies the result back. The JS solver remains the reference
 * implementation and handles any system larger than the arena.
 */
import { setSleKernel, type SleKernel } from '../physics/gaussSeidelSleSolver';
import { SparseMatrix } from '../physics/sparseMatrix';
import type { Matrix } from '../physics/matrix';
import { gasWasmBytes } from './gasWasm.generated';

interface SolverWasmExports {
  memory: WebAssembly.Memory;
  solverReserve(maxRows: number, maxBodies: number): number;
  solverSolve(
    n: number,
    bodyCount: number,
    hasLimits: number,
    maxIterations: number,
    minDelta: number,
  ): number;
}

const E = SparseMatrix.ENTRIES;
const S = SparseMatrix.STRIDE;

export class WasmSleKernel implements SleKernel {
  private buffer: ArrayBuffer;
  private j!: Float64Array;
  private w!: Float64Array;
  private right!: Float64Array;
  private limits!: Float64Array;
  private x!: Float64Array;
  private blocks!: Uint8Array;

  constructor(
    private exports: SolverWasmExports,
    private base: number,
    private maxRows: number,
    private maxBodies: number,
  ) {
    this.buffer = exports.memory.buffer;
    this.createViews();
  }

  /** Arena layout mirrors solverReserve in wasm/assembly/index.ts. */
  private createViews(): void {
    const buffer = this.exports.memory.buffer;
    this.buffer = buffer;

    let offset = this.base;
    this.j = new Float64Array(buffer, offset, this.maxRows * E * S);
    offset += this.maxRows * E * S * 8;
    this.w = new Float64Array(buffer, offset, this.maxBodies * S);
    offset += this.maxBodies * S * 8;
    this.right = new Float64Array(buffer, offset, this.maxRows);
    offset += this.maxRows * 8;
    this.limits = new Float64Array(buffer, offset, this.maxRows * 2);
    offset += this.maxRows * 2 * 8;
    this.x = new Float64Array(buffer, offset, this.maxRows);
    offset += this.maxRows * 8;
    this.blocks = new Uint8Array(buffer, offset, this.maxRows * E);
  }

  trySolve(
    J: SparseMatrix,
    W: Matrix,
    right: Matrix,
    limits: Matrix | null,
    result: Matrix,
    maxIterations: number,
    minDelta: number,
  ): boolean | null {
    const n = right.height;
    const bodyCount = J.width / S;
    if (n > this.maxRows || bodyCount > this.maxBodies) return null;

    // Growth inside the module detaches previous views; the arena offset
    // itself is stable.
    if (this.buffer !== this.exports.memory.buffer || this.j.length === 0) {
      this.createViews();
    }

    this.j.set(J.data.subarray(0, n * E * S));
    this.blocks.set(J.blockData.subarray(0, n * E));
    this.w.set(W.data.subarray(0, bodyCount * S));
    this.right.set(right.data.subarray(0, n));
    if (limits !== null) this.limits.set(limits.data.subarray(0, n * 2));
    this.x.set(result.data.subarray(0, n));

    const converged = this.exports.solverSolve(
      n,
      bodyCount,
      limits !== null ? 1 : 0,
      maxIterations,
      minDelta,
    );

    // The solve itself never grows memory unless the sparsity pattern got
    // denser; re-check before reading back.
    if (this.buffer !== this.exports.memory.buffer || this.x.length === 0) {
      this.createViews();
    }
    result.data.set(this.x.subarray(0, n));

    return converged !== 0;
  }
}

/** Instantiate the solver kernel and route the constraint solve through it. */
export function bindSolverKernel(maxRows = 256, maxBodies = 128): boolean {
  try {
    const module = new WebAssembly.Module(gasWasmBytes());
    const instance = new WebAssembly.Instance(module, {
      env: {
        abort: () => {
          throw new Error('solver kernel abort');
        },
      },
    });

    const exports = instance.exports as unknown as SolverWasmExports;
    const base = exports.solverReserve(maxRows, maxBodies);
    setSleKernel(new WasmSleKernel(exports, base, maxRows, maxBodies));
    return true;
  } catch {
    setSleKernel(null);
    return false;
  }
}
