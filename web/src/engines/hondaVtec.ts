/**
 * Honda B18C5 with VTEC, ported from
 * `assets/engines/atg-video-1/05_honda_vtec.mr`.
 *
 * This engine runs in the opposite rotational sense to the others: the starter
 * speed is negative, the ignition timing curve holds negative advance, and the
 * cam lobe layout is mirrored (intake at `-centre`, exhaust at `+centre`). All
 * of that is data, so the transcription keeps the signs exactly as written.
 */
import * as units from '../core/units';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { connectWires } from './parts';
import type {
  CamshaftSpec,
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';
import type { Func } from '../core/function';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);

const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 50],
  [100, 80],
  [150, 125],
  [200, 160],
  [250, 190],
  [300, 210],
  [350, 225],
  [400, 230],
  [450, 250],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 50],
  [100, 80],
  [150, 110],
  [200, 130],
  [250, 150],
  [300, 160],
  [350, 170],
  [400, 170],
  [450, 170],
];

export function hondaVtecSpec(): EngineSpec {
  const stroke = units.distance(87.2, units.mm);
  const bore = units.distance(81, units.mm);
  const rodLength = units.distance(5.43, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const wires = Array.from({ length: 4 }, () => new IgnitionWire());
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
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(800.0),
    runnerFlowRate: k_carb(250.0),
    runnerLength: units.distance(7.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9989,
    velocityDecay: 0.5,
  };

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(10.0, units.inch),
    primaryFlowRate: k_carb(200.0),
    velocityDecay: 1.0,
    collectorCrossSectionArea,
    length: units.volume(100.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'mild_exhaust',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 8 * 0.75 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 8 * 1.0 };

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(210, units.deg),
    gamma: 1.0,
    lift: units.distance(6.9, units.mm),
    steps: 100,
  });
  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(190, units.deg),
    gamma: 1.0,
    lift: units.distance(6.5, units.mm),
    steps: 100,
  });
  const vtecIntakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(240, units.deg),
    gamma: 0.5,
    lift: units.distance(11.5, units.mm),
    steps: 100,
  });
  const vtecExhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(232, units.deg),
    gamma: 0.5,
    lift: units.distance(10.5, units.mm),
    steps: 100,
  });

  const rot360 = units.angle(360, units.deg);
  const baseRadius = units.distance(500, units.thou);
  // Reverse-rotation layout, cylinder order 1-4-2-3 through the cycle.
  const offsets = [0, 3, 1, 2].map((n) => (n / 4) * CYCLE);

  const mirroredCam = (profile: Func, center: number, sign: 1 | -1): CamshaftSpec => ({
    lobeProfile: profile,
    baseRadius,
    lobes: offsets.map((offset) => rot360 + sign * center - offset),
  });

  const normalCenter = units.angle(116, units.deg);
  const vtecCenter = units.angle(100, units.deg);

  const cylinders = [
    { journal: 0, blowby: 0.001, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 1, blowby: 0.002, attenuation: 1.1, exhaust: exhaust1 },
    { journal: 2, blowby: 0.001, attenuation: 0.8, exhaust: exhaust0 },
    { journal: 3, blowby: 0.002, attenuation: 0.9, exhaust: exhaust1 },
  ];

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
      chamberVolume: units.volume(41.6, units.cc),
      intakeRunnerVolume: units.volume(149.6, units.cc),
      intakeRunnerCrossSectionArea:
        units.distance(1.35, units.inch) * units.distance(1.35, units.inch),
      exhaustRunnerVolume: units.volume(50.0, units.cc),
      exhaustRunnerCrossSectionArea:
        units.distance(1.25, units.inch) * units.distance(1.25, units.inch),
      intakePortFlow: flowFunction(HEAD_INTAKE_FLOW),
      exhaustPortFlow: flowFunction(HEAD_EXHAUST_FLOW),
      valvetrain: {
        kind: 'vtec',
        intakeCamshaft: mirroredCam(intakeLobe, normalCenter, -1),
        exhaustCamshaft: mirroredCam(exhaustLobe, normalCenter, 1),
        vtecIntakeCamshaft: mirroredCam(vtecIntakeLobe, vtecCenter, -1),
        vtecExhaustCamshaft: mirroredCam(vtecExhaustLobe, vtecCenter, 1),
      },
    },
  };

  connectWires(bank);

  return {
    name: 'Honda B18C5 [VTEC, I4]',
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: -units.rpm(500),
    redline: units.rpm(8400),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: { maxTurbulenceEffect: 2.5, maxBurningEfficiency: 0.75 },
    hfGain: 0.002,
    noise: 0.253,
    jitter: 0.195,
    simulationFrequency: 20000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(10, units.lb),
        mass: units.mass(35.5, units.lb),
        frictionTorque: units.torque(1.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 0.5,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(90, units.deg),
        rodJournals: journals,
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, -25],
        [1000, -25],
        [2000, -30],
        [3000, -40],
        [4000, -40],
      ]),
      revLimit: units.rpm(9400),
      limiterDuration: 0.05,
      posts: [
        { wire: wires[0], angle: (0.0 / 4.0) * CYCLE },
        { wire: wires[2], angle: (3.0 / 4.0) * CYCLE },
        { wire: wires[3], angle: (2.0 / 4.0) * CYCLE },
        { wire: wires[1], angle: (1.0 / 4.0) * CYCLE },
      ],
    },
  };
}

export const hondaVtec: EngineDefinition = {
  id: 'honda-vtec',
  label: 'Honda B18C5 VTEC',
  description: '1.8 L VTEC four — the cams switch over near 6000 rpm',
  engine: hondaVtecSpec,
  vehicle: () => ({
    mass: units.mass(2400, units.lb),
    dragCoefficient: 0.2,
    crossSectionArea: units.distance(66, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.55,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(300, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(300, units.ft_lb),
    gearRatios: [3.23, 2.105, 1.458, 1.107, 0.848],
  }),
};
