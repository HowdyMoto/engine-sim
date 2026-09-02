/**
 * Kohler CH750, a governed 90-degree V-twin, ported from
 * `assets/engines/atg-video-1/02_kohler_ch750.mr` together with the
 * `generic_small_engine_head`, `vtwin90_camshaft_builder` and
 * `vtwin90_distributor` parts it pulls from the part library.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { GasSystem, circleArea } from '../engine/gasSystem';
import { harmonicCamLobe, timingCurve } from '../builder/functions';
import { IgnitionWire, RodJournal } from '../builder/spec';
import { bankCamshafts, connectWires, genericSmallEngineHead } from './parts';
import type {
  CylinderBankSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from '../builder/spec';

const { k_carb, k_28inH2O } = GasSystem;

const CYCLE = units.angle(2 * 360, units.deg);

export function kohlerCh750Spec(): EngineSpec {
  const wires = [new IgnitionWire(), new IgnitionWire()];

  const stroke = units.distance(69, units.mm);
  const rodLength = units.distance(4.0, units.inch);
  const compressionHeight = units.distance(1.0, units.inch);

  const rj0 = new RodJournal(0.0);

  const piston = {
    mass: units.mass(400, units.g),
    compressionHeight,
    wristPinPosition: 0.0,
    displacement: 0.0,
    blowby: k_28inH2O(0.1),
  };

  const makeRod = () => ({
    mass: units.mass(300.0, units.g),
    momentOfInertia: 0.0015884918028487504,
    centerOfMass: 0.0,
    length: rodLength,
  });

  const intake = {
    plenumVolume: units.volume(1.0, units.L),
    plenumCrossSectionArea: units.area(10.0, units.cm2),
    intakeFlowRate: k_carb(50.0),
    runnerFlowRate: k_carb(100.0),
    idleFlowRate: k_carb(0.0),
    idleThrottlePlatePosition: 0.96,
  };

  // `es_params` gives a volume rather than a length; the script derives one
  // from the default collector cross-section.
  const collectorCrossSectionArea = circleArea(units.distance(2.0, units.inch));
  const exhaust0: ExhaustSpec = {
    outletFlowRate: k_carb(300.0),
    primaryTubeLength: units.distance(10.0, units.inch),
    primaryFlowRate: k_carb(200.0),
    velocityDecay: 1.0,
    collectorCrossSectionArea,
    length: units.volume(20.0, units.L) / collectorCrossSectionArea,
    audioVolume: 1.0,
    impulseResponse: 'default_0',
    impulseResponseVolume: 0.001,
  };

  const lobe = harmonicCamLobe({
    durationAt50Thou: units.angle(160, units.deg),
    gamma: 1.1,
    lift: units.distance(200, units.thou),
    steps: 100,
  });

  const lobeSeparation = units.angle(114, units.deg);
  const baseRadius = units.distance(500, units.thou);
  // The two cylinders are 3 * 90 crank degrees apart on the cam.
  const bankOffset = units.angle(90 * 3, units.deg);

  const head = (offset: number, flipDisplay: boolean) =>
    genericSmallEngineHead({
      chamberVolume: units.volume(50, units.cc),
      flipDisplay,
      ...bankCamshafts({ lobeProfile: lobe, lobeSeparation, baseRadius }, [offset]),
    });

  const bankParams = {
    bore: units.distance(83, units.mm),
    deckHeight: units.distance(4.0 + 1, units.inch) + stroke / 2,
  };

  const bank0: CylinderBankSpec = {
    ...bankParams,
    angle: units.angle(-45, units.deg),
    cylinders: [
      {
        piston,
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaust0,
        ignitionWire: wires[0],
      },
    ],
    head: head(0, false),
  };

  const bank1: CylinderBankSpec = {
    ...bankParams,
    angle: units.angle(45.0, units.deg),
    cylinders: [
      {
        piston,
        connectingRod: makeRod(),
        rodJournal: rj0,
        intake,
        exhaustSystem: exhaust0,
        ignitionWire: wires[1],
      },
    ],
    head: head(bankOffset, true),
  };

  connectWires(bank0);
  connectWires(bank1);

  return {
    name: 'Kohler CH750',
    starterTorque: units.torque(50, units.ft_lb),
    starterSpeed: units.rpm(500),
    redline: units.rpm(3600),
    throttle: {
      kind: 'governor',
      minSpeed: units.rpm(1600),
      maxSpeed: units.rpm(3500),
      minVelocity: -5.0,
      maxVelocity: 5.0,
      k_s: 0.0006,
      k_d: 200.0,
      gamma: 2.0,
    },
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.5,
    simulationFrequency: 30000,
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass: units.mass(5, units.lb),
        mass: units.mass(5, units.lb),
        frictionTorque: units.torque(10.0, units.ft_lb),
        momentOfInertia: 0.22986844776863666 * 0.5,
        positionX: 0.0,
        positionY: 0.0,
        tdc: PI / 4,
        rodJournals: [rj0],
      },
    ],
    banks: [bank0, bank1],
    ignitionModule: {
      timingCurve: timingCurve([
        [0, 18],
        [1000, 30],
        [2000, 50],
        [3000, 50],
        [4000, 50],
      ]),
      revLimit: units.rpm(5000),
      posts: [
        { wire: wires[0], angle: (0.0 / 8.0) * CYCLE },
        { wire: wires[1], angle: (3.0 / 8.0) * CYCLE },
      ],
    },
  };
}

export const kohlerCh750: EngineDefinition = {
  id: 'kohler-ch750',
  label: 'Kohler CH750',
  description: '747 cc 90-degree V-twin with a mechanical governor',
  engine: kohlerCh750Spec,
  vehicle: () => ({
    mass: units.mass(500, units.lb),
    dragCoefficient: 0.9,
    crossSectionArea: units.distance(40, units.inch) * units.distance(40, units.inch),
    diffRatio: 4.0,
    tireRadius: units.distance(10, units.inch),
    rollingResistance: units.force(200, units.N),
  }),
  transmission: () => ({
    maxClutchTorque: units.torque(35, units.ft_lb),
    gearRatios: [1.0],
  }),
};
