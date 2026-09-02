/**
 * Projected Gauss-Seidel solver for the constrained system, ported from
 * `simple-2d-constraint-solver/src/gauss_seidel_sle_solver.cpp`.
 *
 * Solves `(J W J^T) lambda = right`, clamping each lambda to its per-row limits
 * so torque-limited constraints (clutch, dyno, starter, friction) behave like
 * inequality constraints.
 *
 * The original forms `J W J^T` as a dense matrix and sweeps all of it. Two
 * constraint rows only couple when they share a rigid body, so that matrix is
 * mostly zeros - a V8 has 47 rows but only a handful of non-zeros each. This
 * port groups rows by the body they touch and builds the product directly in
 * compressed sparse row form, then sweeps only the non-zeros. The arithmetic
 * is the same; skipping the zeros is what makes a V8 run in real time in a
 * browser.
 */
import { Matrix } from './matrix';
import { SparseMatrix } from './sparseMatrix';

const EMPTY = 0xff;

export class GaussSeidelSleSolver {
  maxIterations = 128;
  minDelta = 1e-1;

  readonly supportsLimits = true;

  // Rows grouped by the body they reference (counting sort).
  private bucketStart = new Int32Array(0);
  private bucketFill = new Int32Array(0);
  private bucketRow = new Int32Array(0);
  private bucketEntry = new Int32Array(0);

  // Row accumulator for the sparse product.
  private acc = new Float64Array(0);
  private touched = new Int32Array(0);
  private inTouched = new Uint8Array(0);

  // Compressed sparse row form of M, excluding the diagonal.
  private rowStart = new Int32Array(0);
  private colIndex = new Int32Array(0);
  private values = new Float64Array(0);
  private diagonal = new Float64Array(0);

  solve(
    J: SparseMatrix,
    W: Matrix,
    right: Matrix,
    result: Matrix,
    previous: Matrix | null,
  ): boolean {
    return this.run(J, W, right, null, result, previous);
  }

  solveWithLimits(
    J: SparseMatrix,
    W: Matrix,
    right: Matrix,
    limits: Matrix,
    result: Matrix,
    previous: Matrix | null,
  ): boolean {
    return this.run(J, W, right, limits, result, previous);
  }

  private run(
    J: SparseMatrix,
    W: Matrix,
    right: Matrix,
    limits: Matrix | null,
    result: Matrix,
    previous: Matrix | null,
  ): boolean {
    const n = right.height;

    if (result.height !== n) {
      result.initialize(1, n);
    } else {
      result.resize(1, n);
    }

    if (previous !== null && previous !== result && previous.height === n) {
      result.copyFrom(previous);
    }

    if (n === 0) return true;

    this.buildSystemMatrix(J, W, n);

    for (let i = 0; i < this.maxIterations; ++i) {
      if (this.sweep(right, result, limits) < this.minDelta) return true;
    }

    return false;
  }

