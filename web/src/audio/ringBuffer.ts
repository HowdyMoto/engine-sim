/** Ported from `include/ring_buffer.h`. */
export class RingBuffer<T extends Float32Array | Float64Array | Int16Array> {
  private buffer!: T;
  private capacity = 0;
  private writeIdx = 0;
  private startIdx = 0;

  constructor(private readonly factory: (n: number) => T) {}

  initialize(capacity: number): void {
    this.buffer = this.factory(capacity);
    this.capacity = capacity;
    this.writeIdx = 0;
    this.startIdx = 0;
  }

  write(data: number): void {
    this.buffer[this.writeIdx] = data;
    if (++this.writeIdx >= this.capacity) this.writeIdx = 0;
  }

  read(index: number): number {
    const i = this.startIdx + index;
    return i >= this.capacity ? this.buffer[i - this.capacity] : this.buffer[i];
  }

  readInto(n: number, target: T, targetOffset = 0): void {
    if (this.startIdx + n < this.capacity) {
      target.set(this.buffer.subarray(this.startIdx, this.startIdx + n) as T, targetOffset);
    } else {
      const first = this.capacity - this.startIdx;
      target.set(this.buffer.subarray(this.startIdx, this.capacity) as T, targetOffset);
      target.set(this.buffer.subarray(0, n - first) as T, targetOffset + first);
    }
  }

  readAndRemove(n: number, target: T, targetOffset = 0): void {
    this.readInto(n, target, targetOffset);
    this.removeBeginning(n);
  }

  removeBeginning(n: number): void {
    this.startIdx += n;
    if (this.startIdx >= this.capacity) this.startIdx -= this.capacity;
  }

  size(): number {
    return this.writeIdx < this.startIdx
      ? this.writeIdx + (this.capacity - this.startIdx)
      : this.writeIdx - this.startIdx;
  }

  writeIndex(): number {
    return this.writeIdx;
  }

  start(): number {
    return this.startIdx;
  }

  getCapacity(): number {
    return this.capacity;
  }
}

export const float32RingBuffer = () => new RingBuffer<Float32Array>((n) => new Float32Array(n));
export const float64RingBuffer = () => new RingBuffer<Float64Array>((n) => new Float64Array(n));
export const int16RingBuffer = () => new RingBuffer<Int16Array>((n) => new Int16Array(n));
