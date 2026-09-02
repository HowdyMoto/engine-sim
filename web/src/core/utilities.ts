/** Ported from `include/utilities.h` / `src/utilities.cpp`. */

export function clamp(x: number, x0 = 0.0, x1 = 1.0): number {
  if (x <= x0) return x0;
  if (x >= x1) return x1;
  return x;
}

export function modularDistance(a0: number, b0: number, mod = 1.0): number {
  const a = a0 < b0 ? a0 : b0;
  const b = a0 < b0 ? b0 : a0;
  return Math.min(b - a, a + mod - b);
}

export function positiveMod(x: number, mod: number): number {
  let v = x;
  if (v < 0) {
    v = Math.ceil(-v / mod) * mod + v;
  }
  return v % mod;
}

export function erfApproximation(x: number): number {
  const a1 = 0.278393;
  const a2 = 0.230389;
  const a3 = 0.000972;
  const a4 = 0.078108;

  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;

  const q = 1 / (1 + a1 * x + a2 * x2 + a3 * x3 + a4 * x4);
  const q2 = q * q;
  const q4 = q2 * q2;

  return 1 - q4;
}

/** Moment of inertia of a solid disk about its centre. */
export function diskMomentOfInertia(massValue: number, radius: number): number {
  return 0.5 * massValue * radius * radius;
}

/** Moment of inertia of a connecting rod modelled as a thin rod about its centre. */
export function rodMomentOfInertia(massValue: number, length: number): number {
  return (1.0 / 12.0) * massValue * length * length;
}

export function circleArea(radius: number): number {
  return Math.PI * radius * radius;
}
