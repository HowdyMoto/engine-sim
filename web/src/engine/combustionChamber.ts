/**
 * In-cylinder gas volume, flame propagation and piston friction, ported from
 * `include/combustion_chamber.h` / `src/combustion_chamber.cpp`.
 *
 * The chamber doubles as a `ForceGenerator`: it pushes on the piston with the
 * pressure differential across the crown plus a Stribeck friction model.
 */
import { PI, ROOT_2, E as EULER } from '../core/constants';
import * as units from '../core/units';
import { clamp } from '../core/utilities';
import { random } from '../core/random';
import { ForceGenerator } from '../physics/forceGenerator';
import { GasSystem, type Mix, type FlowParameters } from './gasSystem';
import type { SystemState } from '../physics/systemState';
import type { Func } from '../core/function';
import type { Piston } from './piston';
import type { CylinderHead } from './cylinderHead';
import type { Fuel } from './fuel';
import type { Engine } from './engine';

const STATE_SAMPLES = 256;

export interface CombustionChamberParameters {
  piston: Piston;
  head: CylinderHead;
  fuel: Fuel;
  meanPistonSpeedToTurbulence: Func;
  crankcasePressure: number;
}

export interface FrictionModelParams {
  frictionCoeff: number;
  breakawayFriction: number;
  breakawayFrictionVelocity: number;
  viscousFrictionCoefficient: number;
}

interface FlameEvent {
  lit_n: number;
  total_n: number;
  percentageLit: number;
  efficiency: number;
  flameSpeed: number;
  lastVolume: number;
  travel_x: number;
  travel_y: number;
  globalMix: Mix;
}

export class CombustionChamber extends ForceGenerator {
  readonly system = new GasSystem();
  readonly intakeRunnerAndManifold = new GasSystem();
  readonly exhaustRunnerAndPrimary = new GasSystem();

  meanPistonSpeedToTurbulence: Func | null = null;

  flameEvent: FlameEvent = {
    lit_n: 0,
    total_n: 0,
    percentageLit: 0,
    efficiency: 1.0,
    flameSpeed: 0.0,
    lastVolume: 0.0,
    travel_x: 0.0,
    travel_y: 0.0,
    globalMix: { p_fuel: 0, p_inert: 1, p_o2: 0 },
  };

  lit = false;

  frictionModel: FrictionModelParams = {
    frictionCoeff: 0.06,
    breakawayFriction: units.force(50, units.N),
    breakawayFrictionVelocity: units.distance(0.1, units.m),
    viscousFrictionCoefficient: units.force(20, units.N),
  };

  peakTemperature = 0;
  nBurntFuel = 0;

  private intakeFlowRate = 0;
  private exhaustFlowRate = 0;

  private manifoldToRunnerFlowRate = 0;
  private primaryToCollectorFlowRate = 0;
  private cylinderCrossSectionSurfaceArea = 0;
  private cylinderWidthApproximation = 0;

  private lastTimestepTotalExhaustFlow = 0;
  private lastTimestepTotalIntakeFlow = 0;
  private exhaustFlow = 0;

  private crankcasePressure = 0;

  private pressureSamples = new Float64Array(STATE_SAMPLES);
  private pistonSpeedSamples = new Float64Array(STATE_SAMPLES);

  private litLastFrame = false;

  private piston: Piston | null = null;
  private head: CylinderHead | null = null;
  private engine: Engine | null = null;
  private fuel: Fuel | null = null;

  private flowParams: FlowParameters = {
    k_flow: 0,
    dt: 0,
    direction_x: 1,
    direction_y: 0,
    crossSectionArea_0: 0,
    crossSectionArea_1: 0,
    system_0: this.system,
    system_1: this.system,
  };

  setEngine(engine: Engine): void {
    this.engine = engine;
  }

