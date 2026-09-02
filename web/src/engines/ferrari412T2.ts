/**
 * Ferrari Tipo 044/1 as run in the 412 T2 Formula 1 car - a 75-degree V12
 * revving to 18 000 rpm - ported from
 * `assets/engines/atg-video-2/12_ferrari_412_t2.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, makeFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import {
  bankCamshafts,
  connectWires,
  MODERN_4V_EXHAUST_FLOW,
  MODERN_4V_INTAKE_FLOW,
} from './parts';
import type {
  CylinderBankSpec,
  CylinderHeadSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

function turbulenceToFlameSpeedRatio() {
  return makeFunction(5.0, [
    [0.0, 2.0 * 3.0],
    [5.0, 2.0 * 1.5 * 5.0],
    [10.0, 2.5 * 1.5 * 10.0],
    [15.0, 3.0 * 1.5 * 15.0],
    [20.0, 3.0 * 1.5 * 20.0],
    [25.0, 3.0 * 1.5 * 25.0],
    [30.0, 3.0 * 1.5 * 30.0],
    [35.0, 3.0 * 1.5 * 35.0],
    [40.0, 3.0 * 1.5 * 40.0],
    [45.0, 3.0 * 1.5 * 45.0],
  ]);
}

export function ferrari412T2Spec(): EngineSpec {
  const stroke = units.distance(43, units.mm);
  const bore = units.distance(86, units.mm);
  const rodLength = units.distance(120, units.mm);
  const rodMass = units.mass(50, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(20, units.lb);
  const flywheelMass = units.mass(10, units.lb);

  const moment =
    diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(5, units.inch)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = deg(75);

  const wires = Array.from({ length: 12 }, () => new IgnitionWire());
  const journals = [0, 120, 240, 240, 120, 0].map((a) => new RodJournal(deg(a)));

  const piston = () => ({
    mass: units.mass(50, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.0),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(1400.0),
    runnerFlowRate: k_carb(200.0),
    runnerLength: units.distance(4.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.992,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(2000.0),
    primaryTubeLength: units.distance(20.0, units.inch),
    primaryFlowRate: k_carb(200.0),
    velocityDecay: 0.5,
    audioVolume: 1.0 * 0.004,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, length: units.distance(20, units.inch) };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, length: units.distance(56, units.inch) };

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(242),
    gamma: 0.8,
    lift: units.distance(15.95, units.mm),
    steps: 512,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(246),
    gamma: 0.8,
    lift: units.distance(15.95, units.mm),
    steps: 512,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(90),
    exhaustLobeCenter: deg(112),
    baseRadius: units.distance(1.0, units.inch),
  };

  // Bank A on the even 120s, bank B trailing by the 75-degree V angle.
  const camOffsets0 = [0, 480, 240, 600, 120, 360].map(deg);
  const camOffsets1 = [0 + 75, 480 + 75, 240 + 75, 600 + 75, 120 + 75, 360 + 75].map(deg);

  const head = (offsets: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(1.5 * 25, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW),
    valvetrain: { kind: 'standard', ...bankCamshafts(camOptions, offsets) },
    flipDisplay,
  });

  // The primaries are scaled by a unitless 0.1 spacing in the original.
  const primary = (n: number) => 0.1 * units.distance(n, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bank0Cylinders = [
    { wire: 0, sound: 0.5, primary: primary(0.5) },
    { wire: 1, sound: 1.0, primary: primary(0.0) },
    { wire: 2, sound: 0.75, primary: primary(0.2) },
    { wire: 3, sound: 0.9, primary: primary(1.5) },
    { wire: 4, sound: 0.7, primary: primary(2.5) },
    { wire: 5, sound: 1.0, primary: primary(0.5) },
  ];

  const bank1Cylinders = [
    { wire: 11, sound: 0.5, primary: primary(0.5) },
    { wire: 10, sound: 0.3, primary: primary(0.25) },
    { wire: 9, sound: 1.0, primary: primary(3.5) },
    { wire: 8, sound: 1.2, primary: primary(1.5) },
    { wire: 7, sound: 0.7, primary: primary(0.5) },
    { wire: 6, sound: 1.2, primary: primary(1.5) },
  ];

  const bank = (
    angle: number,
    exhaust: ExhaustSpec,
    cylinders: typeof bank0Cylinders,
    offsets: number[],
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const spec: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      cylinders: cylinders.map((cylinder, i) => ({
        piston: piston(),
        connectingRod: makeRod(),
        rodJournal: journals[i],
        intake,
        exhaustSystem: exhaust,
        ignitionWire: wires[cylinder.wire],
        soundAttenuation: cylinder.sound,
        primaryLength: cylinder.primary,
      })),
      head: head(offsets, flipDisplay),
    };

    connectWires(spec);
    return spec;
  };

  const banks = [
    bank(vAngle / 2, exhaust0, bank0Cylinders, camOffsets0, true),
    bank(-vAngle / 2, exhaust1, bank1Cylinders, camOffsets1, false),
  ];

  // 1 12 5 8 3 10 6 7 2 11 4 9, alternating banks every 120 + 75 degrees.
  const posts = [
    { wire: 0, angle: 0 },
    { wire: 11, angle: 0 + 75 },
    { wire: 4, angle: 120 },
    { wire: 7, angle: 120 + 75 },
    { wire: 2, angle: 240 },
    { wire: 9, angle: 240 + 75 },
    { wire: 5, angle: 360 },
    { wire: 6, angle: 360 + 75 },
    { wire: 1, angle: 480 },
    { wire: 10, angle: 480 + 75 },
    { wire: 3, angle: 600 },
    { wire: 8, angle: 600 + 75 },
  ];

  return {
    name: 'Ferrari 412 T2 [V12]',
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(18000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 10.0,
      maxDilutionEffect: 5.0,
      burningEfficiencyRandomness: 1.0,
      maxBurningEfficiency: 1.0,
      turbulenceToFlameSpeedRatio: turbulenceToFlameSpeedRatio(),
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.1,
    simulationFrequency: 5000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(1.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90 + 75 / 2.0),
        rodJournals: journals,
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve(
        [
          [0, 12],
          [4000, 40],
          [8000, 40],
          [12000, 40],
          [14000, 40],
          [18000, 40],
        ],
        units.rpm(1000),
      ),
      revLimit: units.rpm(18500),
      limiterDuration: 0.1,
      posts: posts.map((post) => ({ wire: wires[post.wire], angle: deg(post.angle) })),
    },
  };
}

export const ferrari412T2: EngineDefinition = {
  id: 'ferrari-412t2',
  label: 'Ferrari 412 T2 V12',
  description: '3.0 L 75° F1 V12 — 18 000 rpm',
  engine: ferrari412T2Spec,
  vehicle: () => ({
    mass: units.mass(798, units.kg),
    dragCoefficient: 0.9,
    crossSectionArea: units.distance(72, units.inch) * units.distance(36, units.inch),
    diffRatio: 4.1,
    tireRadius: units.distance(9, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(1000, units.ft_lb),
    gearRatios: [2.8, 2.29, 1.93, 1.583, 1.375, 1.19],
  }),
};
