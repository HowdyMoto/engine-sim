/**
 * Declarative engine description.
 *
 * The C++ project describes engines in a bespoke scripting language (`.mr`
 * files compiled by piranha). This module is the TypeScript equivalent of that
 * node graph: the same concepts (rod journals, ignition wires, banks, heads)
 * expressed as plain objects, so `.mr` definitions translate one-for-one.
 */
import * as units from '../core/units';
import type { Func } from '../core/function';
import type { FuelParameters } from '../engine/fuel';
import type { VehicleParameters } from '../engine/vehicle';
import type { TransmissionParameters } from '../engine/transmission';

/** Identity object shared between a crankshaft (or master rod) and its rods. */
export class RodJournal {
  /** Set by the crankshaft or master rod that owns this journal. */
  ownerCrankshaft: CrankshaftSpec | null = null;
  ownerRod: ConnectingRodSpec | null = null;

  constructor(public angle: number) {}
}

/** Identity object linking an ignition module post to a cylinder. */
export class IgnitionWire {
  readonly connections: { bank: CylinderBankSpec; index: number }[] = [];

  connect(bank: CylinderBankSpec, index: number): void {
    this.connections.push({ bank, index });
  }
}

export interface CrankshaftSpec {
  throw: number;
  flywheelMass: number;
  mass: number;
  frictionTorque?: number;
  momentOfInertia: number;
  positionX?: number;
  positionY?: number;
  /** Top-dead-centre offset in crank radians. */
  tdc?: number;
  rodJournals: RodJournal[];
}

export interface PistonSpec {
  mass: number;
  compressionHeight: number;
  wristPinPosition?: number;
  displacement?: number;
  blowby?: number;
}

export interface ConnectingRodSpec {
  mass: number;
  momentOfInertia: number;
  centerOfMass?: number;
  length: number;
  /** Journals this rod carries when it is a master rod (radial engines). */
  rodJournals?: RodJournal[];
  slaveThrow?: number;
}

export interface IntakeSpec {
  plenumVolume: number;
  plenumCrossSectionArea: number;
  intakeFlowRate: number;
  runnerFlowRate?: number;
  runnerLength?: number;
  idleFlowRate: number;
  idleThrottlePlatePosition?: number;
  velocityDecay?: number;
  molecularAfr?: number;
}

export interface ExhaustSpec {
  length: number;
  outletFlowRate: number;
  primaryTubeLength: number;
  primaryFlowRate: number;
  collectorCrossSectionArea?: number;
  velocityDecay?: number;
  audioVolume?: number;
  impulseResponse?: string;
  impulseResponseVolume?: number;
}

export type ValvetrainSpec =
  | { kind: 'standard'; intakeCamshaft: CamshaftSpec; exhaustCamshaft: CamshaftSpec }
  | {
      kind: 'vtec';
      intakeCamshaft: CamshaftSpec;
      exhaustCamshaft: CamshaftSpec;
      vtecIntakeCamshaft: CamshaftSpec;
      vtecExhaustCamshaft: CamshaftSpec;
      minRpm?: number;
      minSpeed?: number;
      manifoldVacuum?: number;
      minThrottlePosition?: number;
    };

export interface CamshaftSpec {
  lobeProfile: Func;
  advance?: number;
  baseRadius?: number;
  /** Lobe centrelines in crank radians, one per cylinder on this bank. */
  lobes: number[];
}

export interface CylinderHeadSpec {
  chamberVolume: number;
  intakeRunnerVolume: number;
  intakeRunnerCrossSectionArea: number;
  exhaustRunnerVolume: number;
  exhaustRunnerCrossSectionArea: number;
  intakePortFlow: Func;
  exhaustPortFlow: Func;
  valvetrain: ValvetrainSpec;
  flipDisplay?: boolean;
}

export interface CylinderSpec {
  piston: PistonSpec;
  connectingRod: ConnectingRodSpec;
  rodJournal: RodJournal;
  intake: IntakeSpec;
  exhaustSystem: ExhaustSpec;
  ignitionWire: IgnitionWire;
  soundAttenuation?: number;
  primaryLength?: number;
}

export interface CylinderBankSpec {
  angle: number;
  bore: number;
  deckHeight: number;
  positionX?: number;
  positionY?: number;
  displayDepth?: number;
  cylinders: CylinderSpec[];
  head: CylinderHeadSpec;
}

export interface IgnitionModuleSpec {
  timingCurve: Func;
  revLimit?: number;
  limiterDuration?: number;
  /** Firing order: each wire fires at `angle` radians into the 720-degree cycle. */
  posts: { wire: IgnitionWire; angle: number }[];
}

export type ThrottleSpec =
  | { kind: 'direct'; gamma?: number }
  | {
      kind: 'governor';
      minSpeed: number;
      maxSpeed: number;
      minVelocity: number;
      maxVelocity: number;
      k_s: number;
      k_d: number;
      gamma: number;
    };

export interface EngineSpec {
  name: string;
  starterTorque?: number;
  starterSpeed?: number;
  redline?: number;
  dynoMinSpeed?: number;
  dynoMaxSpeed?: number;
  dynoHoldStep?: number;

  throttle?: ThrottleSpec;
  fuel?: FuelParameters;

  simulationFrequency?: number;
  hfGain?: number;
  noise?: number;
  jitter?: number;

  crankshafts: CrankshaftSpec[];
  banks: CylinderBankSpec[];
  ignitionModule: IgnitionModuleSpec;
}

export interface EngineDefinition {
  id: string;
  label: string;
  /** Short description shown in the engine picker. */
  description: string;
  engine: () => EngineSpec;
  vehicle: () => VehicleParameters;
  transmission: () => TransmissionParameters;
}

/** Default vehicle used when a definition does not supply one. */
export function defaultVehicle(): VehicleParameters {
  return {
    mass: units.mass(1597, units.kg),
    dragCoefficient: 0.25,
    crossSectionArea: units.distance(72, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.42,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: 2000 * units.N,
  };
}
