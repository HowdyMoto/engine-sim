/**
 * User-authored engines from a JSON description.
 *
 * This is the web equivalent of editing `main.mr` in the original: a compact
 * declarative format covering the parameters people actually build engines
 * around (layout, geometry, crank phasing via the firing order, cams, flow,
 * exhaust character), compiled into a full `EngineSpec`.
 *
 * Crank phasing is derived, not requested: a cylinder at position `k` of the
 * firing order fires at `k * 720/N` degrees, which fixes its journal angle
 * (`fire mod 360`) - the same rule every ported roster engine follows. For V
 * engines the two cylinders of a pair share a journal, so the second one's
 * fire angle is dictated by geometry (`+bank angle`, whichever crank
 * revolution lands closest to the requested slot); ask for a firing order the
 * bank angle cannot produce and the engine runs exactly as odd-fire as the
 * crank you specified.
 */
import * as units from '../core/units';
import { diskMomentOfInertia, rodMomentOfInertia } from '../core/utilities';
import { GasSystem } from '../engine/gasSystem';
import { flowFunction, harmonicCamLobe, timingCurve } from './functions';
import { IgnitionWire, RodJournal, defaultVehicle } from './spec';
import {
  MODERN_4V_INTAKE_FLOW,
  MODERN_4V_EXHAUST_FLOW,
  SMALL_ENGINE_INTAKE_FLOW,
  SMALL_ENGINE_EXHAUST_FLOW,
  connectWires,
} from '../engines/parts';
import type {
  CylinderBankSpec,
  CylinderSpec,
  EngineDefinition,
  EngineSpec,
  ExhaustSpec,
} from './spec';

const { k_carb, k_28inH2O } = GasSystem;

export interface CustomEngineJson {
  name?: string;
  /** "inline", "v" or "flat". */
  layout?: string;
  cylinders?: number;
  /** Bank angle for "v" layouts, degrees. */
  vAngleDeg?: number;

  boreMm?: number;
  strokeMm?: number;
  rodLengthMm?: number;
  compressionHeightMm?: number;
  chamberVolumeCc?: number;
  compressionRatio?: number;

  /** Permutation of 1..cylinders. */
  firingOrder?: number[];

  redlineRpm?: number;
  revLimitRpm?: number;
  /** [rpm, degrees BTDC] samples. */
  timingCurve?: [number, number][];

  cam?: {
    durationDeg?: number;
    liftMm?: number;
    lobeSeparationDeg?: number;
    gamma?: number;
  };

  intake?: {
    flowCfm?: number;
    runnerFlowCfm?: number;
    plenumVolumeL?: number;
    idleFlowCfm?: number;
    idleThrottlePlate?: number;
  };

  exhaust?: {
    outletFlowCfm?: number;
    primaryFlowCfm?: number;
    primaryLengthMm?: number;
    systemLengthMm?: number;
    audioVolume?: number;
    impulseResponse?: string;
  };

  /** "modern4v", "smallEngine", or explicit [liftThou, cfm] tables. */
  ports?: string | { intake: [number, number][]; exhaust: [number, number][] };

  masses?: {
    pistonG?: number;
    rodG?: number;
    crankKg?: number;
    flywheelKg?: number;
    flywheelRadiusMm?: number;
  };

  starter?: { torqueNm?: number; speedRpm?: number };
  simulationFrequencyHz?: number;

  vehicle?: { massKg?: number; diffRatio?: number; tireRadiusMm?: number };
  transmission?: { gears?: number[]; maxClutchTorqueNm?: number };
}

export class CustomEngineError extends Error {}

function fail(message: string): never {
  throw new CustomEngineError(message);
}

