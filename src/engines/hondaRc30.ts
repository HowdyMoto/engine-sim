/**
 * Honda VFR750R RC30, 1987: 748 cc, 90-degree V4, gear-driven cams, titanium
 * rods, and the feature that separates it from the VFR750 already in this
 * roster - a 360-degree crankshaft.
 *
 * Both crank pins sit at the same angle, so the two cylinders sharing a bank
 * reach top dead centre together and fire on alternate revolutions. Against the
 * 90-degree vee that gives firing gaps of 90, 270, 90, 270 crank degrees:
 * the engine fires as two closely spaced pairs rather than the 180/270/180/90
 * of the 180-degree crank in the road bike. That pairing is where the RC30's
 * hard, twin-like bark comes from instead of the VFR's smoother warble.
 *
 * Following the invariant used across this directory, a cylinder reaches top
 * dead centre at cycle angle `F = J + (A0 - A) (mod 360)` for journal angle
 * `J`, bank angle `A` and reference bank angle `A0`, with the crank `tdc` at
 * `90deg + A0`. With both journals at zero and the banks at plus and minus 45
 * degrees, the front pair resolves to 0 and 360 and the rear pair to 90 and
 * 450. Those same four numbers are the camshaft lobe offsets and the ignition
 * post angles.
 *
 * Geometry is shared with the VFR750 because the RC30 is a homologation build
 * of it: same 70 x 48.6 mm. What changes is the crank, lighter reciprocating
 * mass, more cam, and the revs those buy.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires } from './parts';
import type {
  CylinderBankSpec,
  CylinderHeadSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

/** Race-ported four-valve heads: more everywhere than the road engine. */
const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 38],
  [100, 76],
  [150, 115],
  [200, 152],
  [250, 182],
  [300, 203],
  [350, 217],
  [400, 224],
  [450, 227],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 29],
  [100, 60],
  [150, 93],
  [200, 119],
  [250, 139],
  [300, 152],
  [350, 160],
  [400, 165],
  [450, 166],
];

interface Rc30Cylinder {
  journal: number;
  wire: number;
  /** Ignition angle within the 720-degree cycle, in crank degrees. */
  fire: number;
  soundAttenuation: number;
  primary: number;
}

// Bank 0 is the front pair, bank 1 the rear. Sorted by `fire` the sequence is
// 0, 90, 360, 450: gaps of 90, 270, 90 and 270 degrees.
const BANK0: Rc30Cylinder[] = [
  { journal: 0, wire: 0, fire: 0, soundAttenuation: 1.0, primary: 1 },
  { journal: 1, wire: 1, fire: 360, soundAttenuation: 0.92, primary: 3 },
];

const BANK1: Rc30Cylinder[] = [
  { journal: 0, wire: 2, fire: 90, soundAttenuation: 0.88, primary: 0 },
  { journal: 1, wire: 3, fire: 450, soundAttenuation: 0.96, primary: 2 },
];

