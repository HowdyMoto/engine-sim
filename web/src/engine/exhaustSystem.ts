/** Exhaust collector, ported from `include/exhaust_system.h` / `src/exhaust_system.cpp`. */
import * as units from '../core/units';
import { GasSystem, circleArea, type FlowParameters, type Mix } from './gasSystem';

export interface ExhaustSystemParameters {
  length: number;
  collectorCrossSectionArea?: number;
  outletFlowRate: number;
  primaryTubeLength: number;
  primaryFlowRate: number;
  velocityDecay?: number;
  audioVolume?: number;
  /** Name of the impulse response used for the convolution reverb. */
  impulseResponse?: string;
  impulseResponseVolume?: number;
}

export class ExhaustSystem {
  private atmosphere = new GasSystem();
  private system = new GasSystem();

  private length = 0;
  private primaryTubeLength = 0;
  private collectorCrossSectionArea = 0;
  private primaryFlowRate = 0;
  private outletFlowRate = 0;
  private audioVolume = 0;
  private velocityDecay = 0;
  private impulseResponse = '';
  private impulseResponseVolume = 1.0;

  index = -1;
  private flowValue = 0;

  // Hoisted out of `process`: it runs once per fluid sub-step per system.
  private readonly airMix: Mix = { p_fuel: 0, p_inert: 1.0, p_o2: 0.0 };
  private flowParams: FlowParameters | null = null;

  initialize(params: ExhaustSystemParameters): void {
    const collectorArea =
      params.collectorCrossSectionArea ?? circleArea(units.distance(2.0, units.inch));
    const systemWidth = Math.sqrt(collectorArea);
    const volume = collectorArea * params.length;

    this.system.initialize(
      units.pressure(1.0, units.atm),
      volume,
      units.celcius(25.0),
    );
    this.system.setGeometry(params.length, systemWidth, 1.0, 0.0);

    this.atmosphere.initialize(
      units.pressure(1.0, units.atm),
      units.volume(1000.0, units.m3),
      units.celcius(25.0),
    );
    this.atmosphere.setGeometry(
      units.distance(10.0, units.m),
      units.distance(10.0, units.m),
      1.0,
      0.0,
    );

    this.primaryFlowRate = params.primaryFlowRate;
    this.audioVolume = params.audioVolume ?? 1.0;
    this.outletFlowRate = params.outletFlowRate;
    this.collectorCrossSectionArea = collectorArea;
    this.velocityDecay = params.velocityDecay ?? 1.0;
    this.impulseResponse = params.impulseResponse ?? '';
    this.impulseResponseVolume = params.impulseResponseVolume ?? 1.0;
    this.length = params.length;
    this.primaryTubeLength = params.primaryTubeLength;
  }

  process(dt: number): void {
    this.atmosphere.reset(units.pressure(1.0, units.atm), units.celcius(25.0), this.airMix);

    if (this.flowParams === null) {
      this.flowParams = {
        k_flow: this.outletFlowRate,
        dt,
        direction_x: 1.0,
        direction_y: 0.0,
        crossSectionArea_0: this.collectorCrossSectionArea,
        crossSectionArea_1: units.area(10, units.m2),
        system_0: this.atmosphere,
        system_1: this.system,
      };
    }

    const flowParams = this.flowParams;
    flowParams.dt = dt;

    this.flowValue = GasSystem.flow(flowParams);

    this.system.dissipateExcessVelocity();
    this.system.updateVelocity(dt, this.velocityDecay);
  }

  getIndex(): number {
    return this.index;
  }

  getLength(): number {
    return this.length;
  }

  getFlow(): number {
    return this.flowValue;
  }

  getAudioVolume(): number {
    return this.audioVolume;
  }

  getPrimaryFlowRate(): number {
    return this.primaryFlowRate;
  }

  getCollectorCrossSectionArea(): number {
    return this.collectorCrossSectionArea;
  }

  getPrimaryTubeLength(): number {
    return this.primaryTubeLength;
  }

  getVelocityDecay(): number {
    return this.velocityDecay;
  }

  getImpulseResponse(): string {
    return this.impulseResponse;
  }

  getImpulseResponseVolume(): number {
    return this.impulseResponseVolume;
  }

  getSystem(): GasSystem {
    return this.system;
  }

  getAtmosphere(): GasSystem {
    return this.atmosphere;
  }
}