  initialize(params: CombustionChamberParameters): void {
    this.piston = params.piston;
    this.head = params.head;
    this.fuel = params.fuel;
    this.crankcasePressure = params.crankcasePressure;
    this.meanPistonSpeedToTurbulence = params.meanPistonSpeedToTurbulence;

    this.pressureSamples.fill(0);
    this.pistonSpeedSamples.fill(0);

    const cylinderIndex = this.piston.getCylinderIndex();
    const intake = this.head.getIntake(cylinderIndex);
    const exhaust = this.head.getExhaustSystem(cylinderIndex);

    this.manifoldToRunnerFlowRate = intake.getRunnerFlowRate();
    this.primaryToCollectorFlowRate = exhaust.getPrimaryFlowRate();

    const bore_r = this.head.getCylinderBank().getBore() / 2.0;
    this.cylinderCrossSectionSurfaceArea = PI * bore_r * bore_r;
    this.cylinderWidthApproximation = Math.sqrt(this.cylinderCrossSectionSurfaceArea);

    const height = this.getVolume() / this.cylinderCrossSectionSurfaceArea;
    this.system.setGeometry(this.cylinderWidthApproximation, height, 1.0, 0.0);

    const intakeRunnerCrossSection = this.head.getIntakeRunnerCrossSectionArea();
    const intakeRunnerWidth = Math.sqrt(intakeRunnerCrossSection);
    const manifoldRunnerLength = intake.getRunnerLength();
    const manifoldRunnerVolume = intakeRunnerCrossSection * manifoldRunnerLength;
    const totalIntakeRunnerVolume = this.head.getIntakeRunnerVolume() + manifoldRunnerVolume;
    const overallIntakeRunnerLength = totalIntakeRunnerVolume / intakeRunnerCrossSection;

    this.intakeRunnerAndManifold.initialize(
      units.pressure(1.0, units.atm),
      totalIntakeRunnerVolume,
      units.celcius(25.0),
    );
    this.intakeRunnerAndManifold.setGeometry(
      overallIntakeRunnerLength,
      intakeRunnerWidth,
      1.0,
      0.0,
    );

    const exhaustRunnerCrossSection = this.head.getExhaustRunnerCrossSectionArea();
    const exhaustRunnerWidth = Math.sqrt(exhaustRunnerCrossSection);
    const exhaustTubeLength =
      exhaust.getPrimaryTubeLength() + this.head.getHeaderPrimaryLength(cylinderIndex);
    const exhaustTubeVolume = exhaustRunnerCrossSection * exhaustTubeLength;
    const totalExhaustRunnerVolume = this.head.getExhaustRunnerVolume() + exhaustTubeVolume;
    const overallExhaustRunnerLength = totalExhaustRunnerVolume / exhaustRunnerCrossSection;

    this.exhaustRunnerAndPrimary.initialize(
      units.pressure(1.0, units.atm),
      totalExhaustRunnerVolume,
      units.celcius(25.0),
    );
    this.exhaustRunnerAndPrimary.setGeometry(
      overallExhaustRunnerLength,
      exhaustRunnerWidth,
      1.0,
      0.0,
    );
  }

  getCylinderHead(): CylinderHead {
    return this.head!;
  }

  getPiston(): Piston {
    return this.piston!;
  }

  /** Swept volume above the piston crown plus the combustion port volume. */
  getVolume(): number {
    const combustionPortVolume = this.head!.getCombustionChamberVolume();
    const bank = this.head!.getCylinderBank();

    const area = bank.boreSurfaceArea();
    const s = this.piston!.relativeX() * bank.getDx() + this.piston!.relativeY() * bank.getDy();
    const sweep = area * (bank.getDeckHeight() - s - this.piston!.getCompressionHeight());

    return sweep + combustionPortVolume - this.piston!.getDisplacement();
  }

  pistonSpeed(): number {
    const bank = this.head!.getCylinderBank();
    return this.piston!.body.v_x * bank.getDx() + this.piston!.body.v_y * bank.getDy();
  }

  calculateMeanPistonSpeed(): number {
    let avg = 0;
    for (let i = 0; i < STATE_SAMPLES; ++i) avg += this.pistonSpeedSamples[i];
    return avg / STATE_SAMPLES;
  }

  calculateFiringPressure(): number {
    let firingPressure = 0;
    for (let i = 0; i < STATE_SAMPLES; ++i) {
      if (this.pressureSamples[i] > firingPressure) firingPressure = this.pressureSamples[i];
    }
    return firingPressure;
  }

