/**
 * Block-sparse matrix used for the constraint jacobian, ported from
 * `simple-2d-constraint-solver/include/sparse_matrix.h`.
 *
 * Each row holds ENTRIES blocks of STRIDE contiguous values; a block index of
 * EMPTY marks a slot that contributes nothing.
 */
import { Matrix } from './matrix';

const EMPTY = 0xff;

export class SparseMatrix {
  static readonly STRIDE = 3;
  static readonly ENTRIES = 2;
  private static readonly ROW_STRIDE = SparseMatrix.STRIDE * SparseMatrix.ENTRIES;

  data: Float64Array = new Float64Array(0);
  blockData: Uint8Array = new Uint8Array(0);
  width = 0;
  height = 0;
  private capacityHeight = 0;

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;

    if (height > this.capacityHeight) {
      this.capacityHeight = height;
      this.data = new Float64Array(SparseMatrix.ROW_STRIDE * this.capacityHeight);
      this.blockData = new Uint8Array(this.capacityHeight * SparseMatrix.ENTRIES);
    }

    this.width = width;
    this.height = height;
  }

  /** Resize and mark every block empty. */
  initialize(width: number, height: number): void {
    this.resize(width, height);
    this.blockData.fill(EMPTY, 0, height * SparseMatrix.ENTRIES);
  }

  setBlock(row: number, entry: number, index: number): void {
    this.blockData[row * SparseMatrix.ENTRIES + entry] = index;
  }

  setEmpty(row: number, entry: number): void {
    this.blockData[row * SparseMatrix.ENTRIES + entry] = EMPTY;
    const base = row * SparseMatrix.ROW_STRIDE + entry * SparseMatrix.STRIDE;
    for (let i = 0; i < SparseMatrix.STRIDE; ++i) this.data[base + i] = 0;
  }

  set(row: number, entry: number, slice: number, v: number): void {
    this.data[row * SparseMatrix.ROW_STRIDE + entry * SparseMatrix.STRIDE + slice] = v;
  }

  get(row: number, entry: number, slice: number): number {
    return this.data[row * SparseMatrix.ROW_STRIDE + entry * SparseMatrix.STRIDE + slice];
  }

  /** target = this * transpose(b_T), exploiting shared block indices. */
  multiplyTranspose(b_T: SparseMatrix, target: Matrix): void {
    target.initialize(b_T.height, this.height);

    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;

    for (let i = 0; i < this.height; ++i) {
      for (let j = 0; j < b_T.height; ++j) {
        let dot = 0;
        for (let k = 0; k < E; ++k) {
          const block0 = this.blockData[i * E + k];
          if (block0 === EMPTY) continue;

          for (let l = 0; l < E; ++l) {
            const block1 = b_T.blockData[j * E + l];
            if (block0 === block1) {
              for (let s = 0; s < S; ++s) {
                dot += this.data[i * rs + k * S + s] * b_T.data[j * rs + l * S + s];
              }
            }
          }
        }
        target.data[i * target.width + j] = dot;
      }
    }
  }

  /** target = transpose(this) * b, where b is a column vector. */
  transposeMultiplyVector(b: Matrix, target: Matrix): void {
    target.initialize(1, this.width);

    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;

    for (let i = 0; i < this.height; ++i) {
      const bi = b.data[i];
      for (let k = 0; k < E; ++k) {
        const block = this.blockData[i * E + k];
        if (block === EMPTY) continue;

        const offset = k * S;
        for (let l = 0; l < S; ++l) {
          target.data[block * S + l] += this.data[i * rs + offset + l] * bi;
        }
      }
    }
  }

  /** target = this * b. */
  multiply(b: Matrix, target: Matrix): void {
    target.initialize(b.width, this.height);

    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;
    const b_w = b.width;

    for (let i = 0; i < this.height; ++i) {
      for (let j = 0; j < b_w; ++j) {
        let v = 0;
        for (let k = 0; k < E; ++k) {
          const block = this.blockData[i * E + k];
          if (block === EMPTY) continue;

          const offset = k * S;
          for (let l = 0; l < S; ++l) {
            v += this.data[i * rs + offset + l] * b.data[(block * S + l) * b_w + j];
          }
        }
        target.data[i * target.width + j] = v;
      }
    }
  }

  /** target[row][entry][k] = scale[blockIndex * STRIDE + k] * this[...]. */
  rightScale(scale: Matrix, target: SparseMatrix): void {
    target.initialize(this.width, this.height);

    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;

    for (let i = 0; i < this.height; ++i) {
      for (let j = 0; j < E; ++j) {
        const index = this.blockData[i * E + j];
        if (index === EMPTY) continue;

        target.blockData[i * E + j] = index;
        for (let k = 0; k < S; ++k) {
          target.data[i * rs + j * S + k] =
            scale.data[index * S + k] * this.data[i * rs + j * S + k];
        }
      }
    }
  }

  /** target[row][...] = scale[row] * this[row][...]. */
  leftScale(scale: Matrix, target: SparseMatrix): void {
    target.initialize(this.width, this.height);

    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;

    for (let i = 0; i < this.height; ++i) {
      const s = scale.data[i];
      for (let j = 0; j < E; ++j) {
        const index = this.blockData[i * E + j];
        if (index === EMPTY) continue;

        target.blockData[i * E + j] = index;
        for (let k = 0; k < S; ++k) {
          target.data[i * rs + j * S + k] = s * this.data[i * rs + j * S + k];
        }
      }
    }
  }

  /** Expand into a dense matrix (debugging aid). */
  expand(target: Matrix): void {
    target.initialize(this.width, this.height);
    const E = SparseMatrix.ENTRIES;
    const S = SparseMatrix.STRIDE;
    const rs = SparseMatrix.ROW_STRIDE;

    for (let i = 0; i < this.height; ++i) {
      for (let j = 0; j < E; ++j) {
        const block = this.blockData[i * E + j];
        if (block === EMPTY) continue;
        for (let k = 0; k < S; ++k) {
          target.set(block * S + k, i, this.data[i * rs + j * S + k]);
        }
      }
    }
  }
}
