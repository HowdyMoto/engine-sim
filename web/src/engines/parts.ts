/**
 * Shared engine parts, ported from the script library in
 * `es/part-library/parts/` and the per-video helper files in `assets/engines/`.
 *
 * These are the pieces several engine definitions build from — flow tables,
 * head templates and camshaft layouts — so a definition stays close in shape to
 * the `.mr` file it came from.
 */
import * as units from '../core/units';
import { flowFunction } from '../builder/functions';
import type { Func } from '../core/function';
import type { CylinderBankSpec, CylinderHeadSpec, CamshaftSpec } from '../builder/spec';

const CYCLE = units.angle(2 * 360, units.deg);
const ROT_360 = units.angle(360, units.deg);

/**
 * Wire every cylinder on a bank to its ignition wire.
 *
 * `CylinderBankNode::addCylinder` does this as each cylinder is added; here the
 * cylinders are declared as an array, so the connection is made once the bank
 * is complete. It must run before the ignition module is built.
 */
export function connectWires(bank: CylinderBankSpec): void {
  for (let i = 0; i < bank.cylinders.length; ++i) {
    bank.cylinders[i].ignitionWire.connect(bank, i);
  }
}

// ---- Flow tables ----------------------------------------------------------

/** `generic_small_engine_head`, from `es/part-library/parts/heads.mr`. */
export const SMALL_ENGINE_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 25],
  [100, 75],
  [150, 100],
  [200, 130],
  [250, 180],
  [300, 190],
  [350, 220],
  [400, 240],
  [450, 250],
  [500, 260],
  [550, 260],
  [600, 260],
  [650, 255],
  [700, 250],
];

export const SMALL_ENGINE_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 25],
  [100, 50],
  [150, 75],
  [200, 100],
  [250, 125],
  [300, 160],
  [350, 175],
  [400, 180],
  [450, 190],
  [500, 200],
  [550, 205],
  [600, 210],
  [650, 210],
  [700, 210],
];

/**
 * Four-valve port flow, shared verbatim by the EJ25 and 2JZ head definitions
 * in `assets/engines/atg-video-2/`.
 */
export const MODERN_4V_INTAKE_FLOW: [number, number][] = [
  [0, 0],
  [50, 58],
  [100, 103],
  [150, 156],
  [200, 214],
  [250, 249],
  [300, 268],
  [350, 280],
  [400, 280],
  [450, 281],
];

export const MODERN_4V_EXHAUST_FLOW: [number, number][] = [
  [0, 0],
  [50, 37],
  [100, 72],
  [150, 113],
  [200, 160],
  [250, 196],
  [300, 222],
  [350, 235],
  [400, 245],
  [450, 246],
];

export interface SmallEngineHeadOptions {
  chamberVolume?: number;
  intakeRunnerVolume?: number;
  intakeRunnerCrossSectionArea?: number;
  exhaustRunnerVolume?: number;
  exhaustRunnerCrossSectionArea?: number;
  flowAttenuation?: number;
  liftScale?: number;
  flipDisplay?: boolean;
  intakeCamshaft: CamshaftSpec;
  exhaustCamshaft: CamshaftSpec;
}

export function genericSmallEngineHead(options: SmallEngineHeadOptions): CylinderHeadSpec {
  const flowAttenuation = options.flowAttenuation ?? 1.0;
  const liftScale = options.liftScale ?? 1.0;

  return {
    chamberVolume: options.chamberVolume ?? units.volume(100.0, units.cc),
    intakeRunnerVolume: options.intakeRunnerVolume ?? units.volume(100.0, units.cc),
    intakeRunnerCrossSectionArea:
      options.intakeRunnerCrossSectionArea ?? units.area(30.0, units.cm2),
    exhaustRunnerVolume: options.exhaustRunnerVolume ?? units.volume(100.0, units.cc),
    exhaustRunnerCrossSectionArea:
      options.exhaustRunnerCrossSectionArea ?? units.area(30.0, units.cm2),
    intakePortFlow: flowFunction(SMALL_ENGINE_INTAKE_FLOW, liftScale, flowAttenuation),
    exhaustPortFlow: flowFunction(SMALL_ENGINE_EXHAUST_FLOW, liftScale, flowAttenuation),
    valvetrain: {
      kind: 'standard',
      intakeCamshaft: options.intakeCamshaft,
      exhaustCamshaft: options.exhaustCamshaft,
    },
    flipDisplay: options.flipDisplay ?? false,
  };
}

// ---- Intakes (`es/part-library/parts/intakes.mr`) -------------------------

import { GasSystem } from '../engine/gasSystem';
import type { IntakeSpec } from '../builder/spec';

