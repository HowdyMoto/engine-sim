/**
 * Honda TRX520 ATV single, ported from
 * `assets/engines/atg-video-1/01_honda_trx520.mr`.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires, genericSmallEngineHead } from './parts';
import type { CylinderBankSpec, EngineDefinition, EngineSpec } from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

export function hondaTrx520Spec(): EngineSpec {
  const stroke = units.distance(71.5, units.mm);
  const rodLength = units.distance(6.0, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const wire = new IgnitionWire();
  const rj0 = new RodJournal(0.0);

  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaust = {
    outletFlowRate: k_carb(500.0),
    primaryTubeLength: units.distance(20.0, units.inch),
    primaryFlowRate: k_carb(200.0),
    velocityDecay: 0.5,
    collectorCrossSectionArea,
    length: units.volume(5.0, units.L) / collectorCrossSectionArea,
    audioVolume: 1.0,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const lobe = harmonicCamLobe({
    durationAt50Thou: units.angle(180, units.deg),
    gamma: 1.0,
    lift: units.distance(200, units.thou),
    steps: 100,
  });

  const bank: CylinderBankSpec = {
    angle: 0,
    bore: units.distance(96, units.mm),
    deckHeight: stroke / 2 + rodLength + compressionHeight,
    cylinders: [
      {
        piston: {
          mass: units.mass(100, units.g),
          compressionHeight,
          wristPinPosition: 0.0,
          displacement: 0.0,
          blowby: k_28inH2O(0.1),
        },
        connectingRod: {
          mass: units.mass(100.0, units.g),
          momentOfInertia: 0.0015884918028487504,
          centerOfMass: 0.0,
          length: rodLength,
        },
        rodJournal: rj0,
        intake: {
          plenumVolume: units.volume(1.5, units.L),
          plenumCrossSectionArea: units.area(10.0, units.cm2),
          intakeFlowRate: k_carb(100.0),
          idleFlowRate: k_carb(0.0),
          idleThrottlePlatePosition: 0.993,
          velocityDecay: 0.5,
        },
        exhaustSystem: exhaust,
        ignitionWire: wire,
      },
    ],
    head: genericSmallEngineHead({
      chamberVolume: units.volume(60, units.cc),
      flowAttenuation: 2.0,
      intakeRunnerCrossSectionArea: units.area(9.0, units.cm2),
      exhaustRunnerCrossSectionArea: units.area(9.0, units.cm2),
      ...bankCamshafts(
        {
          lobeProfile: lobe,
          lobeSeparation: units.angle(100, units.deg),
          baseRadius: units.distance(500, units.thou),
        },
        [0],
      ),
    }),
  };

  connectWires(bank);

  return {
    name: 'Honda TRX520 (ATV)',
    starterTorque: units.torque(50, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(5000),
    fuel: { maxBurningEfficiency: 1.0 },
    hfGain: 0.00121,
    noise: 0.229,
    jitter: 0.42,
    simulationFrequency: 40000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(5, units.lb),
        mass: units.mass(5, units.lb),
        frictionTorque: units.torque(5.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 0.2,
        positionX: 0.0,
        positionY: 0.0,
        tdc: PI / 2,
        rodJournals: [rj0],
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 12],
        [1000, 12],
        [2000, 20],
        [3000, 35],
        [4000, 35],
      ]),
      revLimit: units.rpm(6000),
      posts: [{ wire, angle: 0 }],
    },
  };
}

export const hondaTrx520: EngineDefinition = {
  id: 'honda-trx520',
  label: 'Honda TRX520',
  description: '0.5 L ATV single-cylinder thumper',
  engine: hondaTrx520Spec,
  vehicle: () => ({
    mass: units.mass(500, units.kg),
    dragCoefficient: 0.25,
    crossSectionArea: units.distance(47, units.inch) * units.distance(47, units.inch),
    diffRatio: 3.33,
    tireRadius: units.distance(11, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(50, units.ft_lb),
    gearRatios: [4.0, 3.5, 3.0, 2.5, 2.0],
  }),
};
