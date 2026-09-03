/**
 * Two cross-plane 90-degree V8s built from one template, separated only by
 * their bore/stroke ratio and everything that has to follow from it:
 *
 *   small-bore    3.50 in bore x 4.00 in stroke   undersquare, 5.0 L, 5000 rpm
 *   big-bore      4.30 in bore x 3.00 in stroke   oversquare,  5.7 L, 7800 rpm
 *
 * The long-stroke engine gets the smaller valves, the short cam on a wide lobe
 * separation and the low rev limit; the short-stroke engine gets the bigger
 * ports, a long-duration high-lift cam on a tight separation, a lighter
 * reciprocating assembly and 2800 more rpm. Same crank layout, same firing
 * order, very different engines.
 *
 * Both use the standard cross-plane crank — journals at 0, 270, 90, 180 — and
 * the 1-8-7-2-6-5-4-3 order. Each cylinder's `fire` angle satisfies
 * `F = J + (A0 - A) (mod 360)` for its journal angle `J` and bank angle `A`
 * against the reference bank angle `A0`, with the crank `tdc` at `90deg + A0`;
 * the same angles are reused as camshaft lobe offsets and as ignition posts.
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

/** Cross-plane crank, in cylinder order down each bank. */
const JOURNAL_ANGLES = [0, 270, 90, 180];

interface V8Cylinder {
  journal: number;
  wire: number;
  /** Ignition angle within the 720-degree cycle, in crank degrees. */
  fire: number;
  soundAttenuation: number;
  /** Multiple of the header spacing. */
  primary: number;
}

// Bank 0 (-45 degrees) carries cylinders 1, 3, 5, 7; bank 1 (+45) carries
// 2, 4, 6, 8. Firing order 1-8-7-2-6-5-4-3, one every 90 degrees.
const BANK0: V8Cylinder[] = [
  { journal: 0, wire: 0, fire: 0, soundAttenuation: 1.0, primary: 3 },
  { journal: 1, wire: 2, fire: 630, soundAttenuation: 0.9, primary: 2 },
  { journal: 2, wire: 4, fire: 450, soundAttenuation: 1.05, primary: 1 },
  { journal: 3, wire: 6, fire: 180, soundAttenuation: 0.95, primary: 0 },
];

const BANK1: V8Cylinder[] = [
  { journal: 0, wire: 1, fire: 270, soundAttenuation: 0.95, primary: 3 },
  { journal: 1, wire: 3, fire: 540, soundAttenuation: 1.05, primary: 2 },
  { journal: 2, wire: 5, fire: 360, soundAttenuation: 0.9, primary: 1 },
  { journal: 3, wire: 7, fire: 90, soundAttenuation: 1.0, primary: 0 },
];

interface V8Variant {
  id: string;
  label: string;
  name: string;
  description: string;

  /** Bore and stroke in inches — the whole point of the family. */
  bore: number;
  stroke: number;
  rodLength: number;
  pistonMass: number;
  rodMass: number;
  crankMass: number;
  flywheelMass: number;
  flywheelRadius: number;
  frictionTorque: number;

  chamberVolume: number;
  portFlowScale: number;
  intakeRunnerArea: number;
  exhaustRunnerArea: number;

  intakeCfm: number;
  runnerCfm: number;
  runnerLength: number;
  idleThrottlePlatePosition: number;

  primaryTubeLength: number;
  primaryCfm: number;
  outletCfm: number;
  exhaustLengths: [number, number];

  intakeDuration: number;
  exhaustDuration: number;
  intakeLift: number;
  exhaustLift: number;
  intakeLobeCenter: number;
  exhaustLobeCenter: number;

  redline: number;
  revLimit: number;
  timing: [number, number][];
  simulationFrequency: number;
  diffRatio: number;
  gearRatios: number[];
}

