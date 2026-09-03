/**
 * Generic 4.0 L race flat-plane V8.
 *
 * Not a copy of the Ferrari F136: this one is a shorter-stroke, smaller-bore
 * sports-prototype engine on individual throttle bodies, with a different
 * firing order (1-8-2-6-4-5-3-7 against the F136's 1-5-3-7-4-8-2-6) and equal
 * length primaries feeding one collector per bank.
 *
 * Geometry note that the whole file depends on. With bank 0 taken as the
 * reference, a cylinder reaches top dead centre — and so must be fired — at
 * cycle angle
 *
 *   F = J + (A0 - A)   (mod 360 degrees)
 *
 * where `J` is its rod journal angle, `A` its bank angle and `A0` the reference
 * bank angle, and the crankshaft's `tdc` is `90deg + A0`. Choosing `F` or
 * `F + 360` picks which of the two crank revolutions the cylinder fires on.
 * Every `fire` value below satisfies that relation, and the same values are
 * reused verbatim as the camshaft lobe offsets, so cam timing and spark can
 * never drift apart.
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

interface FlatPlaneCylinder {
  /** Index into the shared journal list. */
  journal: number;
  /** Zero-based wire number. */
  wire: number;
  /** Ignition angle within the 720-degree cycle, in crank degrees. */
  fire: number;
  blowby: number;
  soundAttenuation: number;
  /** Multiple of the header spacing. */
  primary: number;
}

// Bank 0 is the left bank, at +45 degrees; bank 1 the right, at -45.
// Journals run 0-180-180-0 down the flat crank, shared by both banks.
const BANK0: FlatPlaneCylinder[] = [
  { journal: 0, wire: 0, fire: 0, blowby: 0.05, soundAttenuation: 1.0, primary: 3 },
  { journal: 1, wire: 1, fire: 180, blowby: 0.05, soundAttenuation: 0.9, primary: 2 },
  { journal: 2, wire: 2, fire: 540, blowby: 0.05, soundAttenuation: 1.1, primary: 1 },
  { journal: 3, wire: 3, fire: 360, blowby: 0.05, soundAttenuation: 0.95, primary: 0 },
];

const BANK1: FlatPlaneCylinder[] = [
  { journal: 0, wire: 4, fire: 450, blowby: 0.05, soundAttenuation: 0.9, primary: 3 },
  { journal: 1, wire: 5, fire: 270, blowby: 0.05, soundAttenuation: 1.05, primary: 2 },
  { journal: 2, wire: 6, fire: 630, blowby: 0.05, soundAttenuation: 0.85, primary: 1 },
  { journal: 3, wire: 7, fire: 90, blowby: 0.05, soundAttenuation: 1.0, primary: 0 },
];

export function flatPlaneV8Spec(): EngineSpec {
  const stroke = units.distance(78.6, units.mm);
  const bore = units.distance(90, units.mm);
  const rodLength = units.distance(152, units.mm);
  const rodMass = units.mass(480, units.g);
  const compressionHeight = units.distance(1.0, units.inch);

  const crankMass = units.mass(38, units.lb);
  const flywheelMass = units.mass(14, units.lb);
  const flywheelRadius = units.distance(6.0, units.inch);

  const moment =
    1.5 * diskMomentOfInertia(crankMass, stroke) +
    diskMomentOfInertia(flywheelMass, flywheelRadius) +
    diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = deg(90);
  const bank0Angle = vAngle / 2;

  const wires = Array.from({ length: 8 }, () => new IgnitionWire());
  // Flat crank: 0-180-180-0.
  const journals = [0, 180, 180, 0].map((a) => new RodJournal(deg(a)));

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(320, units.g),
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

  // Individual throttle bodies: a small plenum on a very free-flowing runner.
  const intake = {
    plenumVolume: units.volume(0.9, units.L),
    plenumCrossSectionArea: units.area(24.0, units.cm2),
    intakeFlowRate: k_carb(900.0),
    runnerFlowRate: k_carb(300.0),
    runnerLength: units.distance(9.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9965,
    velocityDecay: 0.4,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(1400.0),
    primaryTubeLength: units.distance(34.0, units.inch),
    primaryFlowRate: k_carb(800.0),
    velocityDecay: 0.5,
    impulseResponse: 'minimal_muffling_02',
    impulseResponseVolume: 0.01,
  };

  const exhaust0: ExhaustSpec = {
    ...exhaustCommon,
    length: units.distance(86, units.inch),
    audioVolume: 0.22,
  };
  const exhaust1: ExhaustSpec = {
    ...exhaustCommon,
    length: units.distance(92, units.inch),
    audioVolume: 0.2,
  };

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(240),
    gamma: 1.1,
    lift: units.distance(12.5, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(236),
    gamma: 1.1,
    lift: units.distance(11.8, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(100),
    exhaustLobeCenter: deg(112),
    baseRadius: units.distance(0.85, units.inch),
  };

  const head = (cylinders: FlatPlaneCylinder[], flipDisplay: boolean): CylinderHeadSpec => ({
    // 500 cc of swept volume against a 44 cc chamber: about 12.4:1.
    chamberVolume: units.volume(44, units.cc),
    intakeRunnerVolume: units.volume(140.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(19.0, units.cm2),
    exhaustRunnerVolume: units.volume(48.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(15.0, units.cm2),
    intakePortFlow: flowFunction(MODERN_4V_INTAKE_FLOW, 1.0, 1.15),
    exhaustPortFlow: flowFunction(MODERN_4V_EXHAUST_FLOW, 1.0, 1.15),
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
    cylinders: FlatPlaneCylinder[],
    exhaustSystem: ExhaustSpec,
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const bank: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      cylinders: cylinders.map((cylinder) => ({
        piston: piston(cylinder.blowby),
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

  const bank0 = makeBank(bank0Angle, BANK0, exhaust0, true);
  const bank1 = makeBank(-bank0Angle, BANK1, exhaust1, false);

  // 1-8-2-6-4-5-3-7, one every 90 degrees.
  const posts = [...BANK0, ...BANK1]
    .slice()
    .sort((a, b) => a.fire - b.fire)
    .map((cylinder) => ({ wire: wires[cylinder.wire], angle: deg(cylinder.fire) }));

  return {
    name: 'Flat-plane V8 4.0',
    starterTorque: units.torque(150, units.ft_lb),
    starterSpeed: units.rpm(300),
    redline: units.rpm(8500),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      maxTurbulenceEffect: 5.0,
      burningEfficiencyRandomness: 0.2,
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.12,
    simulationFrequency: 10000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(12.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90) + bank0Angle,
        rodJournals: journals,
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 14],
        [1000, 16],
        [2000, 24],
        [3000, 32],
        [4000, 38],
        [5000, 40],
        [6000, 40],
        [7000, 40],
        [8000, 40],
      ]),
      revLimit: units.rpm(8800),
      limiterDuration: 0.08,
      posts,
    },
  };
}

export const flatPlaneV8: EngineDefinition = {
  id: 'flat-plane-v8',
  label: 'Flat-plane V8 4.0',
  description: '4.0 L race flat-plane V8 on throttle bodies — 8500 rpm howl',
  engine: flatPlaneV8Spec,
  vehicle: () => ({
    mass: units.mass(1180, units.kg),
    dragCoefficient: 0.32,
    crossSectionArea: units.distance(74, units.inch) * units.distance(45, units.inch),
    diffRatio: 3.9,
    tireRadius: units.distance(11, units.inch),
    rollingResistance: units.force(180, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(400, units.ft_lb),
    gearRatios: [3.15, 2.19, 1.71, 1.39, 1.16, 0.98],
  }),
};