  isLit(): boolean {
    return this.lit;
  }

  popLitLastFrame(): boolean {
    const lit = this.litLastFrame;
    this.litLastFrame = false;
    return lit;
  }

  /** Attempt to start a flame kernel; rejected outside the flammability limits. */
  ignite(): void {
    if (this.lit) return;

    const mix = this.system.mix();
    if (mix.p_fuel === 0) return;

    const afr = mix.p_o2 / mix.p_fuel;
    const equivalenceRatio = afr / this.fuel!.getMolecularAfr();
    if (equivalenceRatio < 0.5) return;
    if (equivalenceRatio > 1.9) return;

    const idealInert = mix.p_o2 / 0.7;
    const dilution = mix.p_inert / idealInert - 1;

    this.flameEvent.lastVolume = this.getVolume();
    this.flameEvent.travel_x = 0;
    this.flameEvent.travel_y = 0;
    this.flameEvent.lit_n = 0;
    this.flameEvent.total_n = this.system.n();
    this.flameEvent.percentageLit = 0;
    this.flameEvent.globalMix = mix;
    this.lit = true;
    this.litLastFrame = true;

    const randomness = this.fuel!.getBurningEfficiencyRandomness();
    const lowEfficiencyAttenuation = this.fuel!.getLowEfficiencyAttenuation();
    const maxBurningEfficiency = this.fuel!.getMaxBurningEfficiency();
    const maxTurbulenceEffect = this.fuel!.getMaxTurbulenceEffect();
    const maxDilutionEffect = this.fuel!.getMaxDilutionEffect();

    const turbulence = this.meanPistonSpeedToTurbulence!.sampleTriangle(
      this.calculateMeanPistonSpeed(),
    );
    const mixingFactor =
      1.0 - clamp(turbulence / maxTurbulenceEffect) * clamp(1 - dilution / maxDilutionEffect);
    const rand_s = lowEfficiencyAttenuation * (1 - randomness + randomness * random());
    const efficiencyAttenuation = mixingFactor * rand_s + (1 - mixingFactor);

    this.flameEvent.efficiency = efficiencyAttenuation * maxBurningEfficiency;
    this.flameEvent.flameSpeed = this.fuel!.flameSpeed(
      turbulence,
      afr,
      this.system.temperature(),
      this.system.pressure(),
      this.calculateFiringPressure(),
      units.pressure(160, units.psi),
    );
  }

  update(_dt: number): void {
    this.system.setVolume(this.getVolume());

    this.updateCycleStates();

    const cylinderIndex = this.piston!.getCylinderIndex();
    this.intakeFlowRate = this.head!.intakeFlowRate(cylinderIndex);
    this.exhaustFlowRate = this.head!.exhaustFlowRate(cylinderIndex);
  }

