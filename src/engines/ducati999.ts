/**
 * Ducati 999: a 90-degree L-twin, both rods on a single crank pin, with a
 * desmodromic valvetrain.
 *
 * The desmo gear closes the valves positively rather than on springs, so the
 * cam can run far more duration and lift than a spring-closed twin of the same
 * size would tolerate — hence the long lobes below against the Shovelhead's
 * 210 degrees.
 *
 * Firing is the classic 270/450 lope. Both cylinders share journal 0, and with
 * the banks 90 degrees apart the second cylinder's top dead centre falls 90
 * (or, one revolution later, 450) crank degrees after the first. Taking 450
 * puts a 450-degree gap after the vertical cylinder and a 270-degree gap after
 * the horizontal one, which is what gives the engine its off-beat idle.
 *
 * As elsewhere in this directory the invariant is `F = J + (A0 - A) (mod 360)`
 * for journal angle `J`, bank angle `A` and reference bank angle `A0`, with the
 * crankshaft `tdc` at `90deg + A0`. Cam lobe offsets and ignition posts both
 * use the same `F`.
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

/** Big two-valve desmo ports: strong at low lift, still climbing at the top. */
const HEAD_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 42],
  [100, 84],
  [150, 128],
  [200, 168],
  [250, 202],
  [300, 228],
  [350, 246],
  [400, 258],
  [450, 266],
  [500, 270],
];

const HEAD_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 32],
  [100, 66],
  [150, 100],
  [200, 128],
  [250, 150],
  [300, 166],
  [350, 176],
  [400, 182],
  [450, 186],
  [500, 188],
];

