/**
 * Random source for the simulation.
 *
 * The original calls `rand()` directly when deciding how completely a charge
 * burns, which makes runs non-reproducible. Routing that through one injectable
 * source keeps the default behaviour (a fresh sequence each session, as in the
 * original) while letting tests pin it down.
 */
export type RandomSource = () => number;

let source: RandomSource = Math.random;

export function random(): number {
  return source();
}

export function setRandomSource(next: RandomSource): void {
  source = next;
}

export function resetRandomSource(): void {
  source = Math.random;
}

/** Small, fast, seedable PRNG (mulberry32) for reproducible runs. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
