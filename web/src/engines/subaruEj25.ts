/**
 * Subaru EJ25 (equal-length headers), ported from
 * `assets/engines/atg-video-2/01_subaru_ej25_eh.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, makeFunction, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { connectWires, MODERN_4V_EXHAUST_FLOW, MODERN_4V_INTAKE_FLOW } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
  CylinderSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);

function turbulenceToFlameSpeedRatio() {
  return makeFunction(5.0, [
    [0.0, 3.0],
    [5.0, 1.5 * 5.0],
    [10.0, 1.5 * 10.0],
    [15.0, 1.1 * 1.5 * 15.0],
    [20.0, 1.25 * 1.5 * 20.0],
    [25.0, 1.25 * 1.5 * 25.0],
    [30.0, 1.25 * 1.5 * 30.0],
    [35.0, 1.25 * 1.5 * 35.0],
    [40.0, 1.25 * 1.5 * 40.0],
    [45.0, 1.25 * 1.5 * 45.0],
  ]);
}

export function subaruEj25Spec(): EngineSpec {
  const stroke = units.distance(79, units.mm);
  const bore = units.distance(99.5, units.mm);
  const rodLength = units.distance(5.142, units.inch);
  const rodMass = units.mass(535, units.g);
  const compressionHeight = units.distance(1.0, units.inch);
  const crankMass = units.mass(9.39, units.kg);
  const flywheelMass = units.mass(6.8, units.kg);
  const flywheelRadius = units.distance(6, units.inch);

  const crankMoment = diskMomentOfInertia(crankMass, stroke / 2);
  const flywheelMoment = diskMomentOfInertia(flywheelMass, flywheelRadius) * 2;
  const otherMoment = diskMomentOfInertia(units.mass(10, units.kg), units.distance(6.0, units.cm));

  const wires = Array.from({ length: 4 }, () => new IgnitionWire());

  const rj0 = new RodJournal(units.angle(0.0, units.deg));
  const rj1 = new RodJournal(units.angle(180.0, units.deg));
  const rj2 = new RodJournal(units.angle(0.0, units.deg));
  const rj3 = new RodJournal(units.angle(180.0, units.deg));

  const pistonMass = units.mass(414 + 152, units.g);

  const piston = (blowbyScfm: number) => ({
    mass: pistonMass,
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(400.0),
    runnerFlowRate: k_carb(100.0),
    runnerLength: units.distance(12.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9978,
    velocityDecay: 1.0,
  };

  const exhaust0: ExhaustSpec = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(40.0, units.inch),
    primaryFlowRate: k_carb(400.0),
    velocityDecay: 1.0,
    length: units.distance(500, units.mm),
    audioVolume: 0.5 * 0.02,
    impulseResponse: 'minimal_muffling_02',
    impulseResponseVolume: 0.01,
  };

  const cylinder = (
    rodJournal: RodJournal,
    wire: IgnitionWire,
    blowbyScfm: number,
    primaryLength: number,
    soundAttenuation: number,
  ): CylinderSpec => ({
    piston: piston(blowbyScfm),
    connectingRod: makeRod(),
    rodJournal,
    intake,
    exhaustSystem: exhaust0,
    ignitionWire: wire,
    primaryLength,
    soundAttenuation,
  });

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(232, units.deg),
    gamma: 2.0,
    lift: units.distance(9.78, units.mm),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(236, units.deg),
    gamma: 2.0,
    lift: units.distance(9.6, units.mm),
    steps: 100,
  });

  const intakeLobeCenter = units.angle(117, units.deg);
  const exhaustLobeCenter = units.angle(112, units.deg);
  const baseRadius = units.distance(34.0 / 2, units.mm);
  const rot360 = units.angle(360, units.deg);

  const head = (cycleOffsets: number[], flipDisplay: boolean) => ({
    chamberVolume: units.volume(67, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(1.25, units.inch) * units.distance(1.25, units.inch),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW),
    valvetrain: {
      kind: 'standard' as const,
      intakeCamshaft: {
        lobeProfile: intakeLobe,
        baseRadius,
        lobes: cycleOffsets.map((o) => rot360 + intakeLobeCenter + (o / 4) * CYCLE),
      },
      exhaustCamshaft: {
        lobeProfile: exhaustLobe,
        baseRadius,
        lobes: cycleOffsets.map((o) => rot360 - exhaustLobeCenter + (o / 4) * CYCLE),
      },
    },
    flipDisplay,
  });

  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bank0: CylinderBankSpec = {
    angle: units.angle(90.0, units.deg),
    bore,
    deckHeight,
    cylinders: [
      cylinder(rj0, wires[0], 0.001, units.distance(2.0, units.inch), 0.9),
      cylinder(rj3, wires[2], 0.002, units.distance(3.0, units.inch), 1.0),
    ],
    head: head([0, 1], true),
  };

  const bank1: CylinderBankSpec = {
    angle: units.angle(-90.0, units.deg),
    bore,
    deckHeight,
    cylinders: [
      cylinder(rj1, wires[1], 0.001, units.distance(3.0, units.inch), 1.1),
      cylinder(rj2, wires[3], 0.002, units.distance(5.0, units.inch), 0.9),
    ],
    head: head([2, 3], false),
  };

  connectWires(bank0);
  connectWires(bank1);

  return {
    name: 'Subaru EJ25',
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(6500),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 0.9,
      turbulenceToFlameSpeedRatio: turbulenceToFlameSpeedRatio(),
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.5,
    simulationFrequency: 20000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(1.0, units.ft_lb),
        momentOfInertia: crankMoment + flywheelMoment + otherMoment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(180, units.deg),
        rodJournals: [rj0, rj1, rj2, rj3],
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 25],
        [1000, 25],
        [2000, 30],
        [3000, 40],
        [4000, 40],
      ]),
      revLimit: units.rpm(6800),
      limiterDuration: 0.16,
      posts: [
        { wire: wires[0], angle: (0.0 / 4.0) * CYCLE },
        { wire: wires[2], angle: (1.0 / 4.0) * CYCLE },
        { wire: wires[1], angle: (2.0 / 4.0) * CYCLE },
        { wire: wires[3], angle: (3.0 / 4.0) * CYCLE },
      ],
    },
  };
}

const CAR_MASS = units.mass(2700, units.lb);

export const subaruEj25: EngineDefinition = {
  id: 'subaru-ej25',
  label: 'Subaru EJ25',
  description: '2.5 L flat-four, equal-length headers, single collector',
  engine: subaruEj25Spec,
  vehicle: () => ({
    mass: CAR_MASS,
    dragCoefficient: 0.3,
    crossSectionArea: units.distance(72, units.inch) * units.distance(56, units.inch),
    diffRatio: 3.9,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: 0.015 * CAR_MASS * 9.81,
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(300, units.ft_lb),
    gearRatios: [3.636, 2.375, 1.761, 1.346, 0.971, 0.756],
  }),
};
