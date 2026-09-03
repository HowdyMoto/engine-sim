/**
 * Five-cylinder radial, ported from `assets/engines/atg-video-1/08_radial_5.mr`
 * (its `radial.mr` helper is identical to atg-video-2's).
 */
import * as units from '../core/units';
import { diskMomentOfInertia } from '../core/utilities';
import { GasSystem, circleArea } from '../engine/gasSystem';
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
const CYLINDERS = 5;

export function radial5Spec(): EngineSpec {
  const slaveThrow = units.distance(2.9, units.inch);
  const stroke = units.distance(5.5, units.inch);
  const bore = units.distance(5, units.inch);
  const rodLength = units.distance(12, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const moment =
    diskMomentOfInertia(units.mass(20.39, units.kg), stroke / 2) +
    diskMomentOfInertia(units.mass(100, units.kg), units.distance(5, units.inch)) +
    diskMomentOfInertia(units.mass(10, units.kg), units.distance(2.0, units.cm));

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());

  const rj0 = new RodJournal(0.0);
  const slaveJournals = Array.from(
    { length: CYLINDERS },
    (_, i) => new RodJournal(units.angle((i / CYLINDERS) * 360, units.deg)),
  );

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(200, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

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
    idleThrottlePlatePosition: 0.995,
    velocityDecay: 1.0,
  };

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(70.0, units.inch),
    primaryFlowRate: k_carb(300.0),
    velocityDecay: 0.75,
    collectorCrossSectionArea,
    length: units.volume(10.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 1.0 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 0.2 };

  const lobe = harmonicCamLobe({
    durationAt50Thou: units.angle(260, units.deg),
    gamma: 0.9,
    lift: units.distance(800, units.thou),
    steps: 100,
  });

  const cylinders = [
    { journal: rj0, wire: 0, blowby: 0.2, exhaust: exhaust0, headOffset: 0 / 5 },
    { journal: slaveJournals[1], wire: 4, blowby: 0.03, exhaust: exhaust0, headOffset: 2 / 5 },
    { journal: slaveJournals[2], wire: 3, blowby: 0.1, exhaust: exhaust1, headOffset: 4 / 5 },
    { journal: slaveJournals[3], wire: 2, blowby: 0.1, exhaust: exhaust1, headOffset: 1 / 5 },
    { journal: slaveJournals[4], wire: 1, blowby: 0.5, exhaust: exhaust1, headOffset: 3 / 5 },
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
      },
    ],
    head: radialHead({ offset: cylinder.headOffset, lobeProfile: lobe }),
  }));

  for (const bank of banks) connectWires(bank);

  const firingOrder = [0, 2, 4, 1, 3];

  return {
    name: 'Radial 5',
    starterTorque: units.torque(150, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(3000),
    throttle: { kind: 'direct', gamma: 2.0 },
    hfGain: 0.00121,
    noise: 0.623,
    jitter: 0.042,
    simulationFrequency: 12000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(10, units.lb),
        mass: units.mass(10, units.lb),
        frictionTorque: units.torque(10.0, units.ft_lb),
        momentOfInertia: moment,
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

export const radial5: EngineDefinition = {
  id: 'radial-5',
  label: 'Radial 5',
  description: '5-cylinder radial swinging a propeller — hold the starter',
  engine: radial5Spec,
  vehicle: () => ({
    mass: units.mass(100, units.lb),
    dragCoefficient: 0.5,
    crossSectionArea: units.distance(15, units.inch) * units.distance(47, units.inch),
    diffRatio: 1.0,
    tireRadius: 1.0,
    rollingResistance: units.force(300, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(500, units.ft_lb),
    gearRatios: [1.0],
  }),
};
