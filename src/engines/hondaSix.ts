/**
 * Honda's six-cylinder Grand Prix engines: the 249 cc RC166 that won the 1966
 * 250 title, and the 297 cc RC174 built around the same crankcase for the 350
 * class the year after.
 *
 * These are the extreme end of what this simulator gets asked to model. Each
 * RC166 cylinder displaces about 41 cc - roughly a third of a modern 125 - and
 * the engine was run to 20 000 rpm. Everything here follows from that: a very
 * short 31 mm stroke, tiny reciprocating masses, almost no flywheel, cam
 * durations that would be undriveable on the road.
 *
 * On simulation frequency: the intuition that 20 000 rpm needs a very fine step
 * turned out to be wrong, and expensively so. This started at 42 kHz, which
 * measured 563% frame load and threw away two seconds of audio in every three -
 * a constant stutter. The engines reach the same speeds anywhere from 10 kHz
 * upwards, so none of that cost bought anything. At the figure here the browser
 * settles them around 10-12 kHz through its own quality control and the audio
 * queue never starves.
 *
 * What a finer step would buy is throttle resolution: unloaded, these reach the
 * limiter on about a third throttle. That is partly the step size and partly
 * honest - a 250 with race cams and almost no flywheel really does slam into
 * the limiter when you blip it in neutral - and clean audio is worth more here
 * than separating 35% from 100% on an engine with no load on it.
 *
 * The RC174 is the same engine bored from 41 to 45 mm on an unchanged stroke,
 * which is how Honda actually got from 250 to 350, so the two share a builder
 * and differ only in bore, piston mass and the tuning that follows.
 *
 * Crank layout is the ordinary inline six: journals at 0, 120 and 240 degrees
 * paired 1-6, 2-5, 3-4, firing 1-5-3-6-2-4 evenly every 120 degrees. Following
 * the invariant used across this directory, a single-bank engine has bank angle
 * equal to the reference angle, so a cylinder's fire angle, its journal angle
 * and its camshaft lobe offset are all the same number.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, makeFunction, harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const deg = (v: number) => units.angle(v, units.deg);

const CYLINDERS = 6;

/** Firing order 1-5-3-6-2-4, as zero-based cylinder indices. */
const FIRING_ORDER = [0, 4, 2, 5, 1, 3];

/**
 * Fire angle per cylinder in crank degrees: where each cylinder sits in the
 * order, times the 120-degree spacing of an even six.
 */
const FIRE_ANGLE: number[] = (() => {
  const position = new Array<number>(CYLINDERS);
  FIRING_ORDER.forEach((cylinder, index) => {
    position[cylinder] = index;
  });
  return position.map((slot) => slot * 120);
})();

/**
 * Four small valves per cylinder. Peak flow is modest in absolute terms - the
 * whole cylinder is 41 cc - but it arrives early and stays flat, which is what
 * lets the engine keep filling at five-figure engine speeds.
 */
const RC_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [25, 15],
  [50, 29],
  [75, 41],
  [100, 52],
  [125, 61],
  [150, 68],
  [175, 72],
  [200, 74],
  [250, 75],
];

const RC_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [25, 12],
  [50, 23],
  [75, 32],
  [100, 40],
  [125, 47],
  [150, 52],
  [175, 55],
  [200, 57],
  [250, 58],
];

/**
 * A racing burn curve, and the single thing that decides whether these engines
 * reach their real speeds.
 *
 * Measured while building this: with the flame-speed ratio the road engines in
 * this directory use, the RC166 pins at about 9000 rpm no matter what else is
 * changed. Cam duration from 258 to 298 degrees, simulation frequency to 80
 * kHz, friction near zero - none of it moves that ceiling, because the charge
 * simply cannot finish burning inside the time one cycle allows. Roughly
 * doubling the ratio is what lets it pull to the high teens.
 *
 * That is physically the right lever. Flame travel is only about 20 mm across
 * a 41 mm bore, but at 20 000 rpm a crank degree lasts eight microseconds, so
 * the burn has to be far quicker in absolute terms than anything on a road
 * engine.
 */
function racingFlameSpeed() {
  return makeFunction(5.0, [
    [0.0, 8.0],
    [5.0, 4.4 * 5.0],
    [10.0, 5.2 * 10.0],
    [15.0, 5.8 * 15.0],
    [20.0, 6.2 * 20.0],
    [25.0, 6.4 * 25.0],
    [30.0, 6.6 * 30.0],
    [35.0, 6.6 * 35.0],
    [40.0, 6.6 * 40.0],
    [45.0, 6.6 * 45.0],
  ]);
}

