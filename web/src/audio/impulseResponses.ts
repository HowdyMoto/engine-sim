/**
 * Impulse response registry, standing in for `impulse_response_library` in
 * `es/sound-library/impulse_responses.mr`.
 *
 * That library names files in `assets/sound-library/new/` and `sharp/`, neither
 * of which exists in this repository - only `smooth/` and `archive/` were ever
 * committed. So of the nine responses it declares, only `default_0` resolves.
 *
 * Rather than have every engine fall back to the same response and sound
 * identical, each missing name maps to a distinct `smooth/` response chosen
 * by measured character (energy decay time, spectral brightness), with a
 * gain normalizing its energy inside the synthesizer's 10000-tap window to
 * the default response's. These are substitutions, not the originals; if
 * the real files turn up, point the entries at them and drop this note.
 *
 * Found while measuring: the previous mild_exhaust substitute, smooth_05,
 * spends its first ~10000 samples nearly silent - and the synthesizer
 * (faithfully to the C++) truncates responses at 10000 taps. Every engine
 * mapped to it was convolving against near-silence.
 */

/** Files bundled under `public/ir/`. */
const AVAILABLE = {
  smooth_27: 'smooth_27.wav',
  smooth_28: 'smooth_28.wav',
  smooth_30: 'smooth_30.wav',
  smooth_38: 'smooth_38.wav',
  smooth_39: 'smooth_39.wav',
  smooth_47: 'smooth_47.wav',
} as const;

interface Entry {
  file: string;
  /** True when this is the response the script library actually names. */
  authentic: boolean;
  /**
   * Loudness compensation: each substitution is scaled so its total energy
   * matches the response it replaced, keeping the per-engine
   * `impulseResponseVolume` tunings valid.
   */
  gain: number;
}

const REGISTRY: Record<string, Entry> = {
  // The one response that is present in the repository.
  default_0: { file: AVAILABLE.smooth_39, authentic: true, gain: 1.0 },
  smooth_39: { file: AVAILABLE.smooth_39, authentic: true, gain: 1.0 },

  // Substitutions for responses the repository does not ship, chosen by
  // measured character: decay time and brightness. "Mild" maps to warm
  // mid-decay responses (the reverb variant to the long dark tail of
  // smooth_27), "minimal muffling" to three distinct short bright ones.
  mild_exhaust: { file: AVAILABLE.smooth_28, authentic: false, gain: 0.63 },
  mild_exhaust_reverb: { file: AVAILABLE.smooth_27, authentic: false, gain: 0.28 },
  minimal_muffling_01: { file: AVAILABLE.smooth_47, authentic: false, gain: 0.68 },
  minimal_muffling_02: { file: AVAILABLE.smooth_38, authentic: false, gain: 0.86 },
  minimal_muffling_03: { file: AVAILABLE.smooth_30, authentic: false, gain: 0.71 },
};

const FALLBACK: Entry = { file: AVAILABLE.smooth_39, authentic: false, gain: 1.0 };

export function resolveImpulseResponse(name: string): {
  url: string;
  authentic: boolean;
  gain: number;
} {
  const entry = REGISTRY[name] ?? FALLBACK;
  return {
    url: new URL(`./ir/${entry.file}`, document.baseURI).href,
    authentic: entry.authentic,
    gain: entry.gain,
  };
}
