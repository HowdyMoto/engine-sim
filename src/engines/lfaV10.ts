/**
 * Lexus LFA 1LR-GUE V10, ported from `assets/engines/atg-video-2/10_lfa_v10.mr`.
 */
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
  CylinderHeadSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

export function lfaV10Spec(): EngineSpec {
  const stroke = units.distance(79, units.mm);
  const bore = units.distance(88, units.mm);
  const rodLength = units.distance(130, units.mm);
  const rodMass = units.mass(50, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(40, units.lb);
  const flywheelMass = units.mass(30, units.lb);

  const moment =
    diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(6.5, units.inch)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = deg(72);

  const wires = Array.from({ length: 10 }, () => new IgnitionWire());
  const journals = [0, 2, 3, 4, 1].map((n) => new RodJournal(n * vAngle));

  const piston = () => ({
    mass: units.mass(100, units.g),
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
    intakeFlowRate: k_carb(1000.0),
    runnerFlowRate: k_carb(200.0),
    runnerLength: units.distance(4.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.998,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(2000.0),
    primaryTubeLength: units.distance(50.0, units.inch),
    primaryFlowRate: k_carb(1000.0),
    velocityDecay: 1.0,
    audioVolume: 2.0,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = { ...exhaustCommon, length: units.distance(100, units.inch) };
  const exhaust1: ExhaustSpec = { ...exhaustCommon, length: units.distance(100.5, units.inch) };

  const lobeParams = {
    durationAt50Thou: deg(230),
    gamma: 1.1,
    lift: units.distance(15.95, units.mm),
    steps: 100,
  };
  const intakeLobe = harmonicCamLobe(lobeParams);
  const exhaustLobe = harmonicCamLobe(lobeParams);

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(90),
    exhaustLobeCenter: deg(112),
    baseRadius: units.distance(0.9, units.inch),
  };

  const rot = deg(72);
  // Cylinders 1 3 5 7 9 on bank 0, 2 4 6 8 10 on bank 1.
  const camOffsets0 = [0, 2, 8, 4, 6].map((n) => n * rot);
  const camOffsets1 = [1, 3, 9, 5, 7].map((n) => n * rot);

  const head = (offsets: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(1.5 * 25, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(2.5, units.inch) * units.distance(2.5, units.inch),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW),
    valvetrain: { kind: 'standard', ...bankCamshafts(camOptions, offsets) },
    flipDisplay,
  });

  const cm = (n: number) => units.distance(n, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bank0Sounds = [0.8, 1.0, 1.1, 0.9, 0.7];
  const bank1Sounds = [0.7, 0.8, 1.0, 1.1, 0.7];

  const bank = (
    angle: number,
    exhaust: ExhaustSpec,
    bankWires: IgnitionWire[],
    sounds: number[],
    offsets: number[],
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const spec: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      cylinders: journals.map((journal, i) => ({
        piston: piston(),
        connectingRod: makeRod(),
        rodJournal: journal,
        intake,
        exhaustSystem: exhaust,
        ignitionWire: bankWires[i],
        soundAttenuation: sounds[i],
        primaryLength: cm(5 - i),
      })),
      head: head(offsets, flipDisplay),
    };

    connectWires(spec);
    return spec;
  };

  const banks = [
    bank(vAngle / 2, exhaust1, [wires[0], wires[2], wires[4], wires[6], wires[8]], bank0Sounds, camOffsets0, true),
    bank(-vAngle / 2, exhaust0, [wires[1], wires[3], wires[5], wires[7], wires[9]], bank1Sounds, camOffsets1, false),
  ];

  // 1 2 3 4 7 8 9 10 5 6, one every 72 degrees.
  const firingOrder = [0, 1, 2, 3, 6, 7, 8, 9, 4, 5];

  return {
    name: '1LR-GUE [V10]',
    starterTorque: units.torque(100, units.ft_lb),
    starterSpeed: units.rpm(200),
    redline: units.rpm(9000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 10.0,
      maxDilutionEffect: 20.0,
      burningEfficiencyRandomness: 0.25,
      maxBurningEfficiency: 1.0,
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.1,
    simulationFrequency: 6500,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(0.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90) + vAngle / 2,
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
        units.rpm(4000),
      ),
      revLimit: units.rpm(9500),
      limiterDuration: 0.1,
      posts: firingOrder.map((wire, i) => ({ wire: wires[wire], angle: i * rot })),
    },
  };
}

export const lfaV10: EngineDefinition = {
  id: 'lfa-v10',
  label: 'Lexus LFA V10',
  description: '4.8 L 72° V10, 9000 rpm — the famous one',
  engine: lfaV10Spec,
  vehicle: () => ({
    mass: units.mass(1614, units.kg),
    dragCoefficient: 0.3,
    crossSectionArea: units.distance(72, units.inch) * units.distance(50, units.inch),
    diffRatio: 3.42,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(500, units.ft_lb),
    gearRatios: [3.23, 2.19, 1.61, 1.23, 0.97, 0.8],
  }),
};
