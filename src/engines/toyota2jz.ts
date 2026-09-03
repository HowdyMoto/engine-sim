/**
 * Toyota 2JZ inline six, ported from `assets/engines/atg-video-2/03_2jz.mr`.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
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
const CYLINDERS = 6;

export function toyota2jzSpec(): EngineSpec {
  const stroke = units.distance(86.0, units.mm);
  const bore = units.distance(86.0, units.mm);
  const rodLength = units.distance(142, units.mm);
  const rodMass = units.mass(500, units.g);
  const compressionHeight = units.distance(32.8, units.mm);

  const crankMass = units.mass(15, units.kg);
  const flywheelMass = units.mass(10, units.kg);
  const flywheelRadius = units.distance(7, units.inch);

  const crankMoment = diskMomentOfInertia(crankMass, stroke / 2);
  const flywheelMoment = diskMomentOfInertia(flywheelMass, flywheelRadius);
  const otherMoment = diskMomentOfInertia(units.mass(20, units.kg), units.distance(8.0, units.cm));

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());

  // Firing order 1-5-3-6-2-4.
  const journals = [0, 480, 240, 600, 120, 360].map(
    (deg) => new RodJournal(units.angle(deg, units.deg)),
  );

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(200 + 50, units.g),
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
    intakeFlowRate: k_carb(500.0),
    runnerFlowRate: k_carb(200.0),
    runnerLength: units.distance(40.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9965,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(40.0, units.inch),
    primaryFlowRate: k_carb(400.0),
    velocityDecay: 1.0,
    length: units.distance(100.0, units.inch),
    audioVolume: 0.2,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon };
  const exhaust1: ExhaustSpec = { ...exhaustCommon };

  const spacing = units.distance(0.5, units.inch);

  // Front three cylinders feed one collector, rear three the other.
  const cylinders = [
    { journal: 0, blowby: 0.1, primary: 5, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 1, blowby: 0.05, primary: 4, attenuation: 0.95, exhaust: exhaust0 },
    { journal: 2, blowby: 0.1, primary: 3, attenuation: 0.9, exhaust: exhaust0 },
    { journal: 3, blowby: 0.05, primary: 3, attenuation: 0.97, exhaust: exhaust1 },
    { journal: 4, blowby: 0.1, primary: 4, attenuation: 0.98, exhaust: exhaust1 },
    { journal: 5, blowby: 0.05, primary: 5, attenuation: 0.93, exhaust: exhaust1 },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(220, units.deg),
    gamma: 1.1,
    lift: units.distance(9.78, units.mm),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(220, units.deg),
    gamma: 1.1,
    lift: units.distance(9.6, units.mm),
    steps: 100,
  });

  // 120 crank degrees between cylinders, in firing order.
  const rot = units.angle(2 * (360 / CYLINDERS), units.deg);
  const camOffsets = [0, 4, 2, 5, 1, 3].map((n) => n * rot);

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
      primaryLength: spacing * cylinder.primary,
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

  // 1-5-3-6-2-4.
  const firingOrder = [0, 4, 2, 5, 1, 3];

  return {
    name: '2JZ [I6]',
    starterTorque: units.torque(200, units.ft_lb),
    redline: units.rpm(6000),
    fuel: { maxBurningEfficiency: 1.0 },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.23,
    simulationFrequency: 10000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(5.0, units.ft_lb),
        momentOfInertia: crankMoment + flywheelMoment + otherMoment,
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

export const toyota2jz: EngineDefinition = {
  id: 'toyota-2jz',
  label: 'Toyota 2JZ',
  description:
    '3.0 L inline six, twin collectors, 1-5-3-6-2-4 — no idle bypass, so give it throttle',
  engine: toyota2jzSpec,
  vehicle: () => ({
    mass: units.mass(3400, units.lb),
    dragCoefficient: 0.4,
    crossSectionArea: units.distance(66, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.15,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(500, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(500, units.ft_lb),
    gearRatios: [5.25, 3.36, 2.17, 1.72, 1.32, 1.0],
  }),
};
