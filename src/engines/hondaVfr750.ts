/**
 * Honda VFR750 (RC36): 748 cc, 90-degree V4, gear-driven cams, 180-degree
 * crank.
 *
 * Two crank pins 180 degrees apart, each carrying one front and one rear rod.
 * With the banks 90 degrees apart that produces the V4's signature uneven
 * firing — 180, 270, 180, 90 crank degrees between events — which is where the
 * gear-whine-and-warble character comes from rather than from any even beat.
 *
 * The invariant used across this directory: a cylinder reaches top dead centre
 * at cycle angle `F = J + (A0 - A) (mod 360)` for journal angle `J`, bank angle
 * `A` and reference bank angle `A0`, with the crank `tdc` at `90deg + A0`.
 * Choosing `F` or `F + 360` selects the revolution it fires on, and here that
 * choice is what sets the 180/270/180/90 pattern. The same `F` values are the
 * camshaft lobe offsets and the ignition post angles.
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

/** Small four-valve ports: peaky, all of it above 250 thou. */
const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 34],
  [100, 68],
  [150, 104],
  [200, 138],
  [250, 166],
  [300, 186],
  [350, 198],
  [400, 205],
  [450, 208],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 26],
  [100, 54],
  [150, 84],
  [200, 108],
  [250, 126],
  [300, 138],
  [350, 145],
  [400, 149],
  [450, 150],
];

interface VfrCylinder {
  journal: number;
  wire: number;
  /** Ignition angle within the 720-degree cycle, in crank degrees. */
  fire: number;
  soundAttenuation: number;
  primary: number;
}

// Bank 0 is the front pair, bank 1 the rear. Sorted by `fire` the sequence is
// 0, 180, 450, 630: gaps of 180, 270, 180 and 90 degrees.
const BANK0: VfrCylinder[] = [
  { journal: 0, wire: 0, fire: 0, soundAttenuation: 1.0, primary: 1 },
  { journal: 1, wire: 1, fire: 180, soundAttenuation: 0.9, primary: 3 },
];

const BANK1: VfrCylinder[] = [
  { journal: 0, wire: 2, fire: 450, soundAttenuation: 0.85, primary: 0 },
  { journal: 1, wire: 3, fire: 630, soundAttenuation: 0.95, primary: 2 },
];

export function hondaVfr750Spec(): EngineSpec {
  const stroke = units.distance(48.6, units.mm);
  const bore = units.distance(70, units.mm);
  const rodLength = units.distance(100, units.mm);
  const rodMass = units.mass(230, units.g);
  const compressionHeight = units.distance(25, units.mm);

  const crankMass = units.mass(7.5, units.kg);
  const flywheelMass = units.mass(2.4, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(95, units.mm)) +
    diskMomentOfInertia(units.mass(1.0, units.kg), units.distance(2.0, units.cm));

  const vAngle = deg(90);
  const bank0Angle = vAngle / 2;

  const wires = Array.from({ length: 4 }, () => new IgnitionWire());
  // 180-degree crank: two pins, one front rod and one rear rod on each.
  const journals = [0, 180].map((a) => new RodJournal(deg(a)));

  const piston = () => ({
    mass: units.mass(180, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.01),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(3.2, units.L),
    plenumCrossSectionArea: units.area(12.0, units.cm2),
    intakeFlowRate: k_carb(480.0),
    runnerFlowRate: k_carb(170.0),
    runnerLength: units.distance(7.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9975,
    velocityDecay: 0.5,
  };

  const collectorCrossSectionArea = circleArea(units.distance(1.75, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(700.0),
    primaryTubeLength: units.distance(34.0, units.inch),
    primaryFlowRate: k_carb(260.0),
    velocityDecay: 0.9,
    collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_03',
    impulseResponseVolume: 0.01,
  };

  // A 4-into-2-into-1: the two banks feed pipes of slightly different length.
  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    {
      ...exhaustCommon,
      length: units.volume(7.0, units.L) / collectorCrossSectionArea,
      audioVolume: 0.4,
    },
    {
      ...exhaustCommon,
      length: units.volume(8.2, units.L) / collectorCrossSectionArea,
      audioVolume: 0.34,
    },
  ];

  // Gear-driven cams: no chain slop, so the profiles can be steep.
  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(248),
    gamma: 1.15,
    lift: units.distance(9.4, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(240),
    gamma: 1.15,
    lift: units.distance(8.8, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(108),
    exhaustLobeCenter: deg(106),
    baseRadius: units.distance(500, units.thou),
  };

  const head = (cylinders: VfrCylinder[], flipDisplay: boolean): CylinderHeadSpec => ({
    // 187 cc swept against a 17.6 cc chamber: about 11.6:1.
    chamberVolume: units.volume(17.6, units.cc),
    intakeRunnerVolume: units.volume(90.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(11.0, units.cm2),
    exhaustRunnerVolume: units.volume(35.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(9.0, units.cm2),
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
    cylinders: VfrCylinder[],
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
    name: 'Honda VFR750 [90 deg. V4]',
    starterTorque: units.torque(50, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(12500),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 5.5,
      maxBurningEfficiency: 1.0,
      burningEfficiencyRandomness: 0.05,
    },
    hfGain: 0.0035,
    noise: 0.24,
    jitter: 0.07,
    simulationFrequency: 26000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(1.5, units.ft_lb),
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
        [1000, 22],
        [2000, 30],
        [3000, 36],
        [4000, 40],
        [6000, 40],
        [8000, 40],
        [10000, 38],
        [12000, 36],
      ]),
      revLimit: units.rpm(13000),
      limiterDuration: 0.05,
      posts,
    },
  };
}

export const hondaVfr750: EngineDefinition = {
  id: 'honda-vfr750',
  label: 'Honda VFR750 V4',
  description: '748 cc 90 deg. V4, gear-driven cams, 180 deg. crank — 12 500 rpm',
  engine: hondaVfr750Spec,
  vehicle: () => ({
    mass: units.mass(560, units.lb),
    dragCoefficient: 0.12,
    crossSectionArea: units.distance(22, units.inch) * units.distance(47, units.inch),
    diffRatio: 2.75,
    tireRadius: units.distance(12, units.inch),
    rollingResistance: units.force(130, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(140, units.ft_lb),
    gearRatios: [2.846, 2.062, 1.65, 1.416, 1.25, 1.13],
  }),
};
