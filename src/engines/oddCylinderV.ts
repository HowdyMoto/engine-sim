/**
 * Odd-cylinder V engines: a 60-degree V3 and a 72-degree V5.
 *
 * An odd cylinder count cannot be split evenly across two banks, so one bank
 * always carries one more cylinder than the other, and the crank cannot space
 * the events evenly through the 720-degree cycle without a pin for every
 * cylinder. Both engines here keep the honest arrangement instead — a small
 * crank with rods shared between the banks — and come out genuinely odd-fire:
 *
 *   V3   two throws, three rods    fires at 0, 180, 420    gaps 180-240-300
 *   V5   three throws, five rods   0, 216, 288, 432, 504   gaps 216-72-144-72-216
 *
 * The lopsided gaps are the point. A V3 idles with a limp in it and the V5
 * beats in pairs, and neither is a defect to be tuned out.
 *
 * As everywhere in this directory, a cylinder reaches top dead centre — and so
 * must be fired — at cycle angle `F = J + (A0 - A) (mod 360)` for journal angle
 * `J`, bank angle `A` and reference bank angle `A0`, with the crankshaft `tdc`
 * at `90deg + A0`. The variants state the firing schedule and `journalAngle`
 * solves for the crank, so pins, cam lobe offsets and ignition posts are the
 * same numbers by construction. Cylinders whose journal angle comes out equal
 * genuinely share a throw, which is how both cranks end up with fewer pins
 * than rods.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, positiveMod, rodMomentOfInertia } from '../core/utilities';
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

/** Solve `F = J + (A0 - A)` for the journal angle, in degrees. */
function journalAngle(fire: number, bankAngle: number, referenceAngle: number): number {
  return positiveMod(fire + (bankAngle - referenceAngle), 360);
}

interface OddVVariant {
  id: string;
  label: string;
  name: string;
  description: string;

  /** Bank angles off vertical, in degrees. Bank 0 is the reference. */
  bankAngles: [number, number];
  /** Firing angle of every cylinder, `[bank][cylinder]`, in crank degrees. */
  firing: [number[], number[]];

  /** Millimetres. */
  bore: number;
  stroke: number;
  rodLength: number;
  compressionHeight: number;
  pistonMass: number;
  rodMass: number;

  crankMass: number;
  flywheelMass: number;
  flywheelRadius: number;
  frictionTorque: number;

  chamberVolume: number;
  portFlowScale: number;

  plenumVolume: number;
  intakeCfm: number;
  runnerCfm: number;
  runnerLength: number;
  idleThrottlePlatePosition: number;

  outletCfm: number;
  primaryCfm: number;
  primaryTubeLength: number;
  exhaustLengths: [number, number];

  intakeDuration: number;
  exhaustDuration: number;
  intakeLift: number;
  exhaustLift: number;
  intakeLobeCenter: number;
  exhaustLobeCenter: number;

  redline: number;
  revLimit: number;
  starterTorque: number;
  simulationFrequency: number;
  jitter: number;

  vehicleMass: number;
  diffRatio: number;
  gearRatios: number[];
  maxClutchTorque: number;
}