export function ducati999Spec(): EngineSpec {
  const stroke = units.distance(63.5, units.mm);
  const bore = units.distance(100, units.mm);
  const rodLength = units.distance(124, units.mm);
  const rodMass = units.mass(330, units.g);
  const compressionHeight = units.distance(30, units.mm);

  const crankMass = units.mass(9.0, units.kg);
  const flywheelMass = units.mass(3.2, units.kg);

  const moment =
    diskMomentOfInertia(crankMass, stroke / 2) +
    diskMomentOfInertia(flywheelMass, units.distance(110, units.mm)) +
    diskMomentOfInertia(units.mass(1.5, units.kg), units.distance(2.0, units.cm));

  const lAngle = deg(90);
  const bank0Angle = lAngle / 2;

  const wires = [new IgnitionWire(), new IgnitionWire()];
  // One crank pin, two rods side by side.
  const rj0 = new RodJournal(deg(0));

  // Vertical (rear) cylinder fires at 0, horizontal (front) at 450.
  const verticalFire = deg(0);
  const horizontalFire = deg(450);

  const piston = (blowbyScfm: number) => ({
    mass: units.mass(285, units.g),
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
    plenumVolume: units.volume(3.6, units.L),
    plenumCrossSectionArea: units.area(18.0, units.cm2),
    intakeFlowRate: k_carb(420.0),
    runnerFlowRate: k_carb(180.0),
    runnerLength: units.distance(6.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.9955,
    velocityDecay: 0.4,
  };

  // Two separate pipes: the twin's beat comes from them being unequal.
  const collectorCrossSectionArea = circleArea(units.distance(1.9, units.inch));
  const exhaustCommon = {
    outletFlowRate: k_carb(500.0),
    primaryFlowRate: k_carb(300.0),
    velocityDecay: 0.75,
    collectorCrossSectionArea,
    impulseResponse: 'minimal_muffling_01',
    impulseResponseVolume: 0.01,
  };

  const exhaustVertical: ExhaustSpec = {
    ...exhaustCommon,
    primaryTubeLength: units.distance(30.0, units.inch),
    length: units.volume(6.0, units.L) / collectorCrossSectionArea,
    audioVolume: 0.5,
  };

  const exhaustHorizontal: ExhaustSpec = {
    ...exhaustCommon,
    primaryTubeLength: units.distance(38.0, units.inch),
    length: units.volume(7.5, units.L) / collectorCrossSectionArea,
    audioVolume: 0.42,
  };

  // Desmodromic: no spring to out-run, so long duration and a lot of lift.
  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: deg(250),
    gamma: 0.85,
    lift: units.distance(12.0, units.mm),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: deg(242),
    gamma: 0.85,
    lift: units.distance(11.0, units.mm),
    steps: 256,
  });

  const camOptions = {
    lobeProfile: intakeLobe,
    intakeLobeProfile: intakeLobe,
    exhaustLobeProfile: exhaustLobe,
    intakeLobeCenter: deg(110),
    exhaustLobeCenter: deg(110),
    baseRadius: units.distance(600, units.thou),
  };

  const head = (fire: number, flipDisplay: boolean): CylinderHeadSpec => ({
    // 499 cc swept against a 46 cc chamber: about 11.9:1.
    chamberVolume: units.volume(46, units.cc),
    intakeRunnerVolume: units.volume(120.0, units.cc),
    intakeRunnerCrossSectionArea: units.area(18.0, units.cm2),
    exhaustRunnerVolume: units.volume(45.0, units.cc),
    exhaustRunnerCrossSectionArea: units.area(14.0, units.cm2),
    intakePortFlow: flowFunction(HEAD_INTAKE_FLOW),
    exhaustPortFlow: flowFunction(HEAD_EXHAUST_FLOW),
    valvetrain: { kind: 'standard', ...bankCamshafts(camOptions, [fire]) },
    flipDisplay,
  });

  const bankParams = {
    bore,
    deckHeight: stroke / 2 + rodLength + compressionHeight,
    displayDepth: 0.55,
  };

  const bank0: CylinderBankSpec = {
    ...bankParams,
    angle: bank0Angle,
    cylinders: [
      {
        piston: piston(0.02),
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaustVertical,
        ignitionWire: wires[0],
        soundAttenuation: 1.0,
        primaryLength: units.distance(6, units.cm),
      },
    ],
    head: head(verticalFire, true),
  };

  const bank1: CylinderBankSpec = {
    ...bankParams,
    angle: -bank0Angle,
    cylinders: [
      {
        piston: piston(0.02),
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaustHorizontal,
        ignitionWire: wires[1],
        soundAttenuation: 0.85,
        primaryLength: units.distance(1, units.cm),
      },
    ],
    head: head(horizontalFire, false),
  };

  connectWires(bank0);
  connectWires(bank1);

  return {
    name: 'Ducati 999 [90 deg. L-twin]',
    starterTorque: units.torque(60, units.ft_lb),
    starterSpeed: units.rpm(400),
    redline: units.rpm(10500),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxTurbulenceEffect: 5.0,
      maxBurningEfficiency: 1.0,
      burningEfficiencyRandomness: 0.1,
    },
    hfGain: 0.004,
    noise: 0.32,
    jitter: 0.09,
    simulationFrequency: 24000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(2.0, units.ft_lb),
        momentOfInertia: moment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: deg(90) + bank0Angle,
        rodJournals: [rj0],
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 16],
        [1000, 20],
        [2000, 28],
        [3000, 34],
        [4000, 38],
        [6000, 38],
        [8000, 38],
        [10000, 36],
      ]),
      revLimit: units.rpm(11000),
      limiterDuration: 0.06,
      posts: [
        { wire: wires[0], angle: verticalFire },
        { wire: wires[1], angle: horizontalFire },
      ],
    },
  };
}

export const ducati999: EngineDefinition = {
  id: 'ducati-999',
  label: 'Ducati 999 L-twin',
  description: '998 cc 90 deg. desmo L-twin — 270/450 firing, 10 500 rpm',
  engine: ducati999Spec,
  vehicle: () => ({
    mass: units.mass(430, units.lb),
    dragCoefficient: 0.12,
    crossSectionArea: units.distance(22, units.inch) * units.distance(47, units.inch),
    diffRatio: 2.5,
    tireRadius: units.distance(12, units.inch),
    rollingResistance: units.force(120, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(150, units.ft_lb),
    gearRatios: [2.466, 1.764, 1.421, 1.238, 1.086, 0.958],
  }),
};