  /** One fluid sub-step: port flows, heat transfer and flame propagation. */
  flow(dt: number): void {
    if (this.system.temperature() > this.peakTemperature) {
      this.peakTemperature = this.system.temperature();
    }

    const volume = this.getVolume();
    const cylinderHeight = volume / this.cylinderCrossSectionSurfaceArea;
    const cylinderSurfaceArea =
      cylinderHeight * PI * this.head!.getCylinderBank().getBore() +
      this.cylinderCrossSectionSurfaceArea * 2;

    const dT = units.celcius(90.0) - this.system.temperature();

    this.system.changeEnergy(dT * cylinderSurfaceArea * 100 * dt);
    this.system.flowEnv(
      this.piston!.getBlowbyK(),
      dt,
      this.crankcasePressure,
      units.celcius(25.0),
    );

    const cylinderIndex = this.piston!.getCylinderIndex();
    const intake = this.head!.getIntake(cylinderIndex);
    const exhaust = this.head!.getExhaustSystem(cylinderIndex);

    const p = this.flowParams;
    p.dt = dt;
    p.direction_x = 1.0;
    p.direction_y = 0.0;

    // Plenum -> intake runner
    p.k_flow = this.manifoldToRunnerFlowRate;
    p.crossSectionArea_0 = intake.getPlenumCrossSectionArea();
    p.crossSectionArea_1 = this.head!.getIntakeRunnerCrossSectionArea();
    p.system_0 = intake.system;
    p.system_1 = this.intakeRunnerAndManifold;
    GasSystem.flow(p);

    this.intakeRunnerAndManifold.dissipateExcessVelocity();

    // Intake runner -> cylinder
    p.k_flow = this.intakeFlowRate;
    p.crossSectionArea_0 = this.head!.getIntakeRunnerCrossSectionArea();
    p.crossSectionArea_1 = volume / cylinderHeight;
    p.system_0 = this.intakeRunnerAndManifold;
    p.system_1 = this.system;
    const intakeFlow = GasSystem.flow(p);

    this.intakeRunnerAndManifold.dissipateExcessVelocity();
    this.system.dissipateExcessVelocity();

    // Cylinder -> exhaust runner
    p.k_flow = this.exhaustFlowRate;
    p.crossSectionArea_0 = volume / cylinderHeight;
    p.crossSectionArea_1 = this.head!.getExhaustRunnerCrossSectionArea();
    p.system_0 = this.system;
    p.system_1 = this.exhaustRunnerAndPrimary;
    const exhaustFlow = GasSystem.flow(p);

    this.system.dissipateExcessVelocity();
    this.exhaustRunnerAndPrimary.dissipateExcessVelocity();

    // Exhaust runner -> collector
    p.k_flow = this.primaryToCollectorFlowRate;
    p.crossSectionArea_0 = this.head!.getExhaustRunnerCrossSectionArea();
    p.crossSectionArea_1 = exhaust.getCollectorCrossSectionArea();
    p.system_0 = this.exhaustRunnerAndPrimary;
    p.system_1 = exhaust.getSystem();
    GasSystem.flow(p);

    this.intakeRunnerAndManifold.updateVelocity(dt, intake.getVelocityDecay());
    this.system.updateVelocity(dt, 0.5);
    this.exhaustRunnerAndPrimary.updateVelocity(dt, exhaust.getVelocityDecay());

    // Fresh charge entering the cylinder quenches an active flame.
    if (Math.abs(intakeFlow) > 1e-9 && this.lit) {
      this.lit = false;
    }

    this.exhaustFlow = exhaustFlow;
    this.lastTimestepTotalExhaustFlow += exhaustFlow;
    this.lastTimestepTotalIntakeFlow += intakeFlow;

    if (this.lit) {
      const bank = this.head!.getCylinderBank();
      const totalTravel_x = bank.getBore() / 2;
      const totalTravel_y = volume / bank.boreSurfaceArea();
      const expansion = volume / this.flameEvent.lastVolume;
      const lastTravel_x = this.flameEvent.travel_x;
      const lastTravel_y = this.flameEvent.travel_y * expansion;
      const flameSpeed = this.flameEvent.flameSpeed;

      this.flameEvent.travel_x = Math.min(lastTravel_x + dt * flameSpeed, totalTravel_x);
      this.flameEvent.travel_y = Math.min(lastTravel_y + dt * flameSpeed, totalTravel_y);

      if (
        lastTravel_x < this.flameEvent.travel_x ||
        lastTravel_y < this.flameEvent.travel_y
      ) {
        const burnedVolume =
          this.flameEvent.travel_x * this.flameEvent.travel_x * PI * this.flameEvent.travel_y;
        const prevBurnedVolume = lastTravel_x * lastTravel_x * PI * lastTravel_y;
        const litVolume = burnedVolume - prevBurnedVolume;
        const n = (litVolume / volume) * this.system.n();

        const fuelBurned = this.system.react(
          n * this.flameEvent.efficiency,
          this.flameEvent.globalMix,
        );
        const massFuelBurned = fuelBurned * this.fuel!.getMolecularMass();
        this.system.changeEnergy(massFuelBurned * this.fuel!.getEnergyDensity());

        this.flameEvent.lit_n += n;
        this.flameEvent.percentageLit += litVolume / volume;

        this.nBurntFuel += massFuelBurned;
      } else {
        this.lit = false;
      }

      this.flameEvent.lastVolume = volume;
    }
  }