const VARIANTS: V8Variant[] = [
  {
    id: 'small-bore-v8',
    label: 'Small-bore V8 5.0',
    name: 'Generic Small-bore V8 (undersquare)',
    description: '5.0 L undersquare V8 — 3.50 in bore, 4.00 in stroke, torque down low',
    bore: 3.5,
    stroke: 4.0,
    rodLength: 5.7,
    pistonMass: 560,
    rodMass: 620,
    crankMass: 62,
    flywheelMass: 34,
    flywheelRadius: 8.0,
    frictionTorque: 24.0,
    // 630 cc swept against a 74 cc chamber: about 9.5:1.
    chamberVolume: 74,
    portFlowScale: 0.8,
    intakeRunnerArea: 11.0,
    exhaustRunnerArea: 9.0,
    intakeCfm: 600.0,
    runnerCfm: 220.0,
    runnerLength: 13.0,
    idleThrottlePlatePosition: 0.9925,
    primaryTubeLength: 32.0,
    primaryCfm: 400.0,
    outletCfm: 800.0,
    exhaustLengths: [120, 160],
    intakeDuration: 204,
    exhaustDuration: 214,
    intakeLift: 440,
    exhaustLift: 440,
    intakeLobeCenter: 114,
    exhaustLobeCenter: 116,
    redline: 5000,
    revLimit: 5300,
    timing: [
      [0, 12],
      [1000, 16],
      [2000, 24],
      [3000, 32],
      [4000, 34],
      [5000, 34],
    ],
    simulationFrequency: 10000,
    diffRatio: 3.08,
    gearRatios: [2.52, 1.52, 1.0, 0.72],
  },
  {
    id: 'big-bore-v8',
    label: 'Big-bore V8 5.7',
    name: 'Generic Big-bore V8 (oversquare)',
    description: '5.7 L oversquare V8 — 4.30 in bore, 3.00 in stroke, spins to 7800',
    bore: 4.3,
    stroke: 3.0,
    rodLength: 6.2,
    pistonMass: 430,
    rodMass: 480,
    crankMass: 48,
    flywheelMass: 20,
    flywheelRadius: 6.5,
    frictionTorque: 14.0,
    // 714 cc swept against a 68 cc chamber: about 11.5:1.
    chamberVolume: 68,
    portFlowScale: 1.15,
    intakeRunnerArea: 22.0,
    exhaustRunnerArea: 17.0,
    intakeCfm: 950.0,
    runnerCfm: 320.0,
    runnerLength: 8.0,
    idleThrottlePlatePosition: 0.994,
    primaryTubeLength: 36.0,
    primaryCfm: 750.0,
    outletCfm: 1400.0,
    exhaustLengths: [92, 96],
    intakeDuration: 248,
    exhaustDuration: 252,
    intakeLift: 640,
    exhaustLift: 620,
    intakeLobeCenter: 106,
    exhaustLobeCenter: 110,
    redline: 7800,
    revLimit: 8100,
    timing: [
      [0, 14],
      [1000, 18],
      [2000, 26],
      [3000, 34],
      [4000, 40],
      [5000, 40],
      [6000, 40],
      [7000, 40],
      [8000, 40],
    ],
    simulationFrequency: 12000,
    diffRatio: 3.73,
    gearRatios: [3.36, 2.07, 1.43, 1.0, 0.84, 0.56],
  },
];

