/**
 * The generic V6 family from `assets/engines/atg-video-2/`:
 *
 *   04_60_degree_v6.mr    60° banks, six split journals, even 120° firing
 *   05_odd_fire_v6.mr     90° banks sharing three journals - the odd-fire lope
 *   06_even_fire_v6.mr    90° banks with split journals to restore even firing
 *
 * The three files are one template with different cranks, so this module is
 * one parameterised builder with three variants. Values are transcribed
 * per-variant; nothing is interpolated.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires, MODERN_4V_EXHAUST_FLOW, MODERN_4V_INTAKE_FLOW } from './parts';
import type {
  CylinderBankSpec,
  CylinderHeadSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

interface CylinderVariant {
  /** Index into the variant's journal list. */
  journal: number;
  /** Zero-based wire number. */
  wire: number;
  blowby: number;
  soundAttenuation?: number;
  /** Multiple of the 5-inch header spacing. */
  primary: number;
}

interface V6Variant {
  id: string;
  label: string;
  name: string;
  description: string;
  tdc: number;
  bankAngles: [number, number];
  flipDisplay: [boolean, boolean];
  journalAngles: number[];
  flywheelRadius: number;
  frictionTorque: number;
  idleThrottlePlatePosition: number;
  primaryFlowRate: number;
  exhaustLengths: [number, number];
  camOffsets: [number[], number[]];
  /** Firing angle for each wire, in crank degrees. */
  wireAngles: number[];
  cylinders: [CylinderVariant[], CylinderVariant[]];
}

const VARIANTS: V6Variant[] = [
  {
    id: 'v6-60',
    label: '60° V6',
    name: 'Generic 60 deg. V6',
    description: 'Even-firing 60° V6 with six split crank pins',
    tdc: 90 + 30,
    bankAngles: [30.0, -30.0],
    flipDisplay: [true, false],
    journalAngles: [0, 60, 240, 300, 120, 180],
    flywheelRadius: 7,
    frictionTorque: 20.0,
    idleThrottlePlatePosition: 0.994,
    primaryFlowRate: 500.0,
    exhaustLengths: [100, 100],
    camOffsets: [
      [0, 240, 480],
      [120, 360, 600],
    ],
    wireAngles: [0, 120, 240, 360, 480, 600],
    cylinders: [
      [
        { journal: 0, wire: 0, blowby: 0.1, soundAttenuation: 0.9, primary: 2 },
        { journal: 2, wire: 2, blowby: 0.2, soundAttenuation: 0.95, primary: 1 },
        { journal: 4, wire: 4, blowby: 0.2, primary: 0 },
      ],
      [
        { journal: 1, wire: 1, blowby: 0.1, soundAttenuation: 0.95, primary: 2 },
        { journal: 3, wire: 3, blowby: 0.2, soundAttenuation: 0.9, primary: 1 },
        { journal: 5, wire: 5, blowby: 0.2, soundAttenuation: 1.0, primary: 0 },
      ],
    ],
  },
  {
    id: 'v6-odd-fire',
    label: 'Odd-fire V6',
    name: 'Generic Odd-fire V6 (Common Rod Jnl.)',
    description: '90° V6 on three shared crank pins — fires unevenly on purpose',
    tdc: 45,
    bankAngles: [-45.0, 45.0],
    flipDisplay: [false, true],
    journalAngles: [0, 120, 240],
    flywheelRadius: 6,
    frictionTorque: 5.0,
    idleThrottlePlatePosition: 0.995,
    primaryFlowRate: 600.0,
    exhaustLengths: [100, 172],
    camOffsets: [
      [0, 480, 240],
      [630, 390, 150],
    ],
    wireAngles: [0, 630, 480, 390, 240, 150],
    cylinders: [
      [
        { journal: 0, wire: 0, blowby: 0.1, soundAttenuation: 1.0, primary: 2 },
        { journal: 1, wire: 2, blowby: 0.05, soundAttenuation: 1.0, primary: 1 },
        { journal: 2, wire: 4, blowby: 0.1, primary: 0 },
      ],
      [
        { journal: 0, wire: 1, blowby: 0.1, soundAttenuation: 1.0, primary: 2 },
        { journal: 1, wire: 3, blowby: 0.1, soundAttenuation: 1.0, primary: 1 },
        { journal: 2, wire: 5, blowby: 0.1, soundAttenuation: 1.0, primary: 0 },
      ],
    ],
  },
  {
    id: 'v6-even-fire',
    label: 'Even-fire V6',
    name: 'Generic Even-fire V6 (Split Rod Jnl.)',
    description: '90° V6 with split pins offset 30° to fire evenly',
    tdc: 45,
    bankAngles: [-45.0, 45.0],
    flipDisplay: [false, true],
    journalAngles: [0, -30, 120, 90, 240, 210],
    flywheelRadius: 6,
    frictionTorque: 5.0,
    idleThrottlePlatePosition: 0.995,
    primaryFlowRate: 300.0,
    exhaustLengths: [100, 172],
    camOffsets: [
      [0, 480, 240],
      [600, 360, 120],
    ],
    wireAngles: [0, 600, 480, 360, 240, 120],
    cylinders: [
      [
        { journal: 0, wire: 0, blowby: 0.1, soundAttenuation: 0.8, primary: 2 },
        { journal: 2, wire: 2, blowby: 0.2, soundAttenuation: 0.9, primary: 1 },
        { journal: 4, wire: 4, blowby: 0.2, primary: 0 },
      ],
      [
        { journal: 1, wire: 1, blowby: 0.1, soundAttenuation: 0.6, primary: 2 },
        { journal: 3, wire: 3, blowby: 0.2, soundAttenuation: 0.3, primary: 1 },
        { journal: 5, wire: 5, blowby: 0.2, soundAttenuation: 1.1, primary: 0 },
      ],
    ],
  },
];

