/** Ported from `include/fuel.h` / `src/fuel.cpp`. */
import * as units from '../core/units';
import type { Func } from '../core/function';

export interface FuelParameters {
  name?: string;
  molecularMass?: number;
  energyDensity?: number;
  density?: number;
  molecularAfr?: number;
  burningEfficiencyRandomness?: number;
  lowEfficiencyAttenuation?: number;
  maxBurningEfficiency?: number;
  maxTurbulenceEffect?: number;
  maxDilutionEffect?: number;
  turbulenceToFlameSpeedRatio?: Func | null;
}

export class Fuel {
  private name = 'Gasoline';
  private molecularMass = units.mass(100.0, units.g);
  private energyDensity = units.energy(48.1, units.kJ) / units.mass(1.0, units.g);
  private density = units.mass(0.755, units.kg) / units.volume(1.0, units.L);
  private molecularAfr = 25 / 2.0;
  private maxBurningEfficiency = 0.8;
  private burningEfficiencyRandomness = 0.5;
  private lowEfficiencyAttenuation = 0.6;
  private maxTurbulenceEffect = 2.0;
  private maxDilutionEffect = 50.0;

  private turbulenceToFlameSpeedRatio: Func | null = null;

  initialize(params: FuelParameters): void {
    this.name = params.name ?? this.name;
    this.molecularMass = params.molecularMass ?? this.molecularMass;
    this.energyDensity = params.energyDensity ?? this.energyDensity;
    this.density = params.density ?? this.density;
    this.molecularAfr = params.molecularAfr ?? this.molecularAfr;
    this.burningEfficiencyRandomness =
      params.burningEfficiencyRandomness ?? this.burningEfficiencyRandomness;
    this.maxBurningEfficiency = params.maxBurningEfficiency ?? this.maxBurningEfficiency;
    this.maxDilutionEffect = params.maxDilutionEffect ?? this.maxDilutionEffect;
    this.maxTurbulenceEffect = params.maxTurbulenceEffect ?? this.maxTurbulenceEffect;
    this.lowEfficiencyAttenuation =
      params.lowEfficiencyAttenuation ?? this.lowEfficiencyAttenuation;
    this.turbulenceToFlameSpeedRatio =
      params.turbulenceToFlameSpeedRatio ?? this.turbulenceToFlameSpeedRatio;
  }

  getName(): string {
    return this.name;
  }

  getMolecularMass(): number {
    return this.molecularMass;
  }

  getEnergyDensity(): number {
    return this.energyDensity;
  }

  getDensity(): number {
    return this.density;
  }

  getBurningEfficiencyRandomness(): number {
    return this.burningEfficiencyRandomness;
  }

  getLowEfficiencyAttenuation(): number {
    return this.lowEfficiencyAttenuation;
  }

  getMaxBurningEfficiency(): number {
    return this.maxBurningEfficiency;
  }

  getMaxTurbulenceEffect(): number {
    return this.maxTurbulenceEffect;
  }

  getMaxDilutionEffect(): number {
    return this.maxDilutionEffect;
  }

  getMolecularAfr(): number {
    return this.molecularAfr;
  }

  /** Turbulent flame speed for the given in-cylinder conditions. */
  flameSpeed(
    turbulence: number,
    molecularAfr: number,
    T: number,
    P: number,
    _firingPressure: number,
    _motoringPressure: number,
  ): number {
    const S_L = this.laminarBurningVelocity(molecularAfr, T, P);
    const p_adjustment = 1.0;

    if (this.turbulenceToFlameSpeedRatio === null) return S_L;
    return this.turbulenceToFlameSpeedRatio.sampleTriangle((turbulence / S_L) * p_adjustment) * S_L;
  }

  /** Empirical laminar burning velocity correlation for gasoline. */
  laminarBurningVelocity(molecularAfr: number, T: number, P: number): number {
    const er_m = 1.21;
    const B_m = units.distance(30.5, units.cm) / units.sec;
    const B_er = -units.distance(54.9, units.cm) / units.sec;

    const er = molecularAfr / this.molecularAfr;
    const alpha = 2.4 - 0.271 * Math.pow(er, 3.51);
    const beta = -0.357 + 0.14 * Math.pow(er, 2.77);

    const S_L_0 = B_m + B_er * (er - er_m) * (er - er_m);
    const T_ratio = T / units.kelvin(298);
    const P_ratio = P / units.pressure(1.0, units.atm);

    return S_L_0 * Math.pow(T_ratio, alpha) * Math.pow(P_ratio, beta);
  }
}