function v8Spec(variant: V8Variant): EngineSpec {
  const stroke = units.distance(variant.stroke, units.inch);
  const bore = units.distance(variant.bore, units.inch);
  const rodLength = units.distance(variant.rodLength, units.inch);
  const rodMass = units.mass(variant.rodMass, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(variant.crankMass, units.lb);
  const flywheelMass = units.mass(variant.flywheelMass, units.lb);

  const moment =
    1.5 * diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(variant.flywheelRadius, units.inch)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = deg(90);
  const bank0Angle = -vAngle / 2;

  const wires = Array.from({ length: 8 }, () => new IgnitionWire());
  const journals = JOURNAL_ANGLES.map((a) => new RodJournal(deg(a)));

  const piston = () => ({
    mass: units.mass(variant.pistonMass, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.05),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.6, units.L),
    plenumCrossSectionArea: units.area(28.0, units.cm2),
    intakeFlowRate: k_carb(variant.intakeCfm),
    runnerFlowRate: k_carb(variant.runnerCfm),
    runnerLength: units.distance(variant.runnerLength, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: variant.idleThrottlePlatePosition,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(variant.outletCfm),
    primaryTubeLength: units.distance(variant.primaryTubeLength, units.inch),
    primaryFlowRate: k_carb(variant.primaryCfm),
    velocityDecay: 1.0,
    impulseResponse: 'default_0',
    impulseResponseVolume: 0.001,
  };

  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    {
      ...exhaustCommon,
      length: units.distance(variant.exhaustLengths[0], units.inch),
      audioVolume: 3.6,
    },
    {
      ...exhaustCommon,
      length: units.distance(variant.exhaustLengths[1], units.inch),
      audioVolume: 4.0,
    },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.intakeDuration),
    gamma: 1.1,
    lift: units.distance(variant.intakeLift, units.thou),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.exhaustDuration),
    gamma: 1.1,
    lift: units.distance(variant.exhaustLift, units.thou),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(variant.intakeLobeCenter),
    exhaustLobeCenter: deg(variant.exhaustLobeCenter),
    baseRadius: units.distance(1.0, units.inch),
  };

  const head = (cylinders: V8Cylinder[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(variant.chamberVolume, units.cc),
    intakeRunnerVolume: units.volume(150.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(variant.intakeRunnerArea, units.cm2),
    exhaustRunnerVolume: units.volume(52.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(variant.exhaustRunnerArea, units.cm2),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW, 1.0, variant.portFlowScale),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW, 1.0, variant.portFlowScale),
    valvetrain: {
      kind: 'standard',
      ...bankCamshafts(
        camOptions,
        cylinders.map((c) => deg(c.fire)),
      ),
    },
    flipDisplay,
  });

  const spacing = units.distance(2.0, units.inch);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const makeBank = (
    angle: number,
    cylinders: V8Cylinder[],
    exhaustSystem: ExhaustSpec,
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const bank: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      cylinders: cylinders.map((cylinder) => ({
        piston: piston(),
        connectingRod: makeRod(),
        rodJournal: journals[cylinder.journal],
        intake,
        exhaustSystem,
        ignitionWire: wires[cylinder.wire],
        soundAttenuation: cylinder.soundAttenuation,
        primaryLength: cylinder.primary * spacing,
      })),
      head: head(cylinders, flipDisplay),
    };

    connectWires(bank);
    return bank;
  };

  const bank0 = makeBank(bank0Angle, BANK0, exhausts[0], false);
  const bank1 = makeBank(-bank0Angle, BANK1, exhausts[1], true);

  const posts = [...BANK0, ...BANK1]
    .slice()
    .sort((a, b) => a.fire - b.fire)
    .map((cylinder) => ({ wire: wires[cylinder.wire], angle: deg(cylinder.fire) }));

  return {
    name: variant.name,
    starterTorque: units.torque(200, units.ft_lb),
    starterSpeed: units.rpm(250),
    redline: units.rpm(variant.redline),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      maxTurbulenceEffect: 4.0,
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.4,
    simulationFrequency: variant.simulationFrequency,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(variant.frictionTorque, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90) + bank0Angle,
        rodJournals: journals,
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve(variant.timing),
      revLimit: units.rpm(variant.revLimit),
      limiterDuration: 0.15,
      posts,
    },
  };
}

const CAR_MASS = units.mass(3500, units.lb);

function v8Definition(variant: V8Variant): EngineDefinition {
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    engine: () => v8Spec(variant),
    vehicle: () => ({
      mass: CAR_MASS,
      dragCoefficient: 0.32,
      crossSectionArea: units.distance(74, units.inch) * units.distance(54, units.inch),
      diffRatio: variant.diffRatio,
      tireRadius: units.distance(12, units.inch),
      rollingResistance: 0.015 * CAR_MASS * 9.81,
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(500, units.ft_lb),
      gearRatios: variant.gearRatios,
    }),
  };
}

export const smallBoreV8 = v8Definition(VARIANTS[0]);
export const bigBoreV8 = v8Definition(VARIANTS[1]);
