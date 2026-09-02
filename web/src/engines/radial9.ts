/**
 * Nine-cylinder radial, ported from `assets/engines/atg-video-2/09_radial_9.mr`
 * and the `radial.mr` helper beside it.
 *
 * This is the only bundled engine with articulated rods: one master rod runs on
 * the crank journal and the other eight hang off slave journals carried on the
 * master's big end.
 */
import * as units from '../core/units';
import { diskMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { connectWires, radialHead } from './parts';
import type {
  ConnectingRodSpec,
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);
const CYLINDERS = 9;

export function radial9Spec(): EngineSpec {
  const slaveThrow = units.distance(3.5, units.inch);
  const stroke = units.distance(5.5, units.inch);
  const bore = units.distance(5, units.inch);
  const rodLength = units.distance(16, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(20.39, units.kg);
  const flywheelMass = units.mass(50, units.kg);
  const flywheelRadius = units.distance(12, units.inch);

  const crankMoment = diskMomentOfInertia(crankMass, stroke / 2);
  const flywheelMoment = diskMomentOfInertia(flywheelMass, flywheelRadius);
  const otherMoment = diskMomentOfInertia(units.mass(10, units.kg), units.distance(2.0, units.cm));

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());

  // The crank journal the master rod runs on.
  const rj0 = new RodJournal(0.0);

  // Slave journals carried on the master rod's big end, evenly spaced.
  const slaveJournals = Array.from(
    { length: CYLINDERS },
    (_, i) => new RodJournal(units.angle((i / CYLINDERS) * 360, units.deg)),
  );

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(10, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

  // Slave rods are shorter by the slave throw; the master spans the full length.
  const slaveRod = (): ConnectingRodSpec => ({
    mass: units.mass(100.0, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: rodLength - slaveThrow,
  });

  const masterRod: ConnectingRodSpec = {
    ...slaveRod(),
    length: rodLength,
    slaveThrow,
    rodJournals: slaveJournals,
  };

  const intake = {
    plenumVolume: units.volume(10.5, units.L),
    plenumCrossSectionArea: units.area(10.0, units.cm2),
    intakeFlowRate: k_carb(1000.0),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.993,
    velocityDecay: 1.0,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(2000.0),
    primaryTubeLength: units.distance(70.0, units.inch),
    primaryFlowRate: k_carb(1000.0),
    velocityDecay: 0.75,
    length: units.distance(100, units.inch),
    audioVolume: 1.0,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon };
  const exhaust1: ExhaustSpec = { ...exhaustCommon };

  const lobe = harmonicCamLobe({
    durationAt50Thou: units.angle(260, units.deg),
    gamma: 0.9,
    lift: units.distance(800, units.thou),
    steps: 100,
  });

  const foot = (n: number) => units.distance(n, units.foot);

  /**
   * Per-cylinder wiring, in bank order. Cylinder 0 carries the master rod on
   * the crank journal; the rest ride slave journals. The head offsets are the
   * firing order expressed as a fraction of the cycle.
   */
  const cylinders = [
    { journal: rj0, wire: 0, blowby: 0.2, primary: foot(6.11), exhaust: exhaust0, headOffset: 0 / 9 },
    { journal: slaveJournals[1], wire: 8, blowby: 0.03, primary: foot(7.46), exhaust: exhaust0, headOffset: 4 / 9 },
    { journal: slaveJournals[2], wire: 7, blowby: 0.1, primary: foot(8.31), exhaust: exhaust0, headOffset: 8 / 9 },
    { journal: slaveJournals[3], wire: 6, blowby: 0.1, primary: foot(8.45), exhaust: exhaust0, headOffset: 3 / 9 },
    { journal: slaveJournals[4], wire: 5, blowby: 0.5, primary: foot(7.84), exhaust: exhaust1, headOffset: 7 / 9 },
    { journal: slaveJournals[5], wire: 4, blowby: 0.5, primary: foot(6.63), exhaust: exhaust1, headOffset: 2 / 9 },
    { journal: slaveJournals[6], wire: 3, blowby: 0.5, primary: foot(5.2), exhaust: exhaust1, headOffset: 6 / 9 },
    { journal: slaveJournals[7], wire: 2, blowby: 0.5, primary: foot(4.33), exhaust: exhaust1, headOffset: 1 / 9 },
    { journal: slaveJournals[8], wire: 1, blowby: 0.5, primary: foot(4.77), exhaust: exhaust1, headOffset: 5 / 9 },
  ];

  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const banks: CylinderBankSpec[] = cylinders.map((cylinder, i) => ({
    angle: units.angle((i / CYLINDERS) * 360, units.deg),
    bore,
    deckHeight,
    cylinders: [
      {
        piston: piston(cylinder.blowby),
        connectingRod: i === 0 ? masterRod : slaveRod(),
        rodJournal: cylinder.journal,
        intake,
        exhaustSystem: cylinder.exhaust,
        ignitionWire: wires[cylinder.wire],
        primaryLength: cylinder.primary,
      },
    ],
    head: radialHead({ offset: cylinder.headOffset, lobeProfile: lobe }),
  }));

  for (const bank of banks) connectWires(bank);

  // Fires every other cylinder, which is the standard odd-cylinder radial order.
  const firingOrder = [0, 2, 4, 6, 8, 1, 3, 5, 7];

  return {
    name: 'Radial 9',
    starterTorque: units.torque(80, units.ft_lb),
    starterSpeed: units.rpm(400),
    redline: units.rpm(3000),
    simulationFrequency: 7500,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(10, units.lb),
        mass: units.mass(10, units.lb),
        frictionTorque: units.torque(10.0, units.ft_lb),
        momentOfInertia: crankMoment + flywheelMoment + otherMoment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(90 - 0.5 * 45, units.deg),
        rodJournals: [rj0],
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 18],
        [1000, 18],
        [2000, 30],
        [3000, 40],
        [4000, 40],
      ]),
      revLimit: units.rpm(3500),
      limiterDuration: 0.2,
      posts: firingOrder.map((wire, i) => ({
        wire: wires[wire],
        angle: (i / CYLINDERS) * CYCLE,
      })),
    },
  };
}

const CAR_MASS = units.mass(2700, units.lb);

export const radial9: EngineDefinition = {
  id: 'radial-9',
  label: 'Radial 9',
  description:
    '9-cylinder radial, articulated rods on one crank throw — hold the starter, it cranks slowly',
  engine: radial9Spec,
  vehicle: () => ({
    mass: CAR_MASS,
    dragCoefficient: 0.3,
    crossSectionArea: units.distance(72, units.inch) * units.distance(56, units.inch),
    diffRatio: 3.9,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: 10000,
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(2000, units.ft_lb),
    gearRatios: [0.01],
  }),
};