export function chevyBbcStockIntake(options?: {
  carburetorCfm?: number;
  idleFlowRateCfm?: number;
  idleThrottlePlatePosition?: number;
}): IntakeSpec {
  return {
    plenumVolume: units.volume(2.0, units.L),
    plenumCrossSectionArea: units.area(100.0, units.cm2),
    intakeFlowRate: GasSystem.k_carb(options?.carburetorCfm ?? 650.0),
    idleFlowRate: GasSystem.k_carb(options?.idleFlowRateCfm ?? 1.0),
    idleThrottlePlatePosition: options?.idleThrottlePlatePosition ?? 0.975,
    runnerFlowRate: GasSystem.k_carb(300.0),
    runnerLength: units.distance(6.0, units.inch),
    velocityDecay: 1.0,
  };
}

export function performerRpmIntake(options?: {
  carburetorCfm?: number;
  idleFlowRateCfm?: number;
  idleThrottlePlatePosition?: number;
}): IntakeSpec {
  return {
    plenumVolume: units.volume(2.0, units.L),
    plenumCrossSectionArea: units.area(100.0, units.cm2),
    intakeFlowRate: GasSystem.k_carb(options?.carburetorCfm ?? 650.0),
    idleFlowRate: GasSystem.k_carb(options?.idleFlowRateCfm ?? 1.0),
    idleThrottlePlatePosition: options?.idleThrottlePlatePosition ?? 0.975,
    runnerFlowRate: GasSystem.k_carb(500.0),
    runnerLength: units.distance(6.0, units.inch),
    velocityDecay: 0.1,
  };
}

// ---- Camshaft layouts -----------------------------------------------------

export interface LobeCenters {
  lobeProfile: Func;
  intakeLobeProfile?: Func;
  exhaustLobeProfile?: Func;
  lobeSeparation?: number;
  intakeLobeCenter?: number;
  exhaustLobeCenter?: number;
  advance?: number;
  baseRadius?: number;
}

interface ResolvedLobeCenters {
  intakeProfile: Func;
  exhaustProfile: Func;
  intakeCenter: number;
  exhaustCenter: number;
  advance: number;
  baseRadius: number;
}

function resolveLobes(options: LobeCenters, defaultBaseRadius: number): ResolvedLobeCenters {
  const separation = options.lobeSeparation ?? units.angle(114.0, units.deg);
  return {
    intakeProfile: options.intakeLobeProfile ?? options.lobeProfile,
    exhaustProfile: options.exhaustLobeProfile ?? options.lobeProfile,
    intakeCenter: options.intakeLobeCenter ?? separation,
    exhaustCenter: options.exhaustLobeCenter ?? separation,
    advance: options.advance ?? 0,
    baseRadius: options.baseRadius ?? defaultBaseRadius,
  };
}

/**
 * A pair of camshafts for one bank, with lobe centrelines at
 * `360deg +/- lobeCenter + offset`, which is how every builder in the script
 * library lays them out.
 */
export function bankCamshafts(
  options: LobeCenters,
  crankOffsets: number[],
  defaultBaseRadius = units.distance(0.75, units.inch),
): { intakeCamshaft: CamshaftSpec; exhaustCamshaft: CamshaftSpec } {
  const lobes = resolveLobes(options, defaultBaseRadius);

  return {
    intakeCamshaft: {
      lobeProfile: lobes.intakeProfile,
      advance: lobes.advance,
      baseRadius: lobes.baseRadius,
      lobes: crankOffsets.map((offset) => ROT_360 + lobes.intakeCenter + offset),
    },
    exhaustCamshaft: {
      lobeProfile: lobes.exhaustProfile,
      advance: lobes.advance,
      baseRadius: lobes.baseRadius,
      lobes: crankOffsets.map((offset) => ROT_360 - lobes.exhaustCenter + offset),
    },
  };
}

/**
 * `radial_head` from `assets/engines/atg-video-2/radial.mr`: one cylinder per
 * bank, fired `offset` of the way through the cycle.
 */
export function radialHead(options: {
  offset: number;
  lobeProfile: Func;
  chamberVolume?: number;
  lobeSeparation?: number;
  baseRadius?: number;
}): CylinderHeadSpec {
  const cams = bankCamshafts(
    {
      lobeProfile: options.lobeProfile,
      lobeSeparation: options.lobeSeparation ?? units.angle(114, units.deg),
      baseRadius: options.baseRadius ?? units.distance(1.0, units.inch),
    },
    [options.offset * CYCLE],
  );

  return genericSmallEngineHead({
    chamberVolume: options.chamberVolume ?? units.volume(290, units.cc),
    flowAttenuation: 2.0,
    intakeRunnerCrossSectionArea: units.area(20.0, units.cm2),
    exhaustRunnerCrossSectionArea: units.area(20.0, units.cm2),
    intakeCamshaft: cams.intakeCamshaft,
    exhaustCamshaft: cams.exhaustCamshaft,
  });
}
