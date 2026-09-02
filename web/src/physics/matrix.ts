/**
 * Dense matrix with `get(column, row)` addressing, ported from
 * `simple-2d-constraint-solver/include/matrix.h`.
 *
 * Storage is row-major in a single Float64Array; capacity is retained across
 * resizes so the constraint solver never allocates in its hot loop.
 */
export class Matrix {
  data: Float64Array = new Float64Array(0);
  width = 0;
  height = 0;
  private capacity = 0;

  constructor(width = 0, height = 0, value = 0.0) {
    if (width > 0 && height > 0) this.initializeValue(width, height, value);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;

    const required = width * height;
    if (required > this.capacity) {
      this.data = new Float64Array(required);
      this.capacity = required;
    }

    this.width = width;
    this.height = height;
  }

  /** Resize and zero-fill. */
  initialize(width: number, height: number): void {
    this.resize(width, height);
    this.data.fill(0, 0, width * height);
  }

  /** Resize and fill with `value`. */
  initializeValue(width: number, height: number, value: number): void {
    this.resize(width, height);
    this.data.fill(value, 0, width * height);
  }

  get(column: number, row: number): number {
    return this.data[row * this.width + column];
  }

  set(column: number, row: number, value: number): void {
    this.data[row * this.width + column] = value;
  }

  add(column: number, row: number, value: number): void {
    this.data[row * this.width + column] += value;
  }

  copyFrom(reference: Matrix): void {
    this.resize(reference.width, reference.height);
    const n = reference.width * reference.height;
    for (let i = 0; i < n; ++i) this.data[i] = reference.data[i];
  }

  /** target[i][j] = scale[i] * this[i][j] (scale is a column vector). */
  leftScale(scale: Matrix, target: Matrix): void {
    target.resize(this.width, this.height);
    for (let i = 0; i < this.height; ++i) {
      const s = scale.data[i];
      const base = i * this.width;
      for (let j = 0; j < this.width; ++j) {
        target.data[base + j] = s * this.data[base + j];
      }
    }
  }

  /** target[i][j] = scale[j] * this[i][j] (scale is a column vector). */
  rightScale(scale: Matrix, target: Matrix): void {
    target.resize(this.width, this.height);
    for (let i = 0; i < this.height; ++i) {
      const base = i * this.width;
      for (let j = 0; j < this.width; ++j) {
        target.data[base + j] = scale.data[j] * this.data[base + j];
      }
    }
  }

  scale(s: number, target: Matrix): void {
    target.resize(this.width, this.height);
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) target.data[i] = s * this.data[i];
  }

  addMatrix(b: Matrix, target: Matrix): void {
    target.resize(this.width, this.height);
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) target.data[i] = this.data[i] + b.data[i];
  }

  subtract(b: Matrix, target: Matrix): void {
    target.resize(this.width, this.height);
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) target.data[i] = this.data[i] - b.data[i];
  }

  negate(target: Matrix): void {
    target.resize(this.width, this.height);
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) target.data[i] = -this.data[i];
  }

  multiply(b: Matrix, target: Matrix): void {
    target.initialize(b.width, this.height);
    for (let i = 0; i < this.height; ++i) {
      for (let j = 0; j < b.width; ++j) {
        let v = 0;
        for (let k = 0; k < this.width; ++k) {
          v += this.data[i * this.width + k] * b.data[k * b.width + j];
        }
        target.data[i * target.width + j] = v;
      }
    }
  }

  vectorMagnitudeSquared(): number {
    let sum = 0;
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) sum += this.data[i] * this.data[i];
    return sum;
  }

  dot(b: Matrix): number {
    let sum = 0;
    const n = this.width * this.height;
    for (let i = 0; i < n; ++i) sum += this.data[i] * b.data[i];
    return sum;
  }
}
