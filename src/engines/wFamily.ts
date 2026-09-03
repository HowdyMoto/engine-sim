/**
 * W engines: three or four cylinder banks on a single crankshaft.
 *
 * Nothing in the builder assumes two banks — the radial definitions already
 * prove that arbitrary bank counts work — so a W is just a `banks` array with
 * more than two entries, each at its own angle off vertical.
 *
 *   W8    four banks of two, two narrow-angle VR4s 72 degrees apart, 4.0 L
 *   W12   four banks of three, two VR6s 72 degrees apart, 6.0 L
 *   W16   four banks of four, two VR8s 90 degrees apart, 8.0 L
 *   W9    three banks of three on a three-throw crank, 4.8 L, odd-fire
 *
 * The crank is derived rather than written out. Every definition in this
 * directory obeys
 *
 *   F = J + (A0 - A)   (mod 360 degrees)
 *
 * where `F` is the cycle angle at which a cylinder reaches top dead centre and
 * must be fired, `J` its rod journal angle, `A` its bank angle and `A0` the
 * reference (first) bank angle, with the crankshaft `tdc` at `90deg + A0`. The
 * variants below state the firing schedule they want and `journalAngle` solves
 * that relation for `J`, so the crank, the camshaft lobe offsets and the
 * ignition posts are all the same numbers by construction and cannot drift.
 *
 * That inversion is what makes a W honest: with banks 15, 72 and 87 degrees
 * apart, even firing demands split crankpins at those same odd offsets, which
 * is exactly what a real W-engine crank carries. The W9 goes the other way —
 * three cylinders share each throw, so its nine events land in three tight
 * triplets 40 degrees apart with 160-degree gaps between them.
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

interface WVariant {
  id: string;
  label: string;
  name: string;
  description: string;

  /** Bank angles off vertical, in degrees. Bank 0 is the reference. */
  bankAngles: number[];
  /** Firing angle of every cylinder, `[bank][cylinder]`, in crank degrees. */
  firing: number[][];

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
  idleThrottlePlatePosition: number;

  outletCfm: number;
  primaryCfm: number;
  exhaustBaseLength: number;

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

  vehicleMass: number;
  diffRatio: number;
  gearRatios: number[];
  maxClutchTorque: number;
}

const VW_BANK_ANGLES = [-43.5, -28.5, 28.5, 43.5];
const VEYRON_BANK_ANGLES = [-52.5, -37.5, 37.5, 52.5];

