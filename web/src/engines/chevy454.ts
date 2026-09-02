/**
 * Chevrolet 454 big block, ported from
 * `assets/engines/chevrolet/chev_truck_454.mr` with the big-block parts it
 * pulls from the part library (peanut-port heads, stock 454 cam, BBC
 * distributor).
 *
 * The source file defines only the engine, so the truck and gearbox here are
 * the port's own. `engine_03_for_e1.mr` in the same folder is a carburettor
 * and exhaust tune of this engine and is not ported separately.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { GasSystem } from '../engine/gasSystem';
import { harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import {
  bankCamshafts,
  chevyBbcPeanutPortHead,
  chevyBbcStockIntake,
  connectWires,
} from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

export function chevy454Spec(): EngineSpec {
  const wires = Array.from({ length: 8 }, () => new IgnitionWire());
  const journals = [0, -PI / 2, (-3 * PI) / 2, PI].map((a) => new RodJournal(a));

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(880, units.g),
    compressionHeight: units.distance(1.64, units.inch),
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(blowbyScfm),
  });

  const makeRod = () => ({
    mass: units.mass(785.0, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: units.distance(6.135, units.inch),
  });

  const intake = chevyBbcStockIntake({
    carburetorCfm: 650.0,
    idleFlowRateCfm: 0.007,
    idleThrottlePlatePosition: 0.991,
  });

  const exhaustCommon = {
    outletFlowRate: k_carb(550.0),
    primaryTubeLength: units.distance(10.0, units.inch),
    primaryFlowRate: k_carb(100.0),
    velocityDecay: 1.0,
    audioVolume: 5.5,
    impulseResponse: 'default_0',
    impulseResponseVolume: 0.001,
  };

  const exhaust0: ExhaustSpec = {
    ...exhaustCommon,
    length: units.distance(180 + 72.0, units.inch),
  };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, length: units.distance(180.0, units.inch) };

  // Stock 454 lobes from `cam_lobes.mr`.
  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(194),
    gamma: 0.8,
    lift: units.distance(390, units.thou),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(202),
    gamma: 0.8,
    lift: units.distance(409, units.thou),
    steps: 100,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(108),
    exhaustLobeCenter: deg(113),
    baseRadius: units.distance(0.75, units.inch),
  };

  const rot90 = deg(90);
  // Firing order 1-8-4-3-6-5-7-2 across the two banks.
  const camOffsets0 = [0, 3, 5, 6].map((n) => n * rot90);
  const camOffsets1 = [7, 2, 4, 1].map((n) => n * rot90);

  const distance = units.distance(5.0, units.inch);
  const bankParams = {
    bore: units.distance(4.25, units.inch),
    deckHeight: units.distance(9.8, units.inch),
  };

  const bank0Cylinders = [
    { blowby: 0.2, sound: 0.9 },
    { blowby: 0.6, sound: 1.1 },
    { blowby: 0.6, sound: 0.8 },
    { blowby: 0.4, sound: 0.85 },
  ];
  const bank1Cylinders = [
    { blowby: 0.2, sound: 0.9 },
    { blowby: 0.2, sound: 1.1 },
    { blowby: 0.6, sound: 0.8 },
    { blowby: 0.6, sound: 0.75 },
  ];

  const bank = (
    angle: number,
    exhaust: ExhaustSpec,
    cylinders: typeof bank0Cylinders,
    wireIndices: number[],
    camOffsets: number[],
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const spec: CylinderBankSpec = {
      ...bankParams,
      angle,
      cylinders: cylinders.map((cylinder, i) => ({
        piston: piston(cylinder.blowby),
        connectingRod: makeRod(),
        rodJournal: journals[i],
        intake,
        exhaustSystem: exhaust,
        ignitionWire: wires[wireIndices[i]],
        soundAttenuation: cylinder.sound,
        primaryLength: distance * (4 - i),
      })),
      head: chevyBbcPeanutPortHead({
        ...bankCamshafts(camOptions, camOffsets),
        flipDisplay,
      }),
    };

    connectWires(spec);
    return spec;
  };

  const banks = [
    bank(deg(-45), exhaust0, bank0Cylinders, [0, 2, 4, 6], camOffsets0, false),
    bank(deg(45), exhaust1, bank1Cylinders, [1, 3, 5, 7], camOffsets1, true),
  ];

  // `chevy_bbc_distributor`: 1-8-4-3-6-5-7-2 every 90 degrees.
  const firingOrder = [0, 7, 3, 2, 5, 4, 6, 1];

  return {
    name: 'Chev. 454 V8',
    starterTorque: units.torque(200, units.ft_lb),
    redline: units.rpm(5500),
    throttle: { kind: 'direct', gamma: 1.5 },
    fuel: {
      maxTurbulenceEffect: 3.0,
      burningEfficiencyRandomness: 0.5,
      maxBurningEfficiency: 0.85,
    },
    crankshafts: [
      {
        throw: units.distance(2.0, units.inch),
        flywheelMass: units.mass(29 * 2, units.lb),
        mass: units.mass(75, units.lb),
        frictionTorque: units.torque(10.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 2,
        positionX: 0.0,
        positionY: 0.0,
        tdc: PI / 4,
        rodJournals: journals,
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 12],
        [1000, 12],
        [2000, 20],
        [3000, 30],
        [4000, 38],
        [5000, 38],
        [6000, 38],
      ]),
      revLimit: units.rpm(7000),
      posts: firingOrder.map((wire, i) => ({ wire: wires[wire], angle: i * rot90 })),
    },
  };
}

export const chevy454: EngineDefinition = {
  id: 'chevy-454',
  label: 'Chevy 454 V8',
  description: '7.4 L big-block truck V8, peanut-port heads',
  engine: chevy454Spec,
  // The source defines no vehicle; this is a port-supplied C/K pickup.
  vehicle: () => ({
    mass: units.mass(2500, units.kg),
    dragCoefficient: 0.45,
    crossSectionArea: units.distance(80, units.inch) * units.distance(60, units.inch),
    diffRatio: 4.1,
    tireRadius: units.distance(14, units.inch),
    rollingResistance: units.force(400, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(600, units.ft_lb),
    gearRatios: [6.55, 3.58, 1.7, 1.0],
  }),
};