interface SixVariant {
  id: string;
  label: string;
  name: string;
  description: string;
  /** Bore in millimetres; stroke is 31 mm on both. */
  boreMm: number;
  pistonG: number;
  compressionRatio: number;
  redlineRpm: number;
  revLimitRpm: number;
  /** Cam duration at 50 thou, crank degrees. */
  camDurationDeg: number;
  camLiftMm: number;
  intakeCfm: number;
  outletCfm: number;
  /**
   * How far the plate stays closed at idle.
   *
   * Neither of these will hold a closed throttle, at any setting tried: with
   * this much overlap and almost no flywheel they make no useful torque below
   * their powerband and simply stop, which is what the real engines did too.
   * They are alive from roughly a third throttle upwards. The roster already
   * has this case in the 2JZ, whose description says the same thing.
   */
  idleThrottlePlate: number;
  idleBypassCfm: number;
  simulationFrequency: number;
  gearRatios: number[];
  vehicleMassLb: number;
}

const RC166: SixVariant = {
  id: 'honda-rc166',
  label: 'Honda RC166 250-6',
  name: 'Honda RC166 [249 cc inline six]',
  description:
    '249 cc six to 20 000 rpm, 1966 250 GP winner — no idle, so give it throttle',
  boreMm: 41,
  pistonG: 55,
  compressionRatio: 10.6,
  redlineRpm: 20000,
  revLimitRpm: 20500,
  camDurationDeg: 266,
  camLiftMm: 6.0,
  intakeCfm: 240,
  outletCfm: 340,
  idleThrottlePlate: 0.955,
  idleBypassCfm: 1.4,
  simulationFrequency: 20000,
  // Seven speeds, stacked tight around a powerband that starts at 16 000.
  gearRatios: [2.5, 2.05, 1.76, 1.55, 1.39, 1.27, 1.17],
  vehicleMassLb: 253,
};

const RC174: SixVariant = {
  id: 'honda-rc174',
  label: 'Honda RC174 350-6',
  name: 'Honda RC174 [297 cc inline six]',
  description:
    '297 cc six, the RC166 bored out for the 350 class — no idle, give it throttle',
  boreMm: 45,
  pistonG: 64,
  compressionRatio: 10.4,
  redlineRpm: 19000,
  revLimitRpm: 19500,
  camDurationDeg: 262,
  camLiftMm: 6.4,
  intakeCfm: 285,
  outletCfm: 400,
  idleThrottlePlate: 0.972,
  idleBypassCfm: 0.8,
  simulationFrequency: 20000,
  gearRatios: [2.42, 2.0, 1.73, 1.53, 1.38, 1.26, 1.16],
  vehicleMassLb: 291,
};