const VARIANTS: WVariant[] = [
  {
    id: 'w8',
    label: 'W8 4.0',
    name: 'Generic W8 (4 banks x 2)',
    description: '4.0 L W8 — two narrow-angle fours splayed 72 degrees, even 90 deg. firing',
    bankAngles: VW_BANK_ANGLES,
    // Even 90-degree firing: 0-90-180-270-360-450-540-630.
    firing: [
      [0, 540],
      [360, 180],
      [90, 630],
      [450, 270],
    ],
    bore: 84,
    stroke: 90.2,
    rodLength: 162,
    compressionHeight: 30,
    pistonMass: 400,
    rodMass: 520,
    crankMass: 26,
    flywheelMass: 12,
    flywheelRadius: 150,
    frictionTorque: 14.0,
    // 500 cc swept against a 51 cc chamber: about 10.8:1.
    chamberVolume: 51,
    portFlowScale: 0.95,
    plenumVolume: 2.4,
    intakeCfm: 640.0,
    runnerCfm: 220.0,
    idleThrottlePlatePosition: 0.9945,
    outletCfm: 1000.0,
    primaryCfm: 420.0,
    exhaustBaseLength: 110,
    intakeDuration: 226,
    exhaustDuration: 230,
    intakeLift: 10.5,
    exhaustLift: 10.0,
    intakeLobeCenter: 112,
    exhaustLobeCenter: 114,
    redline: 6500,
    revLimit: 6800,
    starterTorque: 180,
    simulationFrequency: 11000,
    vehicleMass: 1800,
    diffRatio: 3.7,
    gearRatios: [3.67, 2.19, 1.41, 1.0, 0.83, 0.69],
    maxClutchTorque: 400,
  },
  {
    id: 'w12',
    label: 'W12 6.0',
    name: 'Generic W12 (4 banks x 3)',
    description: '6.0 L W12 — two narrow-angle sixes on one crank, even 60 deg. firing',
    bankAngles: VW_BANK_ANGLES,
    // Even 60-degree firing across twelve cylinders.
    firing: [
      [0, 240, 480],
      [120, 360, 600],
      [60, 300, 540],
      [180, 420, 660],
    ],
    bore: 84,
    stroke: 90.2,
    rodLength: 162,
    compressionHeight: 30,
    pistonMass: 400,
    rodMass: 520,
    crankMass: 34,
    flywheelMass: 16,
    flywheelRadius: 160,
    frictionTorque: 20.0,
    chamberVolume: 51,
    portFlowScale: 0.95,
    plenumVolume: 3.6,
    intakeCfm: 900.0,
    runnerCfm: 230.0,
    idleThrottlePlatePosition: 0.9955,
    outletCfm: 1500.0,
    primaryCfm: 420.0,
    exhaustBaseLength: 120,
    intakeDuration: 224,
    exhaustDuration: 228,
    intakeLift: 10.2,
    exhaustLift: 9.8,
    intakeLobeCenter: 114,
    exhaustLobeCenter: 116,
    redline: 6200,
    revLimit: 6500,
    starterTorque: 220,
    simulationFrequency: 9000,
    vehicleMass: 2350,
    diffRatio: 3.55,
    gearRatios: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69],
    maxClutchTorque: 600,
  },
  {
    id: 'w16',
    label: 'W16 8.0',
    name: 'Generic W16 (4 banks x 4)',
    description: '8.0 L W16 — two VR8s 90 degrees apart, sixteen events per cycle',
    bankAngles: VEYRON_BANK_ANGLES,
    // Even 45-degree firing across sixteen cylinders.
    firing: [
      [0, 180, 360, 540],
      [90, 270, 450, 630],
      [45, 225, 405, 585],
      [135, 315, 495, 675],
    ],
    bore: 86,
    stroke: 86,
    rodLength: 155,
    compressionHeight: 30,
    pistonMass: 410,
    rodMass: 500,
    crankMass: 42,
    flywheelMass: 18,
    flywheelRadius: 165,
    frictionTorque: 26.0,
    // 500 cc swept against a 55 cc chamber: about 10.1:1.
    chamberVolume: 55,
    portFlowScale: 1.05,
    plenumVolume: 4.8,
    intakeCfm: 1300.0,
    runnerCfm: 260.0,
    idleThrottlePlatePosition: 0.9935,
    outletCfm: 2000.0,
    primaryCfm: 500.0,
    exhaustBaseLength: 100,
    intakeDuration: 232,
    exhaustDuration: 236,
    intakeLift: 10.8,
    exhaustLift: 10.2,
    intakeLobeCenter: 112,
    exhaustLobeCenter: 114,
    redline: 6400,
    revLimit: 6800,
    starterTorque: 300,
    simulationFrequency: 7000,
    vehicleMass: 1900,
    diffRatio: 3.6,
    gearRatios: [2.4, 1.62, 1.19, 0.92, 0.75, 0.62, 0.51],
    maxClutchTorque: 900,
  },
  {
    id: 'w9',
    label: 'W9 4.8 (odd-fire)',
    name: 'Generic W9 (3 banks x 3, odd-fire)',
    description: '4.8 L three-bank W9 on a three-throw crank — fires in triplets, 40-40-160',
    bankAngles: [40, 0, -40],
    // Three cylinders share each throw, so each throw fires its three banks
    // 40 degrees apart and then the crank waits 160 degrees for the next.
    firing: [
      [0, 240, 480],
      [40, 280, 520],
      [80, 320, 560],
    ],
    bore: 90,
    stroke: 84,
    rodLength: 152,
    compressionHeight: 30,
    pistonMass: 430,
    rodMass: 540,
    crankMass: 30,
    flywheelMass: 15,
    flywheelRadius: 155,
    frictionTorque: 18.0,
    // 534 cc swept against a 56 cc chamber: about 10.5:1.
    chamberVolume: 56,
    portFlowScale: 1.0,
    plenumVolume: 3.0,
    intakeCfm: 780.0,
    runnerCfm: 240.0,
    idleThrottlePlatePosition: 0.994,
    outletCfm: 1300.0,
    primaryCfm: 450.0,
    exhaustBaseLength: 130,
    intakeDuration: 234,
    exhaustDuration: 238,
    intakeLift: 11.0,
    exhaustLift: 10.4,
    intakeLobeCenter: 110,
    exhaustLobeCenter: 112,
    redline: 6000,
    revLimit: 6300,
    starterTorque: 200,
    simulationFrequency: 10000,
    vehicleMass: 1750,
    diffRatio: 3.9,
    gearRatios: [3.5, 2.05, 1.38, 1.0, 0.81, 0.67],
    maxClutchTorque: 500,
  },
];

