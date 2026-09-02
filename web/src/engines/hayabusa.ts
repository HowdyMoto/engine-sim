/**
 * Suzuki Hayabusa inline four, ported from
 * `assets/engines/atg-video-1/04_hayabusa.mr`.
 */
import * as units from '../core/units';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);
const CYLINDERS = 4;

const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 40],
  [100, 80],
  [150, 125],
  [200, 160],
  [250, 190],
  [300, 210],
  [350, 225],
  [400, 230],
  [450, 240],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 30],
  [100, 70],
  [150, 100],
  [200, 125],
  [250, 140],
  [300, 150],
  [350, 160],
  [400, 165],
  [450, 170],
];

export function hayabusaSpec(): EngineSpec {
  const stroke = units.distance(65, units.mm);
  const bore = units.distance(81, units.mm);
  const rodLength = units.distance(4.705, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());

  // Flat-plane crank: outer pair up, inner pair down.
  const journals = [0, 180, 180, 0].map(
    (deg) => new RodJournal(units.angle(deg, units.deg)),
  );

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(303.5, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

  const makeRod = () => ({
    mass: units.mass(395.837, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(4.5, units.L),
    plenumCrossSectionArea: units.area(10.0, units.cm2),
    intakeFlowRate: k_carb(800.0),
    runnerFlowRate: k_carb(300.0),
    runnerLength: units.distance(10.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.999,
    velocityDecay: 0.5,
  };

  // `es_params` gives a volume; the script derives a length from the default
  // collector cross-section.
  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(40.0, units.inch),
    primaryFlowRate: k_carb(500.0),
    velocityDecay: 1.0,
    collectorCrossSectionArea,
    length: units.volume(10.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_03',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 1.0 * 0.25 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 2.0 * 0.25 };

  const cylinders = [
    { journal: 0, blowby: 0.001, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 1, blowby: 0.002, attenuation: 0.8, exhaust: exhaust1 },
    { journal: 2, blowby: 0.001, attenuation: 1.1, exhaust: exhaust0 },
    { journal: 3, blowby: 0.002, attenuation: 0.9, exhaust: exhaust1 },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(240, units.deg),
    gamma: 1.2,
    lift: units.distance(345, units.thou),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(220, units.deg),
    gamma: 1.2,
    lift: units.distance(294, units.thou),
    steps: 100,
  });

  // Firing order 1-2-4-3.
  const camOffsets = [0, 1, 3, 2].map((n) => (n / 4) * CYCLE);

  const bank: CylinderBankSpec = {
    angle: 0.0,
    bore,
    deckHeight: stroke / 2 + rodLength + compressionHeight,
    cylinders: cylinders.map((cylinder, i) => ({
      piston: piston(cylinder.blowby),
      connectingRod: makeRod(),
      rodJournal: journals[cylinder.journal],
      intake,
      exhaustSystem: cylinder.exhaust,
      ignitionWire: wires[i],
      soundAttenuation: cylinder.attenuation,
    })),
    head: {
      chamberVolume: units.volume(19.2, units.cc),
      intakeRunnerVolume: units.volume(149.6, units.cc),
      intakeRunnerCrossSectionArea: units.area(10.0, units.cm2) * 2.0,
      exhaustRunnerVolume: units.volume(50.0, units.cc),
      exhaustRunnerCrossSectionArea: units.area(15.0, units.cm2) * 2.0,
      intakePortFlow: flowFunction(HEAD_INTAKE_FLOW),
      exhaustPortFlow: flowFunction(HEAD_EXHAUST_FLOW),
      valvetrain: {
        kind: 'standard',
        ...bankCamshafts(
          {
            lobeProfile: intakeLobe,
            intakeLobeProfile: intakeLobe,
            exhaustLobeProfile: exhaustLobe,
            intakeLobeCenter: units.angle(105, units.deg),
            exhaustLobeCenter: units.angle(100, units.deg),
            baseRadius: units.distance(500, units.thou),
          },
          camOffsets,
        ),
      },
    },
  };

  connectWires(bank);

  return {
    name: 'Suzuki Hayabusa I4',
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(11000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 5.5,
      maxDilutionEffect: 1000.0,
      maxBurningEfficiency: 1.0,
      burningEfficiencyRandomness: 0.0,
    },
    hfGain: 0.00407,
    noise: 0.292,
    jitter: 0.062,
    simulationFrequency: 20000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(10, units.lb),
        mass: units.mass(24.8, units.lb),
        frictionTorque: units.torque(1.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 0.2,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(90, units.deg),
        rodJournals: journals,
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 25],
        [1000, 25],
        [2000, 30],
        [3000, 40],
        [4000, 40],
      ]),
      revLimit: units.rpm(11500),
      limiterDuration: 0.05,
      posts: [0, 1, 3, 2].map((wire, i) => ({
        wire: wires[wire],
        angle: (i / CYLINDERS) * CYCLE,
      })),
    },
  };
}

export const hayabusa: EngineDefinition = {
  id: 'hayabusa',
  label: 'Suzuki Hayabusa',
  description: '1.3 L inline four, 11 000 rpm redline, motorcycle gearing',
  engine: hayabusaSpec,
  vehicle: () => ({
    mass: units.mass(563, units.lb),
    dragCoefficient: 0.1,
    crossSectionArea: units.distance(20, units.inch) * units.distance(47, units.inch),
    diffRatio: 2.353,
    tireRadius: units.distance(8.5, units.inch),
    rollingResistance: units.force(100, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(200, units.ft_lb),
    gearRatios: [2.615, 1.937, 1.526, 1.285, 1.136, 1.043],
  }),
};