const VARIANTS: OddVVariant[] = [
  {
    id: 'v3-60',
    label: '60° V3 1.2',
    name: 'Generic 60 deg. V3 (odd-fire)',
    description: '1.2 L 60° V3 on two crank pins — 180-240-300 firing, limps at idle',
    bankAngles: [30, -30],
    // Bank 0 fires at 0 and 180; the lone cylinder on bank 1 waits until 420,
    // which puts it on the same pin as bank 0 cylinder 0.
    firing: [[0, 180], [420]],
    bore: 82,
    stroke: 78,
    rodLength: 140,
    compressionHeight: 28,
    pistonMass: 340,
    rodMass: 460,
    crankMass: 14,
    flywheelMass: 8,
    flywheelRadius: 130,
    frictionTorque: 6.0,
    // 412 cc swept against a 42 cc chamber: about 10.8:1.
    chamberVolume: 42,
    portFlowScale: 0.85,
    plenumVolume: 1.4,
    intakeCfm: 300.0,
    runnerCfm: 160.0,
    runnerLength: 8.0,
    idleThrottlePlatePosition: 0.992,
    outletCfm: 600.0,
    primaryCfm: 260.0,
    primaryTubeLength: 26.0,
    exhaustLengths: [96, 120],
    intakeDuration: 224,
    exhaustDuration: 228,
    intakeLift: 9.6,
    exhaustLift: 9.2,
    intakeLobeCenter: 110,
    exhaustLobeCenter: 112,
    redline: 7000,
    revLimit: 7300,
    starterTorque: 70,
    simulationFrequency: 16000,
    jitter: 0.3,
    vehicleMass: 950,
    diffRatio: 4.1,
    gearRatios: [3.55, 2.05, 1.39, 1.03, 0.84],
    maxClutchTorque: 200,
  },
  {
    id: 'v5-72',
    label: '72° V5 2.3',
    name: 'Generic 72 deg. V5 (odd-fire)',
    description: '2.3 L 72° V5, three throws for five rods — beats in pairs',
    bankAngles: [36, -36],
    // Three cylinders on bank 0, two on bank 1. Sorted, the five events land
    // at 0, 216, 288, 432 and 504 degrees.
    firing: [
      [0, 504, 288],
      [432, 216],
    ],
    bore: 81,
    stroke: 90.2,
    rodLength: 158,
    compressionHeight: 30,
    pistonMass: 380,
    rodMass: 500,
    crankMass: 20,
    flywheelMass: 11,
    flywheelRadius: 145,
    frictionTorque: 10.0,
    // 465 cc swept against a 46 cc chamber: about 11.1:1.
    chamberVolume: 46,
    portFlowScale: 0.95,
    plenumVolume: 2.0,
    intakeCfm: 480.0,
    runnerCfm: 200.0,
    runnerLength: 10.0,
    idleThrottlePlatePosition: 0.9935,
    outletCfm: 900.0,
    primaryCfm: 340.0,
    primaryTubeLength: 30.0,
    exhaustLengths: [108, 138],
    intakeDuration: 228,
    exhaustDuration: 232,
    intakeLift: 10.4,
    exhaustLift: 9.8,
    intakeLobeCenter: 112,
    exhaustLobeCenter: 114,
    redline: 6500,
    revLimit: 6800,
    starterTorque: 110,
    simulationFrequency: 13000,
    jitter: 0.28,
    vehicleMass: 1400,
    diffRatio: 3.68,
    gearRatios: [3.5, 2.09, 1.46, 1.03, 0.84, 0.69],
    maxClutchTorque: 300,
  },
];

