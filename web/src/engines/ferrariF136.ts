/**
 * Ferrari F136 flat-plane V8, ported from
 * `assets/engines/atg-video-2/08_ferrari_f136_v8.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, makeFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires } from './parts';
import type {
  CylinderBankSpec,
  CylinderHeadSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

// Same head flow tables as the GM LS definition in the same video.
const INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 1],
  [100, 103],
  [150, 156],
  [200, 214],
  [250, 249],
  [300, 268],
  [350, 280],
  [400, 280],
  [450, 281],
];

const EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 1],
  [100, 72],
  [150, 113],
  [200, 160],
  [250, 196],
  [300, 222],
  [350, 235],
  [400, 245],
  [450, 246],
];

function turbulenceToFlameSpeedRatio() {
  return makeFunction(5.0, [
    [0.0, 3.0],
    [5.0, 1.5 * 5.0],
    [10.0, 1.75 * 10.0],
    [15.0, 2.0 * 15.0],
    [20.0, 2.0 * 20.0],
    [25.0, 2.0 * 25.0],
    [30.0, 2.0 * 30.0],
    [35.0, 2.0 * 35.0],
    [40.0, 2.0 * 40.0],
    [45.0, 2.0 * 45.0],
  ]);
}

export function ferrariF136Spec(): EngineSpec {
  const stroke = units.distance(81, units.mm);
  const bore = units.distance(94, units.mm);
  const rodLength = units.distance(160, units.mm);
  const rodMass = units.mass(50, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(60, units.lb);
  const flywheelMass = units.mass(30, units.lb);

  const moment =
    1.5 * diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(8, units.inch)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = deg(90);

  const wires = Array.from({ length: 8 }, () => new IgnitionWire());
  // Flat-plane: 0-180-180-0.
  const journals = [0, 180, 180, 0].map((a) => new RodJournal(deg(a)));

  const piston = () => ({
    mass: units.mass(100, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.0),
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
    intakeFlowRate: k_carb(700.0),
    runnerFlowRate: k_carb(100.0),
    runnerLength: units.distance(12.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.995,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(29.0, units.inch),
    primaryFlowRate: k_carb(600.0),
    velocityDecay: 0.5,
    length: units.distance(100, units.inch),
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 2.0 * 0.1 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 2.0 * 0.09 };

  const lobeParams = {
    durationAt50Thou: deg(230),
    gamma: 0.9,
    lift: units.distance(551, units.thou),
    steps: 256,
  };
  const intakeLobe = harmonicCamLobe(lobeParams);
  const exhaustLobe = harmonicCamLobe(lobeParams);

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(116),
    exhaustLobeCenter: deg(116),
    baseRadius: units.distance(1.0, units.inch),
  };

  const rot = deg(90);
  // Bank 0 holds cylinders 1-4, bank 1 cylinders 5-8.
  const camOffsets0 = [0, 6, 2, 4].map((n) => n * rot);
  const camOffsets1 = [1, 7, 3, 5].map((n) => n * rot);

  const head = (offsets: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(90, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(2.2, units.inch) * units.distance(2.2, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    intakePortFlow: flowFunction(INTAKE_FLOW),
    exhaustPortFlow: flowFunction(EXHAUST_FLOW),
    valvetrain: { kind: 'standard', ...bankCamshafts(camOptions, offsets) },
    flipDisplay,
  });

  const cm = (n: number) => units.distance(n, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bank0: CylinderBankSpec = {
    angle: vAngle / 2,
    bore,
    deckHeight,
    cylinders: [
      { sound: 0.9, primary: cm(2) },
      { sound: 0.8, primary: cm(1) },
      { sound: 1.1, primary: cm(3) },
      { sound: 1.0, primary: cm(5) },
    ].map((c, i) => ({
      piston: piston(),
      connectingRod: makeRod(),
      rodJournal: journals[i],
      intake,
      exhaustSystem: exhaust0,
      ignitionWire: wires[i],
      soundAttenuation: c.sound,
      primaryLength: c.primary,
    })),
    head: head(camOffsets0, true),
  };

  const bank1: CylinderBankSpec = {
    angle: -vAngle / 2,
    bore,
    deckHeight,
    cylinders: [
      { sound: 1.0, primary: cm(1) },
      { sound: 0.8, primary: cm(5) },
      { sound: 0.9, primary: cm(7) },
      { sound: 0.7, primary: cm(0) },
    ].map((c, i) => ({
      piston: piston(),
      connectingRod: makeRod(),
      rodJournal: journals[i],
      intake,
      exhaustSystem: exhaust1,
      ignitionWire: wires[4 + i],
      soundAttenuation: c.sound,
      primaryLength: c.primary,
    })),
    head: head(camOffsets1, false),
  };

  connectWires(bank0);
  connectWires(bank1);

  // 1 5 3 7 4 8 2 6, every 90 degrees.
  const firingOrder = [0, 4, 2, 6, 3, 7, 1, 5];

  return {
    name: 'Ferrari F136',
    starterTorque: units.torque(200, units.ft_lb),
    starterSpeed: units.rpm(200),
    redline: units.rpm(9000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      turbulenceToFlameSpeedRatio: turbulenceToFlameSpeedRatio(),
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.15,
    simulationFrequency: 10000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(20.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90) + vAngle / 2,
        rodJournals: journals,
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 12],
        [1000, 12],
        [2000, 20],
        [3000, 30],
        [4000, 40],
        [5000, 40],
        [6000, 40],
        [7000, 40],
        [8000, 40],
      ]),
      revLimit: units.rpm(9300),
      limiterDuration: 0.1,
      posts: firingOrder.map((wire, i) => ({ wire: wires[wire], angle: i * rot })),
    },
  };
}

export const ferrariF136: EngineDefinition = {
  id: 'ferrari-f136',
  label: 'Ferrari F136 V8',
  description: '4.5 L flat-plane V8, 9000 rpm scream',
  engine: ferrariF136Spec,
  vehicle: () => ({
    mass: units.mass(1614, units.kg),
    dragCoefficient: 0.3,
    crossSectionArea: units.distance(72, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.42,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(500, units.ft_lb),
    gearRatios: [3.23, 2.19, 1.61, 1.23, 0.97, 0.8],
  }),
};