function v6Spec(variant: V6Variant): EngineSpec {
  const stroke = units.distance(3.48, units.inch);
  const bore = units.distance(3.5, units.inch);
  const rodLength = units.distance(5.142, units.inch);
  const rodMass = units.mass(535, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(50, units.lb);
  const flywheelMass = units.mass(30, units.lb);

  const moment =
    diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(variant.flywheelRadius, units.inch)) +
    diskMomentOfInertia(units.mass(10, units.kg), units.distance(1.0, units.cm));

  const wires = Array.from({ length: 6 }, () => new IgnitionWire());
  const journals = variant.journalAngles.map((a) => new RodJournal(deg(a)));

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
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(400.0),
    runnerFlowRate: k_carb(250.0),
    runnerLength: units.distance(4.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: variant.idleThrottlePlatePosition,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(20.0, units.inch),
    primaryFlowRate: k_carb(variant.primaryFlowRate),
    velocityDecay: 1.0,
    audioVolume: 1.0,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    { ...exhaustCommon, length: units.distance(variant.exhaustLengths[0], units.inch) },
    { ...exhaustCommon, length: units.distance(variant.exhaustLengths[1], units.inch) },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(222),
    gamma: 1.0,
    lift: units.distance(400, units.thou),
    steps: 100,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(226),
    gamma: 1.0,
    lift: units.distance(300, units.thou),
    steps: 100,
  });

  const head = (bankIndex: 0 | 1): CylinderHeadSpec => ({
    chamberVolume: units.volume(67, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(1.35, units.inch) * units.distance(1.35, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(2.0, units.inch) * units.distance(2.0, units.inch),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW),
    valvetrain: {
      kind: 'standard',
      ...bankCamshafts(
        {
          lobeProfile: intakeLobe,
          intakeLobeProfile: intakeLobe,
          exhaustLobeProfile: exhaustLobe,
          intakeLobeCenter: deg(117),
          exhaustLobeCenter: deg(112),
          baseRadius: units.distance(0.75, units.inch),
        },
        variant.camOffsets[bankIndex].map(deg),
      ),
    },
    flipDisplay: variant.flipDisplay[bankIndex],
  });

  const spacing = units.distance(5.0, units.inch);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const banks = variant.cylinders.map((cylinders, bankIndex): CylinderBankSpec => {
    const bank: CylinderBankSpec = {
      angle: deg(variant.bankAngles[bankIndex]),
      bore,
      deckHeight,
      cylinders: cylinders.map((cylinder) => ({
        piston: piston(cylinder.blowby),
        connectingRod: makeRod(),
        rodJournal: journals[cylinder.journal],
        intake,
        exhaustSystem: exhausts[bankIndex],
        ignitionWire: wires[cylinder.wire],
        soundAttenuation: cylinder.soundAttenuation,
        primaryLength: spacing * cylinder.primary,
      })),
      head: head(bankIndex as 0 | 1),
    };

    connectWires(bank);
    return bank;
  });

  return {
    name: variant.name,
    starterTorque: units.torque(70, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(5500),
    throttle: { kind: 'direct', gamma: 2.0 },
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(variant.frictionTorque, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(variant.tdc),
        rodJournals: journals,
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 12],
        [1000, 20],
        [2000, 25],
        [3000, 30],
        [4000, 30],
      ]),
      revLimit: units.rpm(5600),
      limiterDuration: 0.2,
      posts: wires.map((wire, i) => ({ wire, angle: deg(variant.wireAngles[i]) })),
    },
  };
}

const CAR_MASS = units.mass(2700, units.lb);

function v6Definition(variant: V6Variant): EngineDefinition {
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    engine: () => v6Spec(variant),
    vehicle: () => ({
      mass: CAR_MASS,
      dragCoefficient: 0.3,
      crossSectionArea: units.distance(72, units.inch) * units.distance(56, units.inch),
      diffRatio: 3.9,
      tireRadius: units.distance(10, units.inch),
      rollingResistance: 0.015 * CAR_MASS * 9.81,
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(300, units.ft_lb),
      gearRatios: [3.636, 2.375, 1.761, 1.346, 0.971, 0.756],
    }),
  };
}

export const v6Sixty = v6Definition(VARIANTS[0]);
export const v6OddFire = v6Definition(VARIANTS[1]);
export const v6EvenFire = v6Definition(VARIANTS[2]);