function check(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

/** Starter JSON offered by the editor. */
export function customEngineTemplate(): CustomEngineJson {
  return {
    name: 'My Inline Four',
    layout: 'inline',
    cylinders: 4,
    boreMm: 86,
    strokeMm: 86,
    rodLengthMm: 150,
    firingOrder: [1, 3, 4, 2],
    redlineRpm: 7200,
    compressionRatio: 10.5,
    timingCurve: [
      [0, 10],
      [1000, 12],
      [3000, 26],
      [6000, 36],
      [8000, 36],
    ],
    cam: { durationDeg: 215, liftMm: 10.5, lobeSeparationDeg: 112 },
    intake: { flowCfm: 400 },
    exhaust: { outletFlowCfm: 450, systemLengthMm: 1800, audioVolume: 1.0 },
    transmission: { gears: [3.16, 1.9, 1.31, 1.0, 0.79] },
  };
}

export function compileCustomEngine(json: CustomEngineJson): EngineDefinition {
  check(typeof json === 'object' && json !== null, 'the engine description must be a JSON object');

  const cylinders = json.cylinders ?? 4;
  check(
    Number.isInteger(cylinders) && cylinders >= 1 && cylinders <= 16,
    `"cylinders" must be a whole number from 1 to 16 (got ${json.cylinders})`,
  );

  const layout = json.layout ?? (cylinders >= 8 ? 'v' : 'inline');
  check(
    layout === 'inline' || layout === 'v' || layout === 'flat',
    `"layout" must be "inline", "v" or "flat" (got "${json.layout}")`,
  );
  if (layout !== 'inline') {
    check(cylinders % 2 === 0, `a "${layout}" layout needs an even cylinder count`);
  }

  const vAngle =
    layout === 'v'
      ? units.angle(json.vAngleDeg ?? 90, units.deg)
      : layout === 'flat'
        ? units.angle(180, units.deg)
        : 0;
  if (layout === 'v') {
    check(
      (json.vAngleDeg ?? 90) > 0 && (json.vAngleDeg ?? 90) < 180,
      `"vAngleDeg" must be between 0 and 180 exclusive (got ${json.vAngleDeg})`,
    );
  }

  // Geometry.
  const bore = units.distance(json.boreMm ?? 86, units.mm);
  const stroke = units.distance(json.strokeMm ?? 86, units.mm);
  const rodLength = units.distance(json.rodLengthMm ?? (json.strokeMm ?? 86) * 1.7, units.mm);
  const compressionHeight = units.distance(json.compressionHeightMm ?? 28, units.mm);
  check(bore > 0 && stroke > 0 && rodLength > stroke / 2, 'bore, stroke and rod length must be positive, with the rod longer than the crank throw');

  const cylinderVolume = ((Math.PI * bore * bore) / 4) * stroke;
  let chamberVolume: number;
  if (json.chamberVolumeCc !== undefined) {
    chamberVolume = units.volume(json.chamberVolumeCc, units.cc);
  } else {
    const ratio = json.compressionRatio ?? 10.0;
    check(ratio > 1, `"compressionRatio" must exceed 1 (got ${ratio})`);
    chamberVolume = cylinderVolume / (ratio - 1);
  }

  // Firing order -> fire angles -> journals.
  const firingOrder = json.firingOrder ?? Array.from({ length: cylinders }, (_, i) => i + 1);
  check(
    Array.isArray(firingOrder) &&
      firingOrder.length === cylinders &&
      [...firingOrder].sort((a, b) => a - b).every((v, i) => v === i + 1),
    `"firingOrder" must be a permutation of 1..${cylinders} (got ${JSON.stringify(json.firingOrder)})`,
  );

  const CYCLE = units.angle(720, units.deg);
  const TURN = units.angle(360, units.deg);
  const step = CYCLE / cylinders;

  const position = new Array<number>(cylinders);
  firingOrder.forEach((cylinder, k) => {
    position[cylinder - 1] = k;
  });

  // Fire angle per cylinder (radians into the 720 cycle) and journal per
  // cylinder. Inline and flat cranks give every cylinder its own journal;
  // V pairs (1,2), (3,4), ... share one.
  const fireAngle = new Array<number>(cylinders);
  const journalOf = new Array<RodJournal>(cylinders);

  // A cylinder on journal J and a bank offset D from bank 0 reaches TDC when
  // the cycle angle is J - D (mod 360) - so its journal is fire + D. This is
  // the relation every roster crank satisfies (the LS crossplane, the EJ25
  // boxer, the inline fives and sixes).
  if (layout === 'v') {
    for (let pair = 0; pair < cylinders / 2; ++pair) {
      const first = 2 * pair; // bank 0
      const second = 2 * pair + 1; // bank 1
      const firstFire = position[first] * step;
      const journal = new RodJournal(firstFire % TURN);

      // The partner shares the journal, so geometry fixes its TDC at
      // J - vAngle on either crank revolution; take whichever lands closest
      // to its requested firing slot.
      const requested = position[second] * step;
      const base = (((firstFire - vAngle) % TURN) + TURN) % TURN;
      const candidates = [base, base + TURN];
      const distance = (a: number, b: number) => {
        const d = Math.abs(a - b) % CYCLE;
        return Math.min(d, CYCLE - d);
      };
      const chosen = candidates.reduce((best, c) =>
        distance(c, requested) < distance(best, requested) ? c : best,
      );

      fireAngle[first] = firstFire;
      fireAngle[second] = chosen;
      journalOf[first] = journal;
      journalOf[second] = journal;
    }
  } else {
    for (let i = 0; i < cylinders; ++i) {
      fireAngle[i] = position[i] * step;
      const bankOffset = layout === 'flat' && i % 2 === 1 ? TURN / 2 : 0;
      journalOf[i] = new RodJournal((fireAngle[i] + bankOffset) % TURN);
    }
  }

  const journals = [...new Set(journalOf)];

  // Bank assignment: inline all on one bank; v/flat odd cylinders bank 0.
  const bankCount = layout === 'inline' ? 1 : 2;
  const bankAngle = (bank: number): number =>
    layout === 'inline' ? 0 : (bank === 0 ? -1 : 1) * (vAngle / 2);
  const bankOf = (cylinder: number): number => (layout === 'inline' ? 0 : cylinder % 2);

  // Masses and inertia, scaled with displacement where not given.
  const masses = json.masses ?? {};
  const pistonMass = units.mass(masses.pistonG ?? 350 + (bore / units.mm) * 1.5, units.g);
  const rodMass = units.mass(masses.rodG ?? 550, units.g);
  const crankMass = units.mass(masses.crankKg ?? 4 + cylinders * 2.5, units.kg);
  const flywheelMass = units.mass(masses.flywheelKg ?? 6 + cylinders, units.kg);
  const flywheelRadius = units.distance(masses.flywheelRadiusMm ?? 150, units.mm);

  const crankMoment = 1.5 * diskMomentOfInertia(crankMass, stroke);
  const flywheelMoment = diskMomentOfInertia(flywheelMass, flywheelRadius);
  const otherMoment = diskMomentOfInertia(units.mass(1, units.kg), units.distance(1, units.cm));

  // Cams.
  const cam = json.cam ?? {};
  const camDuration = units.angle(cam.durationDeg ?? 210, units.deg);
  const camLift = units.distance(cam.liftMm ?? 10, units.mm);
  const lobeSeparation = units.angle(cam.lobeSeparationDeg ?? 114, units.deg);
  const lobe = (duration: number) =>
    harmonicCamLobe({
      durationAt50Thou: duration,
      gamma: cam.gamma ?? 1.0,
      lift: camLift,
      steps: 256,
    });
  const intakeLobe = lobe(camDuration);
  const exhaustLobe = lobe(camDuration + units.angle(1, units.deg));

  // Ports.
  let intakeTable = MODERN_4V_INTAKE_FLOW;
  let exhaustTable = MODERN_4V_EXHAUST_FLOW;
  if (json.ports === 'smallEngine') {
    intakeTable = SMALL_ENGINE_INTAKE_FLOW;
    exhaustTable = SMALL_ENGINE_EXHAUST_FLOW;
  } else if (typeof json.ports === 'object' && json.ports !== null) {
    check(
      Array.isArray(json.ports.intake) && Array.isArray(json.ports.exhaust),
      '"ports" tables need "intake" and "exhaust" arrays of [liftThou, cfm] pairs',
    );
    intakeTable = json.ports.intake;
    exhaustTable = json.ports.exhaust;
  } else if (json.ports !== undefined && json.ports !== 'modern4v') {
    fail(`"ports" must be "modern4v", "smallEngine" or a table object (got "${json.ports}")`);
  }

  // Intake.
  const intakeJson = json.intake ?? {};
  const intake = {
    plenumVolume: units.volume(intakeJson.plenumVolumeL ?? 1.0, units.L),
    plenumCrossSectionArea: units.area(20, units.cm2),
    intakeFlowRate: k_carb(intakeJson.flowCfm ?? 100 * cylinders),
    runnerFlowRate: k_carb(intakeJson.runnerFlowCfm ?? (intakeJson.flowCfm ?? 100 * cylinders) / 3),
    runnerLength: units.distance(10, units.inch),
    idleFlowRate: k_carb(intakeJson.idleFlowCfm ?? 0.0),
    idleThrottlePlatePosition: intakeJson.idleThrottlePlate ?? 0.99,
  };

  // Exhaust.
  const exhaustJson = json.exhaust ?? {};
  const exhaust: ExhaustSpec = {
    length: units.distance(exhaustJson.systemLengthMm ?? 1800, units.mm),
    outletFlowRate: k_carb(exhaustJson.outletFlowCfm ?? 120 * cylinders),
    primaryTubeLength: units.distance(exhaustJson.primaryLengthMm ?? 500, units.mm),
    primaryFlowRate: k_carb(exhaustJson.primaryFlowCfm ?? 60 * cylinders),
    velocityDecay: 1.0,
    audioVolume: exhaustJson.audioVolume ?? 1.0,
    impulseResponse: exhaustJson.impulseResponse ?? 'default_0',
    impulseResponseVolume: 0.001,
  };

  const redline = units.rpm(json.redlineRpm ?? 7000);
  const revLimit = units.rpm(json.revLimitRpm ?? (json.redlineRpm ?? 7000) + 200);

  const curve = json.timingCurve ?? [
    [0, 10],
    [1000, 12],
    [3000, 26],
    [6000, 34],
    [9000, 34],
  ];
  check(
    Array.isArray(curve) && curve.every((p) => Array.isArray(p) && p.length === 2),
    '"timingCurve" must be an array of [rpm, degreesBTDC] pairs',
  );

  const wires = Array.from({ length: cylinders }, () => new IgnitionWire());
  const deckHeight = stroke / 2 + rodLength + compressionHeight;

  const makeCylinder = (index: number): CylinderSpec => ({
    piston: {
      mass: pistonMass,
      compressionHeight,
      wristPinPosition: 0,
      displacement: 0,
      blowby: k_28inH2O(0.1),
    },
    connectingRod: {
      mass: rodMass,
      momentOfInertia: rodMomentOfInertia(rodMass, rodLength),
      centerOfMass: 0,
      length: rodLength,
    },
    rodJournal: journalOf[index],
    intake,
    exhaustSystem: exhaust,
    ignitionWire: wires[index],
    soundAttenuation: 0.8 + 0.4 * ((index * 7919) % 100) / 100,
    primaryLength: units.distance(200 + 60 * Math.floor(index / bankCount), units.mm),
  });

  const banks: CylinderBankSpec[] = [];
  for (let b = 0; b < bankCount; ++b) {
    const bankCylinders: number[] = [];
    for (let i = 0; i < cylinders; ++i) {
      if (bankOf(i) === b) bankCylinders.push(i);
    }

    const camshaft = (profile: typeof intakeLobe, sign: 1 | -1) => ({
      lobeProfile: profile,
      baseRadius: units.distance(20, units.mm),
      lobes: bankCylinders.map((i) => CYCLE / 2 + sign * lobeSeparation + fireAngle[i]),
    });

    const bank: CylinderBankSpec = {
      angle: bankAngle(b),
      bore,
      deckHeight,
      cylinders: bankCylinders.map(makeCylinder),
      head: {
        chamberVolume,
        intakeRunnerVolume: units.volume(120, units.cc),
        intakeRunnerCrossSectionArea: units.area(11, units.cm2),
        exhaustRunnerVolume: units.volume(50, units.cc),
        exhaustRunnerCrossSectionArea: units.area(8, units.cm2),
        intakePortFlow: flowFunction(intakeTable),
        exhaustPortFlow: flowFunction(exhaustTable),
        valvetrain: {
          kind: 'standard',
          intakeCamshaft: camshaft(intakeLobe, 1),
          exhaustCamshaft: camshaft(exhaustLobe, -1),
        },
        flipDisplay: b === 1,
      },
    };
    connectWires(bank);
    banks.push(bank);
  }

  const displacementL = (cylinderVolume * cylinders) / units.volume(1, units.L);
  const starterJson = json.starter ?? {};

  const spec: EngineSpec = {
    name: json.name ?? 'Custom Engine',
    starterTorque: starterJson.torqueNm !== undefined
      ? units.torque(starterJson.torqueNm, units.Nm)
      : units.torque(Math.max(70, displacementL * 35), units.Nm),
    starterSpeed: units.rpm(starterJson.speedRpm ?? 350),
    redline,
    throttle: { kind: 'direct', gamma: 2.0 },
    fuel: {},
    hfGain: 0.01,
    noise: 1.0,
    jitter: 0.6,
    simulationFrequency:
      json.simulationFrequencyHz ?? Math.round(Math.min(40000, Math.max(5000, 80000 / cylinders))),
    crankshafts: [
      {
        throw: stroke / 2,
        flywheelMass,
        mass: crankMass,
        frictionTorque: units.torque(Math.max(8, displacementL * 3.2), units.Nm),
        momentOfInertia: crankMoment + flywheelMoment + otherMoment,
        positionX: 0,
        positionY: 0,
        tdc: units.angle(90, units.deg) + bankAngle(0),
        rodJournals: journals,
      },
    ],
    banks,
    ignitionModule: {
      timingCurve: timingCurve(curve),
      revLimit,
      limiterDuration: 0.1,
      posts: wires.map((wire, i) => ({ wire, angle: fireAngle[i] })),
    },
  };

  const vehicleJson = json.vehicle ?? {};
  const transmissionJson = json.transmission ?? {};

  return {
    id: 'custom',
    label: spec.name,
    description: `${displacementL.toFixed(1)} L custom ${layout} ${cylinders}-cylinder`,
    engine: () => spec,
    vehicle: () => ({
      ...defaultVehicle(),
      mass: units.mass(vehicleJson.massKg ?? 1300, units.kg),
      diffRatio: vehicleJson.diffRatio ?? 3.5,
      tireRadius: units.distance(vehicleJson.tireRadiusMm ?? 280, units.mm),
    }),
    transmission: () => ({
      maxClutchTorque: units.torque(transmissionJson.maxClutchTorqueNm ?? 500, units.Nm),
      gearRatios: transmissionJson.gears ?? [3.2, 2.0, 1.4, 1.0, 0.8],
    }),
  };
}
