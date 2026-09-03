/**
 * Sampled 1-D function with triangle / gaussian reconstruction filters.
 * Ported from `include/function.h` / `src/function.cpp`.
 */
import { GaussianFilter } from './gaussianFilter';

let defaultGaussianFilter: GaussianFilter | null = null;

function getDefaultGaussianFilter(): GaussianFilter {
  if (defaultGaussianFilter === null) {
    defaultGaussianFilter = new GaussianFilter();
    defaultGaussianFilter.initialize(1.0, 3.0, 1024);
  }
  return defaultGaussianFilter;
}

export class Func {
  private x: Float64Array = new Float64Array(0);
  private y: Float64Array = new Float64Array(0);

  private yMin = 0;
  private yMax = 0;
  private inputScale = 1.0;
  private outputScale = 1.0;

  private filterRadius = 0;
  private capacity = 0;
  private size = 0;

  private gaussianFilter: GaussianFilter | null = null;

  initialize(size: number, filterRadius: number, filter?: GaussianFilter): this {
    this.resize(Math.max(size, 1));
    this.size = 0;
    this.filterRadius = filterRadius;
    this.gaussianFilter = filter ?? getDefaultGaussianFilter();
    return this;
  }

  setInputScale(s: number): void {
    this.inputScale = s;
  }

  setOutputScale(s: number): void {
    this.outputScale = s;
  }

  setFilterRadius(r: number): void {
    this.filterRadius = r;
  }

  getFilterRadius(): number {
    return this.filterRadius;
  }

  getSize(): number {
    return this.size;
  }

  sampleX(i: number): number {
    return this.x[i];
  }

  sampleY(i: number): number {
    return this.y[i];
  }

  private resize(newCapacity: number): void {
    const new_x = new Float64Array(newCapacity);
    const new_y = new Float64Array(newCapacity);

    if (this.size > 0) {
      new_x.set(this.x.subarray(0, this.size));
      new_y.set(this.y.subarray(0, this.size));
    }

    this.x = new_x;
    this.y = new_y;
    this.capacity = newCapacity;
  }

  addSample(x: number, y: number): this {
    if (this.size + 1 > this.capacity) {
      this.resize(this.capacity * 2 + 1);
    }

    this.yMin = Math.min(this.yMin, y);
    this.yMax = Math.max(this.yMax, y);

    const closest = this.closestSample(x);
    if (closest === -1) {
      this.size = 1;
      this.x[0] = x;
      this.y[0] = y;
      return this;
    }

    const index = x < this.x[closest] ? closest : closest + 1;

    ++this.size;

    const sizeToCopy = this.size - index - 1;
    if (sizeToCopy > 0) {
      this.x.copyWithin(index + 1, index, index + sizeToCopy);
      this.y.copyWithin(index + 1, index, index + sizeToCopy);
    }

    this.x[index] = x;
    this.y[index] = y;
    return this;
  }

  sampleTriangle(xIn: number): number {
    const x = xIn * this.inputScale;
    const closest = this.closestSample(x);

    if (this.size === 0) return 0;
    if (x >= this.x[this.size - 1]) return this.y[this.size - 1] * this.outputScale;
    if (x <= this.x[0]) return this.y[0] * this.outputScale;

    let sum = 0;
    let totalWeight = 0;
    for (let i = closest; i >= 0; --i) {
      if (this.x[i] > x) continue;
      if (Math.abs(x - this.x[i]) > this.filterRadius) break;

      const w = this.triangle(this.x[i] - x);
      sum += w * this.y[i];
      totalWeight += w;
    }

    for (let i = closest; i < this.size; ++i) {
      if (this.x[i] <= x) continue;
      if (Math.abs(this.x[i] - x) > this.filterRadius) break;

      const w = this.triangle(this.x[i] - x);
      sum += w * this.y[i];
      totalWeight += w;
    }

    return totalWeight !== 0 ? (sum * this.outputScale) / totalWeight : 0;
  }

  sampleGaussian(xIn: number): number {
    const filter = this.gaussianFilter ?? getDefaultGaussianFilter();
    const x = xIn * this.inputScale;
    const closest = this.closestSample(x);
    const filterRadius = this.filterRadius * filter.getRadius();

    let sum = 0;
    let totalWeight = 0;

    if (this.size === 0) return 0;
    if (x > this.x[this.size - 1]) {
      const w = filter.evaluate(0);
      sum += w * this.y[this.size - 1];
      totalWeight += w;
    } else if (x < this.x[0]) {
      const w = filter.evaluate(0);
      sum += w * this.y[0];
      totalWeight += w;
    }

    for (let i = closest; i >= 0; --i) {
      if (Math.abs(x - this.x[i]) > filterRadius) break;
      const w = filter.evaluate((this.x[i] - x) / this.filterRadius);
      sum += w * this.y[i];
      totalWeight += w;
    }

    for (let i = closest + 1; i < this.size; ++i) {
      if (Math.abs(this.x[i] - x) > filterRadius) break;
      const w = filter.evaluate((this.x[i] - x) / this.filterRadius);
      sum += w * this.y[i];
      totalWeight += w;
    }

    return totalWeight !== 0 ? (sum * this.outputScale) / totalWeight : 0;
  }

  isOrdered(): boolean {
    for (let i = 0; i < this.size - 1; ++i) {
      if (this.x[i] > this.x[i + 1]) return false;
    }
    return true;
  }

  getDomain(): [number, number] {
    if (this.size === 0) return [0, 0];
    return [this.x[0], this.x[this.size - 1]];
  }

  getRange(): [number, number] {
    return [this.yMin, this.yMax];
  }

  private triangle(x: number): number {
    return (this.filterRadius - Math.abs(x)) / this.filterRadius;
  }

  closestSample(x: number): number {
    if (Number.isNaN(x)) return 0;

    let l = 0;
    let r = this.size - 1;

    if (this.size === 0) return -1;
    if (x <= this.x[l]) return l;
    if (x >= this.x[r]) return r;

    while (l + 1 < r) {
      const mid = (l + r) >> 1;
      if (x > this.x[mid]) l = mid;
      else if (x < this.x[mid]) r = mid;
      else return mid;
    }

    return x - this.x[l] < this.x[r] - x ? l : r;
  }
}
