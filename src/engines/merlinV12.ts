/**
 * Rolls-Royce Merlin V-1650 (naturally aspirated), ported from
 * `assets/engines/atg-video-2/11_merlin_v12.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, makeFunction } from '../builder/functions';
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

export function merlinV12Spec(): EngineSpec {
  const stroke = units.distance(6, units.inch);
  const bore = units.distance(5.4, units.inch);
  const rodLength = units.distance(14, units.inch);
  const rodMass = units.mass(2000, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(400, units.lb);
  const flywheelMass = units.mass(200, units.lb);

  const moment =
    diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(12, units.inch)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  // wires[0..5] are bank A (1a..6a), wires[6..11] bank B (1b..6b).
  const wires = Array.from({ length: 12 }, () => new IgnitionWire());
  const journals = [0, 240, 120, 120, 240, 0].map((a) => new RodJournal(deg(a)));

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(1000, units.g),
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
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(1400.0),
    runnerFlowRate: k_carb(200.0),
    runnerLength: units.distance(16.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.99,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(2000.0),
    primaryTubeLength: units.distance(50.0, units.inch),
    primaryFlowRate: k_carb(400.0),
    velocityDecay: 1.0,
    audioVolume: 1.0 * 0.5,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, length: units.distance(30, units.inch) };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, length: units.distance(70, units.inch) };

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(242),
    gamma: 0.8,
    lift: units.distance(15.95, units.mm),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(246),
    gamma: 0.8,
    lift: units.distance(590, units.thou),
    steps: 100,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(100.5),
    exhaustLobeCenter: deg(120),
    baseRadius: units.distance(1.0, units.inch),
  };

  // Bank A fires on the even 120s, bank B trails by 60 crank degrees.
  const camOffsets0 = [0, 240, 480, 120, 600, 360].map(deg);
  const camOffsets1 = [360 + 60, 600 + 60, 120 + 60, 480 + 60, 240 + 60, 0 + 60].map(deg);

  const head = (offsets: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(450, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(2.0, units.inch) * units.distance(2.0, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(5.0, units.inch) * units.distance(3.0, units.inch),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW),
    valvetrain: { kind: 'standard', ...bankCamshafts(camOptions, offsets) },
    flipDisplay,
  });

  const spacing = units.distance(6, units.inch);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bankABlowby = [0.7, 0.1, 0.4, 0.3, 0.2, 0.1];
  const bankASound = [0.9, 1.0, 1.5, 0.9, 0.8, 1.0];
  const bankBBlowby = [0.5, 0.2, 0.1, 0.3, 0.2, 0.1];
  const bankBSound = [0.9, 1.1, 1.0, 1.1, 0.7, 1.0];

  const bank = (
    angle: number,
    exhaust: ExhaustSpec,
    wireBase: number,
    blowbys: number[],
    sounds: number[],
    offsets: number[],
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const spec: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      cylinders: journals.map((journal, i) => ({
        piston: piston(blowbys[i]),
        connectingRod: makeRod(),
        rodJournal: journal,
        intake,
        exhaustSystem: exhaust,
        ignitionWire: wires[wireBase + i],
        soundAttenuation: sounds[i],
        primaryLength: spacing * (6 - i),
      })),
      head: head(offsets, flipDisplay),
    };

    connectWires(spec);
    return spec;
  };

  const banks = [
    bank(deg(60 / 2), exhaust1, 0, bankABlowby, bankASound, camOffsets0, true),
    bank(deg(-60 / 2), exhaust0, 6, bankBBlowby, bankBSound, camOffsets1, false),
  ];

  // 1a 6b 4a 3b 2a 5b 6a 1b 3a 4b 5a 2b, one every 60 degrees.
  const posts = [
    { wire: 0, angle: 0 },
    { wire: 11, angle: 60 },
    { wire: 3, angle: 120 },
    { wire: 8, angle: 180 },
    { wire: 1, angle: 240 },
    { wire: 10, angle: 300 },
    { wire: 5, angle: 360 },
    { wire: 6, angle: 420 },
    { wire: 2, angle: 480 },
    { wire: 9, angle: 540 },
    { wire: 4, angle: 600 },
    { wire: 7, angle: 660 },
  ];

  return {
    name: 'Merlin V-1650-9 [V12] (NA)',
    starterTorque: units.torque(190, units.ft_lb),
    starterSpeed: units.rpm(200),
    redline: units.rpm(3000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 10.0,
      maxDilutionEffect: 5.0,
      burningEfficiencyRandomness: 0.1,
      maxBurningEfficiency: 1.0,
    },
    simulationFrequency: 7000,
    hfGain: 0.004,
    noise: 0.35,
    jitter: 0.229,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(50.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90 + 30),
        rodJournals: journals,
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: makeFunction(units.rpm(4000), [
        [units.rpm(0), deg(12)],
        [units.rpm(4000), deg(50)],
      ]),
      revLimit: units.rpm(3500),
      limiterDuration: 0.05,
      posts: posts.map((post) => ({ wire: wires[post.wire], angle: deg(post.angle) })),
    },
  };
}

const CAR_MASS = units.mass(2700, units.lb);

export const merlinV12: EngineDefinition = {
  id: 'merlin-v12',
  label: 'Merlin V12',
  description: '27 L aero V12 — hold the starter, it swings a lot of iron',
  engine: merlinV12Spec,
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
