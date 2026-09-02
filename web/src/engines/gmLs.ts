/**
 * GM LS V8, ported from `assets/engines/atg-video-2/07_gm_ls.mr`.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, makeFunction, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { connectWires } from './parts';
import type {
  CylinderBankSpec,
  CylinderSpec,
  EngineDefinition,
  EngineSpec,
  IgnitionModuleSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

function turbulenceToFlameSpeedRatio() {
  return makeFunction(5.0, [
    [0.0, 3.0],
    [5.0, 1.5 * 5.0],
    [10.0, 1.75 * 10.0],
    [15.0, 2.0 * 15.0],
    [20.0, 2.0 * 20.0],
    [25.0, 2.0 * 25.0],
    [30.0, 2.0 * 30.0],
    [35.0, 2.0 * 35.0],
    [40.0, 2.0 * 40.0],
    [45.0, 2.0 * 45.0],
  ]);
}

const INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 1],
  [100, 103],
  [150, 156],
  [200, 214],
  [250, 249],
  [300, 268],
  [350, 280],
  [400, 280],
  [450, 281],
];

const EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 1],
  [100, 72],
  [150, 113],
  [200, 160],
  [250, 196],
  [300, 222],
  [350, 235],
  [400, 245],
  [450, 246],
];

export function gmLsSpec(): EngineSpec {
  const stroke = units.distance(3.622, units.inch);
  const bore = units.distance(3.78, units.inch);
  const rodLength = units.distance(160, units.mm);
  const rodMass = units.mass(50, units.g);
  const compressionHeight = units.distance(1.0, units.inch);
  const crankMass = units.mass(60, units.lb);
  const flywheelMass = units.mass(30, units.lb);
  const flywheelRadius = units.distance(8, units.inch);

  const crankMoment = 1.5 * diskMomentOfInertia(crankMass, stroke);
  const flywheelMoment = diskMomentOfInertia(flywheelMass, flywheelRadius);
  // Cams, pulleys and accessories, estimated as in the original script.
  const otherMoment = diskMomentOfInertia(units.mass(1, units.kg), units.distance(1.0, units.cm));

  const vAngle = units.angle(90, units.deg);

  const wires = Array.from({ length: 8 }, () => new IgnitionWire());

  // Firing order 1-8-7-2-6-5-4-3.
  const rj0 = new RodJournal(units.angle(0, units.deg));
  const rj1 = new RodJournal(units.angle(270, units.deg));
  const rj2 = new RodJournal(units.angle(90, units.deg));
  const rj3 = new RodJournal(units.angle(180, units.deg));

  const piston = {
    mass: units.mass(100, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.0),
  };

  const makeRod = () => ({
    mass: rodMass,
    momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.325, units.L),
    plenumCrossSectionArea: units.area(20.0, units.cm2),
    intakeFlowRate: k_carb(700.0),
    runnerFlowRate: k_carb(100.0),
    runnerLength: units.distance(12.0, units.inch),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.996,
    velocityDecay: 0.5,
  };

  const exhaustCommon = {
    outletFlowRate: k_carb(1000.0),
    primaryTubeLength: units.distance(29.0, units.inch),
    primaryFlowRate: k_carb(500.0),
    velocityDecay: 1.0,
    audioVolume: 4.0,
    impulseResponse: 'default_0',
    impulseResponseVolume: 0.001,
  };

  const exhaust0 = { ...exhaustCommon, length: units.distance(100, units.inch) };
  const exhaust1 = { ...exhaustCommon, length: units.distance(172, units.inch) };

  const spacing = units.distance(2, units.inch);
  const cm = (n: number) => units.distance(n, units.cm);

  const cylinder = (
    rodJournal: RodJournal,
    wire: IgnitionWire,
    exhaustSystem: typeof exhaust0,
    primaryLength: number,
  ): CylinderSpec => ({
    piston,
    connectingRod: makeRod(),
    rodJournal,
    intake,
    exhaustSystem,
    ignitionWire: wire,
    soundAttenuation: 1.0,
    primaryLength,
  });

  const intakeLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(234, units.deg),
    gamma: 1.1,
    lift: units.distance(551, units.thou),
    steps: 256,
  });

  const exhaustLobe = harmonicCamLobe({
    durationAt50Thou: units.angle(235, units.deg),
    gamma: 1.1,
    lift: units.distance(551, units.thou),
    steps: 256,
  });

  const lobeSeparation = units.angle(116, units.deg);
  const baseRadius = units.distance(1.0, units.inch);
  const rot = units.angle(90, units.deg);
  const rot360 = units.angle(360, units.deg);

  // Bank 0 carries cylinders 1, 3, 5, 7; bank 1 carries 2, 4, 6, 8.
  const bank0Offsets = [0, 7, 5, 2];
  const bank1Offsets = [3, 6, 4, 1];

  const camshaft = (offsets: number[], lobe: typeof intakeLobe, sign: 1 | -1) => ({
    lobeProfile: lobe,
    baseRadius,
    lobes: offsets.map((o) => rot360 + sign * lobeSeparation + o * rot),
  });

  const head = (offsets: number[], flipDisplay: boolean) => ({
    chamberVolume: units.volume(90, units.cc),
    intakeRunnerVolume: units.volume(149.6, units.cc),
    intakeRunnerCrossSectionArea:
      units.distance(2.2, units.inch) * units.distance(2.2, units.inch),
    exhaustRunnerVolume: units.volume(50.0, units.cc),
    exhaustRunnerCrossSectionArea:
      units.distance(1.75, units.inch) * units.distance(1.75, units.inch),
    intakePortFlow: flowFunction(INTAKE_FLOW),
    exhaustPortFlow: flowFunction(EXHAUST_FLOW),
    valvetrain: {
      kind: 'standard' as const,
      intakeCamshaft: camshaft(offsets, intakeLobe, 1),
      exhaustCamshaft: camshaft(offsets, exhaustLobe, -1),
    },
    flipDisplay,
  });

  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const bank0: CylinderBankSpec = {
    angle: -vAngle / 2.0,
    bore,
    deckHeight,
    cylinders: [
      cylinder(rj0, wires[0], exhaust0, 3 * spacing + cm(2)),
      cylinder(rj1, wires[2], exhaust0, 2 * spacing + cm(1)),
      cylinder(rj2, wires[4], exhaust0, 1 * spacing + cm(3)),
      cylinder(rj3, wires[6], exhaust0, 0 * spacing + cm(5)),
    ],
    head: head(bank0Offsets, false),
  };

  const bank1: CylinderBankSpec = {
    angle: vAngle / 2.0,
    bore,
    deckHeight,
    cylinders: [
      cylinder(rj0, wires[1], exhaust1, 3 * spacing + cm(1)),
      cylinder(rj1, wires[3], exhaust1, 2 * spacing + cm(5)),
      cylinder(rj2, wires[5], exhaust1, 1 * spacing + cm(7)),
      cylinder(rj3, wires[7], exhaust1, 0 * spacing + cm(0)),
    ],
    head: head(bank1Offsets, true),
  };

  // Wires must know which cylinder they drive before the ignition module runs.
  connectWires(bank0);
  connectWires(bank1);

  const ignitionModule: IgnitionModuleSpec = {
    timingCurve: timingCurve([
      [0, 12],
      [1000, 12],
      [2000, 20],
      [3000, 30],
      [4000, 40],
      [5000, 40],
      [6000, 40],
      [7000, 40],
      [8000, 40],
    ]),
    revLimit: units.rpm(6800),
    limiterDuration: 0.2,
    posts: [
      { wire: wires[0], angle: 0 * rot },
      { wire: wires[7], angle: 1 * rot },
      { wire: wires[6], angle: 2 * rot },
      { wire: wires[1], angle: 3 * rot },
      { wire: wires[5], angle: 4 * rot },
      { wire: wires[4], angle: 5 * rot },
      { wire: wires[3], angle: 6 * rot },
      { wire: wires[2], angle: 7 * rot },
    ],
  };

  return {
    name: 'GM LS',
    starterTorque: units.torque(200, units.ft_lb),
    starterSpeed: units.rpm(200),
    redline: units.rpm(6500),
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {
      maxBurningEfficiency: 1.0,
      turbulenceToFlameSpeedRatio: turbulenceToFlameSpeedRatio(),
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.6,
    simulationFrequency: 10000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(20.0, units.ft_lb),
        momentOfInertia: crankMoment + flywheelMoment + otherMoment,
        positionX: 0.0,
        positionY: 0.0,
        tdc: units.angle(90, units.deg) - vAngle / 2.0,
        rodJournals: [rj0, rj1, rj2, rj3],
      },
    ],
    banks: [bank0, bank1],
    ignitionModule,
  };
}

export const gmLs: EngineDefinition = {
  id: 'gm-ls',
  label: 'GM LS V8',
  description: '5.7 L 90-degree pushrod V8, cross-plane crank, dual exhaust',
  engine: gmLsSpec,
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
    gearRatios: [2.97, 2.07, 1.43, 1.0, 0.71, 0.57],
  }),
};
