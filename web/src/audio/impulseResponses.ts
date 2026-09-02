/**
 * Impulse response registry, standing in for `impulse_response_library` in
 * `es/sound-library/impulse_responses.mr`.
 *
 * That library names files in `assets/sound-library/new/` and `sharp/`, neither
 * of which exists in this repository - only `smooth/` and `archive/` were ever
 * committed. So of the nine responses it declares, only `default_0` resolves.
 *
 * Rather than have every engine fall back to the same response and sound
 * identical, the missing names are mapped to available `smooth/` responses of
 * roughly the right character. These are substitutions, not the originals; if
 * the real files turn up, point the entries at them and drop this note.
 */

/** Files bundled under `public/ir/`. */
const AVAILABLE = {
  smooth_39: 'smooth_39.wav',
  smooth_05: 'smooth_05.wav',
  smooth_10: 'smooth_10.wav',
} as const;

interface Entry {
  file: string;
  /** True when this is the response the script library actually names. */
  authentic: boolean;
}

const REGISTRY: Record<string, Entry> = {
  // The one response that is present in the repository.
  default_0: { file: AVAILABLE.smooth_39, authentic: true },
  smooth_39: { file: AVAILABLE.smooth_39, authentic: true },

  // Substitutions for responses the repository does not ship.
  mild_exhaust: { file: AVAILABLE.smooth_05, authentic: false },
  mild_exhaust_reverb: { file: AVAILABLE.smooth_05, authentic: false },
  minimal_muffling_01: { file: AVAILABLE.smooth_10, authentic: false },
  minimal_muffling_02: { file: AVAILABLE.smooth_10, authentic: false },
  minimal_muffling_03: { file: AVAILABLE.smooth_10, authentic: false },
};

const FALLBACK: Entry = { file: AVAILABLE.smooth_39, authentic: false };

export function resolveImpulseResponse(name: string): { url: string; authentic: boolean } {
  const entry = REGISTRY[name] ?? FALLBACK;
  return {
    url: new URL(`./ir/${entry.file}`, document.baseURI).href,
    authentic: entry.authentic,
  };
}
