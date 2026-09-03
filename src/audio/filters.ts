/**
 * The audio filter chain, ported from the `*_filter.h/.cpp` files in
 * `include/` and `src/`.
 */
import { PI } from '../core/constants';
import { clamp } from '../core/utilities';

/** First-order RC low pass (`low_pass_filter.h`). */
export class LowPassFilter {
  dt = 1 / 44100;
  private y = 0;
  private rc = 0;

  setCutoffFrequency(f: number): void {
    this.rc = 1.0 / (f * 2.0 * PI);
  }

  f(sample: number): number {
    const alpha = this.dt / (this.rc + this.dt);
    this.y = alpha * sample + (1 - alpha) * this.y;
    return this.y;
  }
}

/** Fourth-order Butterworth low pass (`butterworth_low_pass_filter.h`). */
export class ButterworthLowPassFilter {
  private y = new Float64Array(4);
  private x = new Float64Array(4);
  private a = new Float64Array(5);
  private f_4 = 0;

  setCutoffFrequency(f_c: number, sampleRate: number): void {
    const f = Math.tan((PI * f_c) / sampleRate);
    const f_2 = f * f;
    const f_3 = f_2 * f;
    const f_4 = f_2 * f_2;
    const m = -2.0 * Math.cos((5.0 * PI) / 8.0);
    const n = -2.0 * Math.cos((7.0 * PI) / 8.0);

    const a0 = 1.0 + (m + n) * f + (2.0 + n * m) * f_2 + (m + n) * f_3 + f_4;
    this.a[0] = a0;
    this.a[1] = (-4.0 - 2.0 * (n + m) * f + 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0;
    this.a[2] = (6.0 - 2.0 * (2.0 + m * n) * f_2 + 6.0 * f_4) / a0;
    this.a[3] = (-4.0 + 2.0 * (m + n) * f - 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0;
    this.a[4] = (1.0 - (n + m) * f + (2.0 + m * n) * f_2 - (m + n) * f_3 + f_4) / a0;

    this.f_4 = f_4;
  }

  f(sample: number): number {
    // x[0] is the oldest sample, x[3] the most recent.
    const x = this.x;
    const y = this.y;

    const n =
      (this.f_4 / this.a[0]) * (sample + 4 * x[3] + 6 * x[2] + 4 * x[1] + x[0]);
    const d = -this.a[1] * y[3] - this.a[2] * y[2] - this.a[3] * y[1] - this.a[4] * y[0];
    const out = n + d;

    x[0] = x[1];
    x[1] = x[2];
    x[2] = x[3];
    x[3] = sample;

    y[0] = y[1];
    y[1] = y[2];
    y[2] = y[3];
    y[3] = out;

    return out;
  }
}

/** Backward difference (`derivative_filter.h`). */
export class DerivativeFilter {
  dt = 1.0;
  private previous = 0;

  f(sample: number): number {
    const temp = this.previous;
    this.previous = sample;
    return (sample - temp) / this.dt;
  }
}

/** Peak-following automatic gain control (`leveling_filter.h`). */
export class LevelingFilter {
  p_maxLevel = 1.0;
  p_minLevel = 0.0;
  p_target = 30000.0;

  private peak = 30000.0;
  private attenuation = 1.0;

  f(sample: number): number {
    this.peak = 0.999 * this.peak;
    const abs = Math.abs(sample);
    if (abs > this.peak) this.peak = abs;

    if (this.peak === 0) return 0;

    let attenuation = this.p_target / this.peak;
    if (attenuation < this.p_minLevel) attenuation = this.p_minLevel;
    else if (attenuation > this.p_maxLevel) attenuation = this.p_maxLevel;

    this.attenuation = 0.9 * this.attenuation + 0.1 * attenuation;

    return sample * this.attenuation;
  }

  getAttenuation(): number {
    return this.attenuation;
  }
}

/** Time-varying fractional delay driven by filtered noise (`jitter_filter.h`). */
export class JitterFilter {
  private noiseFilter = new ButterworthLowPassFilter();
  private jitterScale = 0.0;
  private maxJitter = 0;
  private offset = 0;
  private history: Float32Array = new Float32Array(0);

  initialize(maxJitter: number, cutoffFrequency: number, audioFrequency: number): void {
    this.maxJitter = maxJitter;
    this.history = new Float32Array(maxJitter);
    this.offset = 0;
    this.noiseFilter.setCutoffFrequency(cutoffFrequency, audioFrequency);
  }

  setJitterScale(jitterScale: number): void {
    this.jitterScale = jitterScale;
  }

  getJitterScale(): number {
    return this.jitterScale;
  }

  f(sample: number, jitterScale = 1.0): number {
    this.history[this.offset] = sample;
    ++this.offset;
    if (this.offset >= this.maxJitter) this.offset = 0;

    const raw = Math.random() * (this.maxJitter - 1);
    const s = this.noiseFilter.f(raw * this.jitterScale * jitterScale);
    const s_i_0 = clamp(Math.floor(s), 0, this.maxJitter - 1);
    const s_i_1 = clamp(Math.ceil(s), 0, this.maxJitter - 1);

    const s_frac = s - s_i_0;

    const i_0 = s_i_0 + this.offset;
    const i_1 = s_i_1 + this.offset;

    const v0 = this.history[i_0 >= this.maxJitter ? i_0 - this.maxJitter : i_0];
    const v1 = this.history[i_1 >= this.maxJitter ? i_1 - this.maxJitter : i_1];

    return v1 * s_frac + v0 * (1 - s_frac);
  }
}

/** Fixed-delay line used to model exhaust travel time (`delay_filter.h`). */
export class DelayFilter {
  private latencySamples = 0;
  private history: Float64Array = new Float64Array(0);
  private writeIdx = 0;
  private count = 0;

  initialize(delay: number, audioFrequency: number): void {
    const samples = Math.round(delay * audioFrequency);
    const capacity = samples + 32;

    this.history = new Float64Array(Math.max(capacity, 1));
    this.latencySamples = samples;
    this.writeIdx = 0;
    this.count = 0;
  }

  f(sample: number): number {
    const capacity = this.history.length;
    this.history[this.writeIdx] = sample;
    this.writeIdx = (this.writeIdx + 1) % capacity;
    ++this.count;

    if (this.count <= this.latencySamples) return 0;

    const readIdx = (this.writeIdx - this.count + capacity * 2) % capacity;
    --this.count;
    return this.history[readIdx];
  }
}

/**
 * Direct-form FIR convolution against a recorded impulse response
 * (`convolution_filter.h`). Only used for the exhaust reverb.
 */
export class ConvolutionFilter {
  private shiftRegister: Float32Array = new Float32Array(0);
  private shiftOffset = 0;
  private impulseResponse: Float32Array = new Float32Array(0);
  private sampleCount = 0;

  initialize(samples: number): void {
    this.sampleCount = samples;
    this.shiftOffset = 0;
    this.shiftRegister = new Float32Array(samples);
    this.impulseResponse = new Float32Array(samples);
  }

  getImpulseResponse(): Float32Array {
    return this.impulseResponse;
  }

  getSampleCount(): number {
    return this.sampleCount;
  }

  f(sample: number): number {
    if (this.sampleCount === 0) return sample;

    const ir = this.impulseResponse;
    const sr = this.shiftRegister;
    const n = this.sampleCount;
    const offset = this.shiftOffset;

    sr[offset] = sample;

    let result = 0;
    const split = n - offset;
    for (let i = 0; i < split; ++i) {
      result += ir[i] * sr[i + offset];
    }
    for (let i = split; i < n; ++i) {
      result += ir[i] * sr[i - split];
    }

    this.shiftOffset = (offset - 1 + n) % n;

    return result;
  }
}