function oddVSpec(variant: OddVVariant): EngineSpec {
  const stroke = units.distance(variant.stroke, units.mm);
  const bore = units.distance(variant.bore, units.mm);
  const rodLength = units.distance(variant.rodLength, units.mm);
  const rodMass = units.mass(variant.rodMass, units.g);
  const compressionHeight = units.distance(variant.compressionHeight, units.mm);

  const crankMass = units.mass(variant.crankMass, units.kg);
  const flywheelMass = units.mass(variant.flywheelMass, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, units.distance(variant.flywheelRadius, units.mm)) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(2.0, units.cm));

  const referenceAngle = variant.bankAngles[0];

  // One pin per distinct journal angle, so rods that share a throw really do.
  const pins = new Map<number, RodJournal>();
  const journalFor = (angleDeg: number): RodJournal => {
    const key = Math.round(angleDeg * 1e6) / 1e6;
    let pin = pins.get(key);
    if (pin === undefined) {
      pin = new RodJournal(deg(key));
      pins.set(key, pin);
    }
    return pin;
  };

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
    plenumVolume: units.volume(variant.plenumVolume, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
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
    impulseResponse: 'mild_exhaust',
    impulseResponseVolume: 0.01,
  };

  // Unequal bank lengths: with unequal firing gaps as well, the two collectors
  // never settle into the same rhythm.
  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    {
      ...exhaustCommon,
      length: units.distance(variant.exhaustLengths[0], units.inch),
      audioVolume: 1.4,
    },
    {
      ...exhaustCommon,
      length: units.distance(variant.exhaustLengths[1], units.inch),
      audioVolume: 1.2,
    },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.intakeDuration),
    gamma: 1.1,
    lift: units.distance(variant.intakeLift, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.exhaustDuration),
    gamma: 1.1,
    lift: units.distance(variant.exhaustLift, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(variant.intakeLobeCenter),
    exhaustLobeCenter: deg(variant.exhaustLobeCenter),
    baseRadius: units.distance(0.8, units.inch),
  };

  const head = (fireAngles: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(variant.chamberVolume, units.cc),
    intakeRunnerVolume: units.volume(130.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(15.0, units.cm2),
    exhaustRunnerVolume: units.volume(48.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(12.0, units.cm2),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW, 1.0, variant.portFlowScale),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW, 1.0, variant.portFlowScale),
    valvetrain: {
      kind: 'standard',
      ...bankCamshafts(camOptions, fireAngles.map(deg)),
    },
    flipDisplay,
  });

  const spacing = units.distance(5.0, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const posts: { wire: IgnitionWire; angle: number }[] = [];

  const banks: CylinderBankSpec[] = variant.bankAngles.map((bankAngle, b) => {
    const fireAngles = variant.firing[b];

    const bank: CylinderBankSpec = {
      angle: deg(bankAngle),
      bore,
      deckHeight,
      cylinders: fireAngles.map((fire, c) => {
        const wire = new IgnitionWire();
        posts.push({ wire, angle: deg(fire) });

        return {
          piston: piston(),
          connectingRod: makeRod(),
          rodJournal: journalFor(journalAngle(fire, bankAngle, referenceAngle)),
          intake,
          exhaustSystem: exhausts[b],
          ignitionWire: wire,
          soundAttenuation: 1.0 - 0.08 * c + 0.05 * b,
          primaryLength: (fireAngles.length - 1 - c) * spacing,
        };
      }),
      head: head(fireAngles, b === 0),
    };

    connectWires(bank);
    return bank;
  });

  posts.sort((a, b) => a.angle - b.angle);

  return {
    name: variant.name,
    starterTorque: units.torque(variant.starterTorque, units.ft_lb),
    starterSpeed: units.rpm(400),
    redline: units.rpm(variant.redline),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      maxTurbulenceEffect: 4.0,
    },
    hfGain: 0.008,
    noise: 0.8,
    jitter: variant.jitter,
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
        tdc: deg(90) + deg(referenceAngle),
        rodJournals: [...pins.values()],
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 14],
        [1000, 18],
        [2000, 26],
        [3000, 32],
        [4000, 36],
        [5000, 38],
        [6000, 38],
        [7000, 38],
      ]),
      revLimit: units.rpm(variant.revLimit),
      limiterDuration: 0.12,
      posts,
    },
  };
}

function oddVDefinition(variant: OddVVariant): EngineDefinition {
  const mass = units.mass(variant.vehicleMass, units.kg);

  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    engine: () => oddVSpec(variant),
    vehicle: () => ({
      mass,
      dragCoefficient: 0.3,
      crossSectionArea: units.distance(68, units.inch) * units.distance(54, units.inch),
      diffRatio: variant.diffRatio,
      tireRadius: units.distance(10, units.inch),
      rollingResistance: 0.015 * mass * 9.81,
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(variant.maxClutchTorque, units.ft_lb),
      gearRatios: variant.gearRatios,
    }),
  };
}

export const v3Sixty = oddVDefinition(VARIANTS[0]);
export const v5SeventyTwo = oddVDefinition(VARIANTS[1]);