  /** Mass air-fuel ratio of the charge that was burnt in the last flame event. */
  lastEventAfr(): number {
    const totalFuel = this.flameEvent.globalMix.p_fuel * this.flameEvent.total_n;
    const totalOxygen = this.flameEvent.globalMix.p_o2 * this.flameEvent.total_n;
    const totalInert = this.flameEvent.globalMix.p_inert * this.flameEvent.total_n;

    const octaneMolarMass = units.mass(114.23, units.g);
    const oxygenMolarMass = units.mass(31.9988, units.g);
    const nitrogenMolarMass = units.mass(28.014, units.g);

    if (totalFuel === 0) return 0;
    return (
      (oxygenMolarMass * totalOxygen + totalInert * nitrogenMolarMass) /
      (totalFuel * octaneMolarMass)
    );
  }

  getLastIterationExhaustFlow(): number {
    return this.exhaustFlow;
  }

  resetLastTimestepExhaustFlow(): void {
    this.lastTimestepTotalExhaustFlow = 0;
  }

  getLastTimestepExhaustFlow(): number {
    return this.lastTimestepTotalExhaustFlow;
  }

  resetLastTimestepIntakeFlow(): void {
    this.lastTimestepTotalIntakeFlow = 0;
  }

  getLastTimestepIntakeFlow(): number {
    return this.lastTimestepTotalIntakeFlow;
  }

  /** Stribeck friction curve: breakaway peak, Coulomb plateau, viscous term. */
  private calculateFrictionForce(v_s: number): number {
    const cylinderWallForce = this.piston!.calculateCylinderWallForce();

    const F_coul = this.frictionModel.frictionCoeff * cylinderWallForce;
    const v_st = this.frictionModel.breakawayFrictionVelocity * ROOT_2;
    const v_coul = this.frictionModel.breakawayFrictionVelocity / 10;
    const F_brk = this.frictionModel.breakawayFriction;
    const v = Math.abs(v_s);

    const F_0 = ROOT_2 * EULER * (F_brk - F_coul);
    const F_1 = v / v_st;
    const F_2 = Math.exp(-F_1 * F_1) * F_1;
    const F_3 = F_coul * Math.tanh(v / v_coul);
    const F_4 = this.frictionModel.viscousFrictionCoefficient * v;

    return F_0 * F_2 + F_3 + F_4;
  }

  getFrictionForce(): number {
    const bank = this.head!.getCylinderBank();
    const v_s = this.piston!.body.v_x * bank.getDx() + this.piston!.body.v_y * bank.getDy();
    return this.calculateFrictionForce(v_s);
  }

  private updateCycleStates(): void {
    let crankAngle = this.engine!.getOutputCrankshaft().getCycleAngle();
    if (!Number.isFinite(crankAngle)) crankAngle = 0.0;

    let i = Math.round((crankAngle / (4 * PI)) * (STATE_SAMPLES - 1.0));
    if (i < 0) i = 0;
    else if (i >= STATE_SAMPLES) i = STATE_SAMPLES - 1;

    this.pistonSpeedSamples[i] = Math.abs(this.pistonSpeed());
    this.pressureSamples[i] = this.system.pressure();
  }

  override apply(system: SystemState): void {
    const bank = this.head!.getCylinderBank();
    const area = ((bank.getBore() * bank.getBore()) / 4.0) * PI;
    const index = this.piston!.body.index;

    const v_x = system.v_x[index];
    const v_y = system.v_y[index];
    const v_s = v_x * bank.getDx() + v_y * bank.getDy();

    const pressureDifferential = this.system.pressure() - this.crankcasePressure;
    const force = -area * pressureDifferential;

    if (!Number.isFinite(force)) return;

    const limit = 1e-3;
    const abs_v_s = Math.min(Math.abs(v_s), limit);
    const attenuation = abs_v_s / limit;

    const F = this.calculateFrictionForce(v_s) * attenuation;
    const F_fric = v_s > 0 ? -F : F;

    system.applyForce(
      0.0,
      0.0,
      (force + F_fric) * bank.getDx(),
      (force + F_fric) * bank.getDy(),
      index,
    );
  }
}