function wSpec(variant: WVariant): EngineSpec {
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
    diskMomentOfInertia(units.mass(2, units.kg), units.distance(2.0, units.cm));

  const referenceAngle = variant.bankAngles[0];

  // One crank pin per distinct journal angle: cylinders that reach top dead
  // centre together really do share a throw.
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
    plenumCrossSectionArea: units.area(30.0, units.cm2),
    intakeFlowRate: k_carb(variant.intakeCfm),
    runnerFlowRate: k_carb(variant.runnerCfm),
    runnerLength: units.distance(9.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: variant.idleThrottlePlatePosition,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(variant.outletCfm),
    primaryTubeLength: units.distance(28.0, units.inch),
    primaryFlowRate: k_carb(variant.primaryCfm),
    velocityDecay: 1.0,
    impulseResponse: 'mild_exhaust_reverb',
    impulseResponseVolume: 0.01,
  };

  // One collector per bank, each a little longer than the last so the banks
  // do not phase-cancel into a single flat note.
  const exhausts: ExhaustSpec[] = variant.bankAngles.map((_, b) => ({
    ...exhaustCommon,
    length: units.distance(variant.exhaustBaseLength + 6 * b, units.inch),
    audioVolume: 1.6 - 0.12 * b,
  }));

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
    baseRadius: units.distance(0.85, units.inch),
  };

  const head = (fireAngles: number[], flipDisplay: boolean): CylinderHeadSpec => ({
    chamberVolume: units.volume(variant.chamberVolume, units.cc),
    intakeRunnerVolume: units.volume(140.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(17.0, units.cm2),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(13.0, units.cm2),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW, 1.0, variant.portFlowScale),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW, 1.0, variant.portFlowScale),
    valvetrain: {
      kind: 'standard',
      ...bankCamshafts(
        camOptions,
        fireAngles.map(deg),
      ),
    },
    flipDisplay,
  });

  const spacing = units.distance(4.0, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const wires: IgnitionWire[] = [];
  const posts: { wire: IgnitionWire; angle: number }[] = [];

  const banks: CylinderBankSpec[] = variant.bankAngles.map((bankAngle, b) => {
    const fireAngles = variant.firing[b];

    const bank: CylinderBankSpec = {
      angle: deg(bankAngle),
      bore,
      deckHeight,
      displayDepth: 0.35,
      cylinders: fireAngles.map((fire, c) => {
        const wire = new IgnitionWire();
        wires.push(wire);
        posts.push({ wire, angle: deg(fire) });

        return {
          piston: piston(),
          connectingRod: makeRod(),
          rodJournal: journalFor(journalAngle(fire, bankAngle, referenceAngle)),
          intake,
          exhaustSystem: exhausts[b],
          ignitionWire: wire,
          // Vary the mix a little bank to bank so the layering is audible.
          soundAttenuation: 0.85 + 0.1 * ((b + c) % 3),
          primaryLength: (fireAngles.length - 1 - c) * spacing + b * units.distance(1, units.cm),
        };
      }),
      // Alternate the drawn head so the fan of banks reads left to right.
      head: head(fireAngles, b >= variant.bankAngles.length / 2),
    };

    connectWires(bank);
    return bank;
  });

  posts.sort((a, b) => a.angle - b.angle);

  return {
    name: variant.name,
    starterTorque: units.torque(variant.starterTorque, units.ft_lb),
    starterSpeed: units.rpm(250),
    redline: units.rpm(variant.redline),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      maxTurbulenceEffect: 4.0,
    },
    hfGain: 0.01,
    noise: 0.9,
    jitter: 0.25,
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
        [0, 12],
        [1000, 16],
        [2000, 24],
        [3000, 32],
        [4000, 36],
        [5000, 38],
        [6000, 38],
        [7000, 38],
      ]),
      revLimit: units.rpm(variant.revLimit),
      limiterDuration: 0.15,
      posts,
    },
  };
}

function wDefinition(variant: WVariant): EngineDefinition {
  const mass = units.mass(variant.vehicleMass, units.kg);

  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    engine: () => wSpec(variant),
    vehicle: () => ({
      mass,
      dragCoefficient: 0.31,
      crossSectionArea: units.distance(76, units.inch) * units.distance(56, units.inch),
      diffRatio: variant.diffRatio,
      tireRadius: units.distance(11, units.inch),
      rollingResistance: 0.014 * mass * 9.81,
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(variant.maxClutchTorque, units.ft_lb),
      gearRatios: variant.gearRatios,
    }),
  };
}

export const w8 = wDefinition(VARIANTS[0]);
export const w12 = wDefinition(VARIANTS[1]);
export const w16 = wDefinition(VARIANTS[2]);
export const w9 = wDefinition(VARIANTS[3]);
