/** Intake plenum and throttle body, ported from `include/intake.h` / `src/intake.cpp`. */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { GasSystem, type Mix, type FlowParameters } from './gasSystem';

export interface IntakeParameters {
  /** Plenum volume. */
  volume: number;
  crossSectionArea: number;
  /** Flow constant from atmosphere into the plenum (throttle body). */
  inputFlowK: number;
  /** Idle-circuit bypass flow constant. */
  idleFlowK: number;
  /** Flow constant from plenum into each runner. */
  runnerFlowRate: number;
  molecularAfr?: number;
  idleThrottlePlatePosition?: number;
  runnerLength?: number;
  velocityDecay?: number;
}

export class Intake {
  readonly system = new GasSystem();

  /** 0 = wide open, 1 = closed (this mirrors the original's inverted sense). */
  throttle = 1.0;

  flow = 0;
  flowRate = 0;
  totalFuelInjected = 0;

  private crossSectionArea = 0;
  private inputFlowK = 0;
  private idleFlowK = 0;
  private runnerFlowRate = 0;
  private molecularAfr = 0;
  private idleThrottlePlatePosition = 0;
  private runnerLength = 0;
  private velocityDecay = 0.5;

  private atmosphere = new GasSystem();

  // Hoisted out of `process`: it runs once per fluid sub-step per intake.
  private fuelAirMix: Mix = { p_fuel: 0, p_inert: 1, p_o2: 0 };
  private idleMix: Mix = { p_fuel: 0, p_inert: 1, p_o2: 0 };
  private flowParams: FlowParameters | null = null;

  initialize(params: IntakeParameters): void {
    const width = Math.sqrt(params.crossSectionArea);
    this.system.initialize(
      units.pressure(1.0, units.atm),
      params.volume,
      units.celcius(25.0),
    );
    this.system.setGeometry(width, params.volume / params.crossSectionArea, 1.0, 0.0);

    this.atmosphere.initialize(
      units.pressure(1.0, units.atm),
      units.volume(1000.0, units.m3),
      units.celcius(25.0),
    );
    this.atmosphere.setGeometry(
      units.distance(100.0, units.m),
      units.distance(100.0, units.m),
      1.0,
      0.0,
    );

    this.inputFlowK = params.inputFlowK;
    this.molecularAfr = params.molecularAfr ?? 25.0 / 2.0;
    this.idleFlowK = params.idleFlowK;
    this.idleThrottlePlatePosition = params.idleThrottlePlatePosition ?? 0.975;
    this.runnerLength = params.runnerLength ?? units.distance(4.0, units.inch);
    this.crossSectionArea = params.crossSectionArea;
    this.velocityDecay = params.velocityDecay ?? 0.5;
    this.runnerFlowRate = params.runnerFlowRate;
  }

  process(dt: number): void {
    const ideal_afr = 0.8 * this.molecularAfr * 4;

    const p_air = ideal_afr / (1 + ideal_afr);
    const fuelAirMix = this.fuelAirMix;
    fuelAirMix.p_fuel = 1 - p_air;
    fuelAirMix.p_inert = p_air * 0.75;
    fuelAirMix.p_o2 = p_air * 0.25;

    const idle_afr = 2.0;
    const p_idle_air = idle_afr / (1 + idle_afr);
    const fuelMix = this.idleMix;
    fuelMix.p_fuel = 1.0 - p_idle_air;
    fuelMix.p_inert = p_idle_air * 0.75;
    fuelMix.p_o2 = p_idle_air * 0.25;

    const throttle = this.getThrottlePlatePosition();
    const flowAttenuation = Math.cos((throttle * PI) / 2);

    if (this.flowParams === null) {
      this.flowParams = {
        k_flow: 0,
        dt,
        direction_x: 0.0,
        direction_y: -1.0,
        crossSectionArea_0: units.area(10, units.m2),
        crossSectionArea_1: this.crossSectionArea,
        system_0: this.atmosphere,
        system_1: this.system,
      };
    }

    const flowParams = this.flowParams;
    flowParams.dt = dt;

    this.atmosphere.reset(units.pressure(1.0, units.atm), units.celcius(25.0), fuelAirMix);
    flowParams.k_flow = flowAttenuation * this.inputFlowK;
    this.flow = GasSystem.flow(flowParams);

    this.atmosphere.reset(units.pressure(1.0, units.atm), units.celcius(25.0), fuelMix);
    flowParams.k_flow = this.idleFlowK;
    const idleCircuitFlow = GasSystem.flow(flowParams);

    this.system.dissipateExcessVelocity();
    this.system.updateVelocity(dt, this.velocityDecay);

    if (this.flow > 0) {
      this.totalFuelInjected += fuelAirMix.p_fuel * this.flow;
    }

    if (idleCircuitFlow > 0) {
      this.totalFuelInjected += fuelMix.p_fuel * idleCircuitFlow;
    }
  }

  getRunnerFlowRate(): number {
    return this.runnerFlowRate;
  }

  getThrottlePlatePosition(): number {
    return this.idleThrottlePlatePosition * this.throttle;
  }

  getRunnerLength(): number {
    return this.runnerLength;
  }

  getPlenumCrossSectionArea(): number {
    return this.crossSectionArea;
  }

  getVelocityDecay(): number {
    return this.velocityDecay;
  }
}
