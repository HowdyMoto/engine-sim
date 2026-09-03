/**
 * BMW M52B28 inline six, ported from `assets/engines/bmw/M52B28.mr`.
 *
 * The source file defines only the engine - no vehicle or transmission - so
 * this supplies an E36-flavoured car and a ZF five-speed. Those two blocks are
 * the port's own; everything else is the original's data.
 */
import * as units from '../core/units';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { flowFunctionMm, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires, performerRpmIntake } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);
const CYLINDERS = 6;

const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [1, 35],
  [2, 60],
  [3, 90],
  [4, 125],
  [5, 150],
  [6, 175],
  [7, 200],
  [8, 215],
  [9, 230],
  [10, 235],
  [11, 235],
  [12, 238],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [1, 35],
  [2, 55],
  [3, 85],
  [4, 105],
  [5, 120],
  [6, 140],
  [7, 150],
  [8, 155],
  [9, 160],
  [10, 165],
  [11, 165],
  [12, 165],
];

export function bmwM52Spec(): EngineSpec {
  const stroke = units.distance(84, units.mm);
  const bore = units.distance(84, units.mm);
  const rodLength = units.distance(135.0, units.mm);

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());
  const journals = [0, 120, 240, 240, 120, 0].map(
    (deg) => new RodJournal(units.angle(deg, units.deg)),
  );

  const piston = () => ({
    mass: units.mass(280, units.g),
    compressionHeight: units.distance(31.82, units.mm),
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.1),
  });

  const makeRod = () => ({
    mass: units.mass(300.0, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = performerRpmIntake({
    carburetorCfm: 500.0,
    idleFlowRateCfm: 0.1,
    idleThrottlePlatePosition: 0.994,
  });

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(20.0, units.inch),
    primaryFlowRate: k_carb(200.0),
    velocityDecay: 1.0,
    collectorCrossSectionArea,
    length: units.volume(50.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'default_0',
    impulseResponseVolume: 0.001,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 0.5 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 1.0 };

  const lobeParams = {
    durationAt50Thou: units.angle(210, units.deg),
    gamma: 0.8,
    lift: units.distance(9.0, units.mm),
    steps: 100,
  };
  const intakeLobe = harmonicCamLobe(lobeParams);
  const exhaustLobe = harmonicCamLobe(lobeParams);

  // 1-5-3-6-2-4, 120 crank degrees per lobe.
  const rot120 = units.angle(120, units.deg);
  const camOffsets = [0, 4, 2, 5, 1, 3].map((n) => n * rot120);

  const bank: CylinderBankSpec = {
    angle: 0,
    bore,
    deckHeight: units.distance(210.0 + 1, units.mm),
    cylinders: journals.map((journal, i) => ({
      piston: piston(),
      connectingRod: makeRod(),
      rodJournal: journal,
      intake,
      exhaustSystem: i % 2 === 0 ? exhaust1 : exhaust0,
      ignitionWire: wires[i],
    })),
    head: {
      chamberVolume: units.volume(34.0, units.cc),
      intakeRunnerVolume: units.volume(100.0, units.cc),
      intakeRunnerCrossSectionArea: 2 * units.area(12.4087, units.cm2),
      // The head node leaves these at the cylinder_head_parameters defaults.
      exhaustRunnerVolume: units.volume(300.0, units.cc),
      exhaustRunnerCrossSectionArea: circleArea(units.distance(0.85, units.inch)),
      intakePortFlow: flowFunctionMm(HEAD_INTAKE_FLOW),
      exhaustPortFlow: flowFunctionMm(HEAD_EXHAUST_FLOW),
      valvetrain: {
        kind: 'standard',
        ...bankCamshafts(
          {
            lobeProfile: intakeLobe,
            intakeLobeProfile: intakeLobe,
            exhaustLobeProfile: exhaustLobe,
            intakeLobeCenter: units.angle(110.0, units.deg),
            exhaustLobeCenter: units.angle(105.0, units.deg),
            baseRadius: units.distance(0.6, units.inch),
          },
          camOffsets,
        ),
      },
    },
  };

  connectWires(bank);

  const firingOrder = [0, 4, 2, 5, 1, 3];

  return {
    name: 'BMW M52B28',
    starterTorque: units.torque(150, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(7000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: { maxTurbulenceEffect: 4.0 },
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(5.9, units.kg),
        mass: units.mass(5, units.kg),
        frictionTorque: units.torque(10.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 0.9,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(120.0, units.deg),
        rodJournals: journals,
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 10],
        [1000, 10],
        [2000, 30],
        [3000, 30],
        [4000, 30],
        [5000, 30],
        [6000, 30],
        [7000, 30],
      ]),
      revLimit: units.rpm(8000),
      posts: firingOrder.map((wire, i) => ({
        wire: wires[wire],
        angle: (i / CYLINDERS) * CYCLE,
      })),
    },
  };
}

export const bmwM52: EngineDefinition = {
  id: 'bmw-m52b28',
  label: 'BMW M52B28',
  description: '2.8 L inline six from the E36 328i',
  engine: bmwM52Spec,
  // The source defines no vehicle; this is a port-supplied E36.
  vehicle: () => ({
    mass: units.mass(1420, units.kg),
    dragCoefficient: 0.29,
    crossSectionArea: units.distance(68, units.inch) * units.distance(54, units.inch),
    diffRatio: 3.15,
    tireRadius: units.distance(12, units.inch),
    rollingResistance: units.force(300, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(350, units.ft_lb),
    gearRatios: [4.21, 2.49, 1.66, 1.24, 1.0],
  }),
};
