/**
 * Uniformly partitioned FFT convolution.
 *
 * The original runs the exhaust impulse response as a direct-form FIR
 * (`convolution_filter.cpp`). The bundled responses are up to 10 000 taps,
 * which at 44.1 kHz on two exhaust channels is close to a billion multiplies a
 * second - fine in optimised C++, far too slow in JavaScript. This produces
 * mathematically the same convolution by partitioning the response into blocks
 * and doing the per-block multiplies in the frequency domain, at roughly one
 * twentieth of the arithmetic. It adds one block of latency (256 samples,
 * about 6 ms), which the exhaust delay lines already dwarf.
 */

/** In-place iterative radix-2 complex FFT with precomputed twiddles. */
class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(readonly size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');

    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; ++i) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }

    let bits = 0;
    while (1 << bits < size) ++bits;

    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; ++i) {
      let r = 0;
      for (let b = 0; b < bits; ++b) {
        r = (r << 1) | ((i >> b) & 1);
      }
      this.reverse[i] = r;
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    this.run(re, im, false);
  }

  /** Inverse transform, scaled by 1/size. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.run(re, im, true);

    const scale = 1 / this.size;
    for (let i = 0; i < this.size; ++i) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }

  private run(re: Float64Array, im: Float64Array, conjugate: boolean): void {
    const n = this.size;
    const rev = this.reverse;

    for (let i = 0; i < n; ++i) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    const sign = conjugate ? -1 : 1;

    for (let len = 2; len <= n; len <<= 1) {
      const step = n / len;
      const half = len >> 1;

      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; ++k) {
          const twiddle = k * step;
          const wr = this.cos[twiddle];
          const wi = sign * this.sin[twiddle];

          const a = i + k;
          const b = a + half;

          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;

          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

const BLOCK_SIZE = 256;
const FFT_SIZE = BLOCK_SIZE * 2;

export class PartitionedConvolver {
  private fft = new Fft(FFT_SIZE);

  private partitions = 0;

  /** Frequency-domain impulse response, one spectrum per partition. */
  private irRe: Float64Array = new Float64Array(0);
  private irIm: Float64Array = new Float64Array(0);

  /** Circular history of input block spectra. */
  private historyRe: Float64Array = new Float64Array(0);
  private historyIm: Float64Array = new Float64Array(0);
  private historyIndex = 0;

  private workRe = new Float64Array(FFT_SIZE);
  private workIm = new Float64Array(FFT_SIZE);
  private accRe = new Float64Array(FFT_SIZE);
  private accIm = new Float64Array(FFT_SIZE);

  private inputBlock = new Float64Array(BLOCK_SIZE);
  private inputFill = 0;
  private overlap = new Float64Array(BLOCK_SIZE);

  private output = new Float64Array(0);
  private outputRead = 0;
  private outputWrite = 0;
  private outputCount = 0;

  private ready = false;

  get isReady(): boolean {
    return this.ready;
  }

  get latencySamples(): number {
    return BLOCK_SIZE;
  }

  /** Load an impulse response; pass an empty array to disable convolution. */
  initialize(impulseResponse: Float32Array): void {
    if (impulseResponse.length === 0) {
      this.ready = false;
      return;
    }

    this.partitions = Math.ceil(impulseResponse.length / BLOCK_SIZE);

    this.irRe = new Float64Array(this.partitions * FFT_SIZE);
    this.irIm = new Float64Array(this.partitions * FFT_SIZE);

    for (let p = 0; p < this.partitions; ++p) {
      this.workRe.fill(0);
      this.workIm.fill(0);

      const start = p * BLOCK_SIZE;
      const end = Math.min(start + BLOCK_SIZE, impulseResponse.length);
      for (let i = start; i < end; ++i) {
        this.workRe[i - start] = impulseResponse[i];
      }

      this.fft.forward(this.workRe, this.workIm);
      this.irRe.set(this.workRe, p * FFT_SIZE);
      this.irIm.set(this.workIm, p * FFT_SIZE);
    }

    this.historyRe = new Float64Array(this.partitions * FFT_SIZE);
    this.historyIm = new Float64Array(this.partitions * FFT_SIZE);
    this.historyIndex = 0;

    this.inputBlock.fill(0);
    this.inputFill = 0;
    this.overlap.fill(0);

    // Prime the output with one block of silence so reads never underrun.
    this.output = new Float64Array(Math.max(BLOCK_SIZE * 4, FFT_SIZE * 2));
    this.output.fill(0);
    this.outputRead = 0;
    this.outputWrite = BLOCK_SIZE;
    this.outputCount = BLOCK_SIZE;

    this.ready = true;
  }

  /**
   * Convolve `count` samples from `input`, writing the same number of samples
   * to `output`. Input and output may be the same array.
   */
  process(input: Float32Array, output: Float32Array, count: number): void {
    if (!this.ready) {
      if (input !== output) output.set(input.subarray(0, count));
      return;
    }

    let consumed = 0;
    while (consumed < count) {
      const room = BLOCK_SIZE - this.inputFill;
      const take = Math.min(room, count - consumed);

      for (let i = 0; i < take; ++i) {
        this.inputBlock[this.inputFill + i] = input[consumed + i];
      }

      this.inputFill += take;
      consumed += take;

      if (this.inputFill === BLOCK_SIZE) {
        this.processBlock();
        this.inputFill = 0;
      }
    }

    for (let i = 0; i < count; ++i) {
      output[i] = this.outputCount > 0 ? this.readOutput() : 0;
    }
  }

  private readOutput(): number {
    const v = this.output[this.outputRead];
    this.outputRead = (this.outputRead + 1) % this.output.length;
    --this.outputCount;
    return v;
  }

  private processBlock(): void {
    const n = FFT_SIZE;

    // Forward transform of [block, zeros].
    this.workRe.set(this.inputBlock, 0);
    this.workRe.fill(0, BLOCK_SIZE, n);
    this.workIm.fill(0);
    this.fft.forward(this.workRe, this.workIm);

    this.historyRe.set(this.workRe, this.historyIndex * n);
    this.historyIm.set(this.workIm, this.historyIndex * n);

    this.accRe.fill(0);
    this.accIm.fill(0);

    // Multiply-accumulate each impulse response partition with the matching
    // (delayed) input spectrum.
    for (let p = 0; p < this.partitions; ++p) {
      let h = this.historyIndex - p;
      if (h < 0) h += this.partitions;

      const hBase = h * n;
      const iBase = p * n;

      for (let k = 0; k < n; ++k) {
        const xr = this.historyRe[hBase + k];
        const xi = this.historyIm[hBase + k];
        const hr = this.irRe[iBase + k];
        const hi = this.irIm[iBase + k];

        this.accRe[k] += xr * hr - xi * hi;
        this.accIm[k] += xr * hi + xi * hr;
      }
    }

    this.fft.inverse(this.accRe, this.accIm);

    // Overlap-add: the first half is output, the second half carries over.
    for (let i = 0; i < BLOCK_SIZE; ++i) {
      this.writeOutput(this.accRe[i] + this.overlap[i]);
      this.overlap[i] = this.accRe[BLOCK_SIZE + i];
    }

    this.historyIndex = (this.historyIndex + 1) % this.partitions;
  }

  private writeOutput(v: number): void {
    this.output[this.outputWrite] = v;
    this.outputWrite = (this.outputWrite + 1) % this.output.length;
    ++this.outputCount;
  }
}
