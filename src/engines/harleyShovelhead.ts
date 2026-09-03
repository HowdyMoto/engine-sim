/**
 * Harley-Davidson Shovelhead, a 45-degree V-twin with both rods on one crank
 * journal, ported from `assets/engines/atg-video-1/03_harley_davidson_shovelhead.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia } from '../core/utilities';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires, genericSmallEngineHead } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

export function harleyShovelheadSpec(): EngineSpec {
  const stroke = units.distance(4.25, units.inch);
  const bore = units.distance(3.5, units.inch);
  const rodLength = units.distance(8, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(9.39, units.kg);
  const flywheelMass = units.mass(15, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(6, units.inch)) +
    diskMomentOfInertia(units.mass(10, units.kg), units.distance(3.0, units.cm));

  const wires = [new IgnitionWire(), new IgnitionWire()];
  const rj0 = new RodJournal(0.0);

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(500, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

  const makeRod = () => ({
    mass: units.mass(500.0, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.5, units.L),
    plenumCrossSectionArea: units.area(10.0, units.cm2),
    intakeFlowRate: k_carb(100.0),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.991,
    velocityDecay: 1.0,
  };

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(100.0),
    primaryTubeLength: units.distance(70.0, units.inch),
    primaryFlowRate: k_carb(100.0),
    velocityDecay: 0.75,
    collectorCrossSectionArea,
    length: units.volume(10.0, units.L) / collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, audioVolume: 1.0 * 0.1 };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, audioVolume: 2.0 * 0.1 };

  const lobe = harmonicCamLobe({
    durationAt50Thou: units.angle(210, units.deg),
    gamma: 0.9,
    lift: units.distance(400, units.thou),
    steps: 100,
  });

  // The rear cylinder trails the front by 315 crank degrees.
  const camAngle = units.angle(315, units.deg);
  const camOptions = {
    lobeProfile: lobe,
    lobeSeparation: units.angle(110, units.deg),
    baseRadius: units.distance(500, units.thou),
  };

  const bankParams = {
    bore,
    deckHeight: stroke / 2 + rodLength + compressionHeight,
    displayDepth: 0.55,
  };

  const halfV = units.angle(0.5 * 45, units.deg);

  const bank0: CylinderBankSpec = {
    ...bankParams,
    angle: -halfV,
    cylinders: [
      {
        piston: piston(0.2),
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaust0,
        ignitionWire: wires[0],
      },
    ],
    head: genericSmallEngineHead({
      chamberVolume: units.volume(100, units.cc),
      flowAttenuation: 2.0,
      intakeRunnerCrossSectionArea: units.area(20.0, units.cm2),
      exhaustRunnerCrossSectionArea: units.area(20.0, units.cm2),
      ...bankCamshafts(camOptions, [0]),
    }),
  };

  const bank1: CylinderBankSpec = {
    ...bankParams,
    angle: halfV,
    cylinders: [
      {
        piston: piston(0.1),
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaust1,
        ignitionWire: wires[1],
      },
    ],
    head: genericSmallEngineHead({
      flipDisplay: true,
      chamberVolume: units.volume(100, units.cc),
      flowAttenuation: 1.0,
      intakeRunnerCrossSectionArea: units.area(20.0, units.cm2),
      exhaustRunnerCrossSectionArea: units.area(20.0, units.cm2),
      ...bankCamshafts(camOptions, [camAngle]),
    }),
  };

  connectWires(bank0);
  connectWires(bank1);

  return {
    name: 'Harley Davidson Shovelhead',
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(5000),
    hfGain: 0.01,
    noise: 0.115,
    jitter: 0.136,
    simulationFrequency: 35000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(5.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(90 - 0.5 * 45, units.deg),
        rodJournals: [rj0],
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 18],
        [1000, 18],
        [2000, 30],
        [3000, 40],
        [4000, 40],
      ]),
      revLimit: units.rpm(5500),
      posts: [
        { wire: wires[0], angle: 0 },
        { wire: wires[1], angle: units.angle(315, units.deg) },
      ],
    },
  };
}

export const harleyShovelhead: EngineDefinition = {
  id: 'harley-shovelhead',
  label: 'Harley Shovelhead',
  description: '45° V-twin on a shared crank pin — the classic uneven idle',
  engine: harleyShovelheadSpec,
  vehicle: () => ({
    mass: units.mass(900, units.lb),
    dragCoefficient: 0.1,
    crossSectionArea: units.distance(15, units.inch) * units.distance(47, units.inch),
    diffRatio: 2.0,
    tireRadius: units.distance(11, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(200, units.ft_lb),
    gearRatios: [3.34, 2.3, 1.71, 1.41, 1.18, 1.0],
  }),
};
