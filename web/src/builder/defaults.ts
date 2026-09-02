/**
 * Defaults supplied by the script library (`es/objects/objects.mr`).
 *
 * These differ from the C++ class defaults in a few places, and the script
 * layer always wins because every engine is described through it. The
 * differences matter: `Fuel`'s C++ default leaves the turbulence-to-flame-speed
 * curve null, which makes combustion far too slow to sustain an engine, and
 * `max_dilution_effect` is 10 in the library against 50 in the class.
 */
import * as units from '../core/units';
import { makeFunction } from './functions';
import type { Func } from '../core/function';
import type { FuelParameters } from '../engine/fuel';

let cachedTurbulenceCurve: Func | null = null;

/** `turbulence_to_flame_speed_ratio_default` from `es/objects/objects.mr`. */
export function defaultTurbulenceToFlameSpeedRatio(): Func {
  if (cachedTurbulenceCurve === null) {
    cachedTurbulenceCurve = makeFunction(5.0, [
      [0.0, 3.0],
      [5.0, 1.5 * 5.0],
      [10.0, 1.5 * 10.0],
      [15.0, 1.5 * 15.0],
      [20.0, 1.5 * 20.0],
      [25.0, 1.5 * 25.0],
      [30.0, 1.5 * 30.0],
      [35.0, 1.5 * 35.0],
      [40.0, 1.5 * 40.0],
      [45.0, 1.5 * 45.0],
    ]);
  }

  return cachedTurbulenceCurve;
}

/** `fuel()` node defaults. */
export function resolveFuelParameters(params: FuelParameters | undefined): FuelParameters {
  return {
    name: 'Gasoline [Default]',
    molecularMass: units.mass(100, units.g),
    energyDensity: units.energy(48.1, units.kJ) / units.mass(1, units.g),
    density: units.mass(0.755, units.kg) / units.volume(1, units.L),
    molecularAfr: 25 / 2.0,
    maxBurningEfficiency: 0.8,
    burningEfficiencyRandomness: 0.5,
    lowEfficiencyAttenuation: 0.6,
    maxTurbulenceEffect: 2.0,
    maxDilutionEffect: 10.0,
    ...params,
    turbulenceToFlameSpeedRatio:
      params?.turbulenceToFlameSpeedRatio ?? defaultTurbulenceToFlameSpeedRatio(),
  };
}

/** `engine()` node defaults for the dynamometer range. */
export function resolveDynoRange(
  redline: number,
  spec: { dynoMinSpeed?: number; dynoMaxSpeed?: number; dynoHoldStep?: number },
): { dynoMinSpeed: number; dynoMaxSpeed: number; dynoHoldStep: number } {
  return {
    dynoMinSpeed: spec.dynoMinSpeed ?? units.rpm(1000),
    dynoMaxSpeed: spec.dynoMaxSpeed ?? redline,
    dynoHoldStep: spec.dynoHoldStep ?? units.rpm(100),
  };
}
