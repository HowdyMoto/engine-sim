/**
 * Audi 2.3 inline five, ported from `assets/engines/atg-video-1/07_audi_i5.mr`.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import {
  bankCamshafts,
  connectWires,
  MODERN_4V_EXHAUST_FLOW,
  MODERN_4V_INTAKE_FLOW,
} from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);
const CYLINDERS = 5;

export function audiI5Spec(): EngineSpec {
  const stroke = units.distance(79.5, units.mm);
  const bore = units.distance(86.4, units.mm);
  const rodLength = units.distance(5.142, units.inch);
  const rodMass = units.mass(535, units.g);
  const compressionHeight = units.distance(32.8, units.mm);

  const crankMass = units.mass(9.39, units.kg);
  const flywheelMass = units.mass(6.8, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(6, units.inch)) +
    diskMomentOfInertia(units.mass(20, units.kg), units.distance(8.0, units.cm));

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());

  // Firing order 1-2-4-5-3.
  const journals = [0, 2, 3, 4, 1].map(
    (n) => new RodJournal(units.angle((n / CYLINDERS) * 360, units.deg)),
  );

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(414 + 152, units.g),
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
    plenumVolume: units.volume(1.0, units.L),
    plenumCrossSectionArea: units.area(10.0, units.cm2),
    intakeFlowRate: k_carb(350.0),
    runnerFlowRate: k_carb(175.0),
    runnerLength: units.distance(5.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.993,
  };

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(500.0),
    primaryTubeLength: units.distance(10.0, units.inch),
    primaryFlowRate: k_carb(100.0),
    velocityDecay: 1.0,
    collectorCrossSectionArea,
    length: units.volume(50.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'mild_exhaust',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 1.0 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 0.8 };

  const cylinders = [
    { journal: 0, blowby: 0.2, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 1, blowby: 0.6, attenuation: 0.8, exhaust: exhaust1 },
    { journal: 2, blowby: 0.6, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 3, blowby: 0.4, attenuation: 1.0, exhaust: exhaust1 },
    { journal: 4, blowby: 0.4, attenuation: 1.1, exhaust: exhaust0 },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(210, units.deg),
    gamma: 2.0,
    lift: units.distance(9.78, units.mm),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(215, units.deg),
    gamma: 2.0,
    lift: units.distance(9.6, units.mm),
    steps: 100,
  });

  // 144 crank degrees apart, in firing order 1-2-4-5-3.
  const rot = units.angle(2 * (360 / CYLINDERS), units.deg);
  const camOffsets = [0, 1, 4, 2, 3].map((n) => n * rot);

  const flowAttenuation = 0.9;

  const bank: CylinderBankSpec = {
    angle: 0,
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
      chamberVolume: units.volume(50, units.cc),
      intakeRunnerVolume: units.volume(149.6, units.cc),
      intakeRunnerCrossSectionArea:
        units.distance(1.9, units.inch) * units.distance(1.9, units.inch),
      exhaustRunnerVolume: units.volume(50.0, units.cc),
      exhaustRunnerCrossSectionArea:
        units.distance(1.25, units.inch) * units.distance(1.25, units.inch),
      intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW, 1.0, flowAttenuation),
      exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW, 1.0, flowAttenuation),
      valvetrain: {
        kind: 'standard',
        ...bankCamshafts(
          {
            lobeProfile: intakeLobe,
            intakeLobeProfile: intakeLobe,
            exhaustLobeProfile: exhaustLobe,
            intakeLobeCenter: units.angle(116, units.deg),
            exhaustLobeCenter: units.angle(116, units.deg),
            baseRadius: units.distance(34.0 / 2, units.mm),
          },
          camOffsets,
        ),
      },
    },
  };

  connectWires(bank);

  // 1-2-4-5-3.
  const firingOrder = [0, 1, 3, 4, 2];

  return {
    name: 'Audi 2.3 inline 5',
    starterTorque: units.torque(200, units.ft_lb),
    redline: units.rpm(6000),
    fuel: { maxTurbulenceEffect: 2.5, maxBurningEfficiency: 0.75 },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.299,
    simulationFrequency: 17000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(5.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: PI / 2,
        rodJournals: journals,
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 12],
        [1000, 12],
        [2000, 20],
        [3000, 26],
        [4000, 30],
        [5000, 34],
        [6000, 38],
        [7000, 38],
      ]),
      revLimit: units.rpm(6500),
      limiterDuration: 0.1,
      posts: firingOrder.map((wire, i) => ({
        wire: wires[wire],
        angle: (i / CYLINDERS) * CYCLE,
      })),
    },
  };
}

export const audiI5: EngineDefinition = {
  id: 'audi-i5',
  label: 'Audi inline 5',
  description: '2.3 L five-cylinder, the warbly 1-2-4-5-3 order',
  engine: audiI5Spec,
  vehicle: () => ({
    mass: units.mass(2844, units.lb),
    dragCoefficient: 0.3,
    crossSectionArea: units.distance(66, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.55,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(500, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(200, units.ft_lb),
    gearRatios: [3.417, 2.105, 1.429, 1.088, 0.97, 0.912],
  }),
};