  /** Form `M = J W J^T` in CSR, visiting only rows that share a body. */
  private buildSystemMatrix(J: SparseMatrix, W: Matrix, n: number): void {
    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rowStride = E * S;

    const bodyCount = J.width / S;
    const blockData = J.blockData;
    const jData = J.data;
    const w = W.data;

    if (this.bucketStart.length < bodyCount + 1) {
      this.bucketStart = new Int32Array(bodyCount + 1);
      this.bucketFill = new Int32Array(bodyCount + 1);
    }
    if (this.bucketRow.length < n * E) {
      this.bucketRow = new Int32Array(n * E);
      this.bucketEntry = new Int32Array(n * E);
    }
    if (this.acc.length < n) {
      this.acc = new Float64Array(n);
      this.touched = new Int32Array(n);
      this.inTouched = new Uint8Array(n);
      this.rowStart = new Int32Array(n + 1);
      this.diagonal = new Float64Array(n);
    }

    const bucketStart = this.bucketStart;
    const bucketFill = this.bucketFill;
    const bucketRow = this.bucketRow;
    const bucketEntry = this.bucketEntry;

    bucketStart.fill(0, 0, bodyCount + 1);

    for (let i = 0; i < n; ++i) {
      for (let k = 0; k < E; ++k) {
        const b = blockData[i * E + k];
        if (b !== EMPTY) ++bucketStart[b + 1];
      }
    }

    for (let b = 0; b < bodyCount; ++b) {
      bucketStart[b + 1] += bucketStart[b];
      bucketFill[b] = bucketStart[b];
    }

    for (let i = 0; i < n; ++i) {
      for (let k = 0; k < E; ++k) {
        const b = blockData[i * E + k];
        if (b === EMPTY) continue;
        const slot = bucketFill[b]++;
        bucketRow[slot] = i;
        bucketEntry[slot] = k;
      }
    }

    const acc = this.acc;
    const touched = this.touched;
    const inTouched = this.inTouched;
    const rowStart = this.rowStart;
    const diagonal = this.diagonal;

    // Worst case one entry per (row, body-sharing row) pair.
    let capacity = 0;
    for (let i = 0; i < n; ++i) {
      for (let k = 0; k < E; ++k) {
        const b = blockData[i * E + k];
        if (b === EMPTY) continue;
        capacity += bucketStart[b + 1] - bucketStart[b];
      }
    }

    if (this.colIndex.length < capacity) {
      this.colIndex = new Int32Array(capacity);
      this.values = new Float64Array(capacity);
    }

    const colIndex = this.colIndex;
    const values = this.values;

    let nnz = 0;
    for (let i = 0; i < n; ++i) {
      rowStart[i] = nnz;
      let touchedCount = 0;
      diagonal[i] = 0;

      for (let k = 0; k < E; ++k) {
        const b = blockData[i * E + k];
        if (b === EMPTY) continue;

        const iBase = i * rowStride + k * S;
        // Scale this block's row by the inverse mass matrix once.
        const a0 = w[b * S + 0] * jData[iBase + 0];
        const a1 = w[b * S + 1] * jData[iBase + 1];
        const a2 = w[b * S + 2] * jData[iBase + 2];

        const end = bucketStart[b + 1];
        for (let p = bucketStart[b]; p < end; ++p) {
          const j = bucketRow[p];
          const jBase = j * rowStride + bucketEntry[p] * S;

          const dot =
            a0 * jData[jBase + 0] + a1 * jData[jBase + 1] + a2 * jData[jBase + 2];

          if (j === i) {
            diagonal[i] += dot;
          } else if (inTouched[j] === 0) {
            inTouched[j] = 1;
            touched[touchedCount++] = j;
            acc[j] = dot;
          } else {
            acc[j] += dot;
          }
        }
      }

      for (let t = 0; t < touchedCount; ++t) {
        const j = touched[t];
        inTouched[j] = 0;
        colIndex[nnz] = j;
        values[nnz] = acc[j];
        ++nnz;
      }
    }

    rowStart[n] = nnz;
  }

  /**
   * One in-place Gauss-Seidel sweep. Updating `k` in place reproduces the
   * original, which passes the same matrix as both `k_next` and `k`: entries
   * before `i` already hold this iteration's values, entries after it hold the
   * previous iteration's.
   */
  private sweep(right: Matrix, k: Matrix, limits: Matrix | null): number {
    let maxDifference = 0.0;
    const n = k.height;

    const x = k.data;
    const b = right.data;
    const rowStart = this.rowStart;
    const colIndex = this.colIndex;
    const values = this.values;
    const diagonal = this.diagonal;
    const limitData = limits !== null ? limits.data : null;

    for (let i = 0; i < n; ++i) {
      let sum = 0.0;
      const end = rowStart[i + 1];
      for (let p = rowStart[i]; p < end; ++p) {
        sum += values[p] * x[colIndex[p]];
      }

      let next = (b[i] - sum) / diagonal[i];

      const prev = x[i];
      let delta: number;

      if (limitData === null) {
        const min_k = prev > 1e-3 ? prev : 1e-3;
        delta = (Math.abs(next) - min_k) / min_k;
      } else {
        const limitMin = limitData[i * 2 + 0];
        const limitMax = limitData[i * 2 + 1];
        next = next < limitMin ? limitMin : next > limitMax ? limitMax : next;

        const absPrev = Math.abs(prev);
        const min_k = absPrev > 1e-3 ? absPrev : 1e-3;
        delta = Math.abs(next - prev) / min_k;
      }

      if (delta > maxDifference) maxDifference = delta;
      x[i] = next;
    }

    return maxDifference;
  }
}