export function hondaRc30Spec(): EngineSpec {
  const stroke = units.distance(48.6, units.mm);
  const bore = units.distance(70, units.mm);
  const rodLength = units.distance(100, units.mm);
  // Titanium rods, which is most of why it revs past the road engine.
  const rodMass = units.mass(196, units.g);
  const compressionHeight = units.distance(25, units.mm);

  const crankMass = units.mass(7.1, units.kg);
  const flywheelMass = units.mass(1.9, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(92, units.mm)) +
    diskMomentOfInertia(units.mass(0.9, units.kg), units.distance(2.0, units.cm));

  const vAngle = deg(90);
  const bank0Angle = vAngle / 2;

  const wires = Array.from({ length: 4 }, () => new IgnitionWire());
  // 360-degree crank: both pins at the same angle, one front and one rear rod
  // on each.
  const journals = [0, 0].map((a) => new RodJournal(deg(a)));

  const piston = () => ({
    mass: units.mass(172, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.008),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(3.0, units.L),
    plenumCrossSectionArea: units.area(13.0, units.cm2),
    intakeFlowRate: k_carb(560.0),
    runnerFlowRate: k_carb(200.0),
    runnerLength: units.distance(6.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9972,
    velocityDecay: 0.5,
  };

  const collectorCrossSectionArea = circleArea(units.distance(1.85, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(820.0),
    primaryTubeLength: units.distance(31.0, units.inch),
    primaryFlowRate: k_carb(300.0),
    velocityDecay: 0.9,
    collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_02',
    impulseResponseVolume: 0.01,
  };

  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    {
      ...exhaustCommon,
      length: units.volume(6.4, units.L) / collectorCrossSectionArea,
      audioVolume: 0.44,
    },
    {
      ...exhaustCommon,
      length: units.volume(7.5, units.L) / collectorCrossSectionArea,
      audioVolume: 0.38,
    },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(258),
    gamma: 1.15,
    lift: units.distance(9.9, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(250),
    gamma: 1.15,
    lift: units.distance(9.2, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(105),
    exhaustLobeCenter: deg(104),
    baseRadius: units.distance(500, units.thou),
  };

  const head = (cylinders: Rc30Cylinder[], flipDisplay: boolean): CylinderHeadSpec => ({
    // 187 cc swept against a 17.4 cc chamber: about 11.8:1.
    chamberVolume: units.volume(17.4, units.cc),
    intakeRunnerVolume: units.volume(88.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(11.5, units.cm2),
    exhaustRunnerVolume: units.volume(34.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(9.4, units.cm2),
    intakePortFlow: flowFunction(HEAD_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(HEAD_EXHAUST_FLOW),
    valvetrain: {
      kind: 'standard',
      ...bankCamshafts(
        camOptions,
        cylinders.map((c) => deg(c.fire)),
      ),
    },
    flipDisplay,
  });

  const spacing = units.distance(3.0, units.cm);
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const makeBank = (
    angle: number,
    cylinders: Rc30Cylinder[],
    exhaustSystem: ExhaustSpec,
    flipDisplay: boolean,
  ): CylinderBankSpec => {
    const bank: CylinderBankSpec = {
      angle,
      bore,
      deckHeight,
      displayDepth: 0.5,
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

  const bank0 = makeBank(bank0Angle, BANK0, exhausts[0], true);
  const bank1 = makeBank(-bank0Angle, BANK1, exhausts[1], false);

  const posts = [...BANK0, ...BANK1]
    .slice()
    .sort((a, b) => a.fire - b.fire)
    .map((cylinder) => ({ wire: wires[cylinder.wire], angle: deg(cylinder.fire) }));

  return {
    name: 'Honda RC30 [90 deg. V4, 360 deg. crank]',
    starterTorque: units.torque(52, units.ft_lb),
    starterSpeed: units.rpm(550),
    redline: units.rpm(13000),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 5.8,
      maxBurningEfficiency: 1.0,
      burningEfficiencyRandomness: 0.045,
    },
    hfGain: 0.0038,
    noise: 0.22,
    jitter: 0.06,
    simulationFrequency: 28000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(1.4, units.ft_lb),
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
        [0, 18],
        [1000, 23],
        [2000, 31],
        [3000, 37],
        [4000, 41],
        [6000, 42],
        [8000, 42],
        [10000, 40],
        [13000, 37],
      ]),
      revLimit: units.rpm(13500),
      limiterDuration: 0.05,
      posts,
    },
  };
}

export const hondaRc30: EngineDefinition = {
  id: 'honda-rc30',
  label: 'Honda RC30 V4',
  description: '748 cc 90 deg. V4, 360 deg. crank, titanium rods — 13 000 rpm',
  engine: hondaRc30Spec,
  vehicle: () => ({
    mass: units.mass(408, units.lb),
    dragCoefficient: 0.11,
    crossSectionArea: units.distance(21, units.inch) * units.distance(45, units.inch),
    diffRatio: 2.6,
    tireRadius: units.distance(12, units.inch),
    rollingResistance: units.force(110, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(150, units.ft_lb),
    gearRatios: [2.6, 1.94, 1.6, 1.4, 1.26, 1.15],
  }),
};