function hondaSixSpec(variant: SixVariant): EngineSpec {
  const stroke = units.distance(31, units.mm);
  const bore = units.distance(variant.boreMm, units.mm);
  const rodLength = units.distance(66, units.mm);
  const compressionHeight = units.distance(15, units.mm);

  const rodMass = units.mass(70, units.g);
  const crankMass = units.mass(4.6, units.kg);
  // Barely any flywheel: these were push-started and lived above 15 000 rpm.
  const flywheelMass = units.mass(0.85, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(70, units.mm)) +
    diskMomentOfInertia(units.mass(0.4, units.kg), units.distance(1.5, units.cm));

  const sweptVolume = (Math.PI / 4) * bore * bore * stroke;
  const chamberVolume = sweptVolume / (variant.compressionRatio - 1);

  const wires = Array.from({ length: CYLINDERS }, () => new IgnitionWire());
  const journals = FIRE_ANGLE.map((angle) => new RodJournal(deg(angle)));

  const piston = () => ({
    mass: units.mass(variant.pistonG, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.005),
  });

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  // Six individual slides, so the plenum is small and the runners are short.
  const intake = {
    plenumVolume: units.volume(0.65, units.L),
    plenumCrossSectionArea: units.area(6.0, units.cm2),
    intakeFlowRate: k_carb(variant.intakeCfm),
    runnerFlowRate: k_carb(variant.intakeCfm / 2.6),
    runnerLength: units.distance(3.6, units.inch),
    idleFlowRate: k_carb(variant.idleBypassCfm),
    idleThrottlePlatePosition: variant.idleThrottlePlate,
    velocityDecay: 0.4,
  };

  // Six megaphones, grouped into two systems so the audio path stays cheap.
  const exhaustCommon = {
    outletFlowRate: k_carb(variant.outletCfm),
    primaryTubeLength: units.distance(21.0, units.inch),
    primaryFlowRate: k_carb(variant.outletCfm / 2.8),
    velocityDecay: 0.75,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.008,
  };

  const exhausts: [ExhaustSpec, ExhaustSpec] = [
    { ...exhaustCommon, length: units.distance(46, units.inch), audioVolume: 0.36 },
    { ...exhaustCommon, length: units.distance(50, units.inch), audioVolume: 0.32 },
  ];

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.camDurationDeg),
    gamma: 1.2,
    lift: units.distance(variant.camLiftMm, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(variant.camDurationDeg - 6),
    gamma: 1.2,
    lift: units.distance(variant.camLiftMm - 0.3, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    // Still very wide, but pulled back from the point where overlap leaves no
    // torque at all below the powerband.
    intakeLobeCenter: deg(106),
    exhaustLobeCenter: deg(105),
    baseRadius: units.distance(330, units.thou),
  };

  const deckHeight = stroke / 2 + rodLength + compressionHeight;
  const spacing = units.distance(1.8, units.cm);

  const bank: CylinderBankSpec = {
    angle: 0,
    bore,
    deckHeight,
    cylinders: Array.from({ length: CYLINDERS }, (_, i) => ({
      piston: piston(),
      connectingRod: makeRod(),
      rodJournal: journals[i],
      intake,
      exhaustSystem: exhausts[i < 3 ? 0 : 1],
      ignitionWire: wires[i],
      soundAttenuation: 0.85 + 0.05 * (i % 3),
      primaryLength: (i % 3) * spacing,
    })),
    head: {
      chamberVolume,
      intakeRunnerVolume: units.volume(16.0, units.cc),
      intakeRunnerCrossSectionArea: units.area(2.4, units.cm2),
      exhaustRunnerVolume: units.volume(9.0, units.cc),
      exhaustRunnerCrossSectionArea: units.area(2.0, units.cm2),
      intakePortFlow: flowFunction(RC_INTAKE_FLOW),
      exhaustPortFlow: flowFunction(RC_EXHAUST_FLOW),
      valvetrain: {
        kind: 'standard',
        ...bankCamshafts(
          camOptions,
          FIRE_ANGLE.map((angle) => deg(angle)),
        ),
      },
    },
  };

  connectWires(bank);

  return {
    name: variant.name,
    starterTorque: units.torque(22, units.ft_lb),
    // These were push- and roller-started, and with this much overlap there is
    // no useful torque until the induction system starts working. The starter
    // has to hand the engine over well up its range, the way a paddock roller
    // does, or it never reaches the speed at which it can run at all.
    starterSpeed: units.rpm(7000),
    redline: units.rpm(variant.redlineRpm),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 6.5,
      maxBurningEfficiency: 1.0,
      burningEfficiencyRandomness: 0.04,
      turbulenceToFlameSpeedRatio: racingFlameSpeed(),
    },
    hfGain: 0.0032,
    noise: 0.2,
    jitter: 0.05,
    simulationFrequency: variant.simulationFrequency,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(0.5, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90),
        rodJournals: journals,
      },
    ],
    banks: [bank],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 16],
        [2000, 22],
        [5000, 30],
        [8000, 36],
        [11000, 40],
        [14000, 42],
        [17000, 42],
        [20000, 41],
      ]),
      revLimit: units.rpm(variant.revLimitRpm),
      limiterDuration: 0.04,
      posts: FIRING_ORDER.map((cylinder, slot) => ({
        wire: wires[cylinder],
        angle: deg(slot * 120),
      })),
    },
  };
}

function definition(variant: SixVariant): EngineDefinition {
  return {
    id: variant.id,
    label: variant.label,
    description: variant.description,
    engine: () => hondaSixSpec(variant),
    vehicle: () => ({
      mass: units.mass(variant.vehicleMassLb, units.lb),
      dragCoefficient: 0.55,
      crossSectionArea: units.distance(20, units.inch) * units.distance(42, units.inch),
      diffRatio: 2.4,
      tireRadius: units.distance(11, units.inch),
      rollingResistance: units.force(60, units.N),
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(45, units.ft_lb),
      gearRatios: variant.gearRatios,
    }),
  };
}

export const hondaRc166 = definition(RC166);
export const hondaRc174 = definition(RC174);
