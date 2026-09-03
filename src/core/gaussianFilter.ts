/** Ported from `include/gaussian_filter.h` / `src/gaussian_filter.cpp`. */
export class GaussianFilter {
  private cache: Float64Array = new Float64Array(0);
  private cacheSteps = 0;
  private radius = 0;
  private alpha = 0;
  private exp_s = 0;
  private inv_r = 0;

  initialize(alpha: number, radius: number, cacheSteps = 1024): void {
    this.cacheSteps = cacheSteps;
    this.alpha = alpha;
    this.radius = radius;
    this.exp_s = Math.exp(-alpha * radius * radius);
    this.inv_r = 1 / radius;
    this.generateCache();
  }

  getRadius(): number {
    return this.radius;
  }

  getAlpha(): number {
    return this.alpha;
  }

  evaluate(s: number): number {
    const actualSteps = this.cacheSteps - 32;
    const s_sample = actualSteps * Math.abs(s) * this.inv_r;
    const s0 = Math.floor(s_sample);
    const s1 = Math.ceil(s_sample);
    const d = s_sample - s0;

    if (s0 >= this.cacheSteps) return 0;
    const c1 = s1 < this.cacheSteps ? this.cache[s1] : 0;

    return (1 - d) * this.cache[s0] + d * c1;
  }

  private calculate(s: number): number {
    return Math.max(0.0, Math.exp(-this.alpha * s * s) - this.exp_s);
  }

  private generateCache(): void {
    const actualSteps = this.cacheSteps - 32;
    const step = 1.0 / actualSteps;

    this.cache = new Float64Array(this.cacheSteps);
    for (let i = 0; i <= actualSteps; ++i) {
      const s = i * step * this.radius;
      this.cache[i] = this.calculate(s);
    }
  }
}
