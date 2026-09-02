/**
 * Assembles a runtime `Engine` from an `EngineSpec`.
 *
 * This is the TypeScript equivalent of `EngineNode::buildEngine` in
 * `scripting/include/engine_node.h`, including its ordering constraints:
 * crankshafts are generated before banks so rod journals have indices, slave
 * journals are indexed before rods are created, and master rods are linked
 * only after every rod exists.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { Func } from '../core/function';
import { Engine } from '../engine/engine';
import { CombustionChamber } from '../engine/combustionChamber';
import { Camshaft } from '../engine/camshaft';
import { StandardValvetrain, VtecValvetrain, type Valvetrain } from '../engine/valvetrain';
import { DirectThrottleLinkage, Governor, type Throttle } from '../engine/throttle';
import { resolveDynoRange, resolveFuelParameters } from './defaults';
import type {
  CamshaftSpec,
  ConnectingRodSpec,
  CylinderBankSpec,
  EngineSpec,
  ExhaustSpec,
  IntakeSpec,
  RodJournal,
  ValvetrainSpec,
} from './spec';
import type { Crankshaft } from '../engine/crankshaft';

export function buildEngine(spec: EngineSpec): Engine {
  const engine = new Engine();

  let cylinderCount = 0;
  for (const bank of spec.banks) cylinderCount += bank.cylinders.length;

  // Unique intakes and exhaust systems, in first-use order.
  const exhaustSpecs: ExhaustSpec[] = [];
  const intakeSpecs: IntakeSpec[] = [];
  for (const bank of spec.banks) {
    for (const cylinder of bank.cylinders) {
      if (!exhaustSpecs.includes(cylinder.exhaustSystem)) exhaustSpecs.push(cylinder.exhaustSystem);
      if (!intakeSpecs.includes(cylinder.intake)) intakeSpecs.push(cylinder.intake);
    }
  }

  const redline = spec.redline ?? units.rpm(6500);
  const dyno = resolveDynoRange(redline, spec);

  engine.initialize({
    name: spec.name,
    crankshaftCount: spec.crankshafts.length,
    cylinderBanks: spec.banks.length,
    cylinderCount,
    exhaustSystemCount: exhaustSpecs.length,
    intakeCount: intakeSpecs.length,
    throttle: makeThrottle(spec),
    starterTorque: spec.starterTorque,
    starterSpeed: spec.starterSpeed,
    redline,
    dynoMinSpeed: dyno.dynoMinSpeed,
    dynoMaxSpeed: dyno.dynoMaxSpeed,
    dynoHoldStep: dyno.dynoHoldStep,
    initialSimulationFrequency: spec.simulationFrequency,
    initialHighFrequencyGain: spec.hfGain,
    initialNoise: spec.noise,
    initialJitter: spec.jitter,
  });

  for (let i = 0; i < exhaustSpecs.length; ++i) {
    const s = exhaustSpecs[i];
    engine.getExhaustSystem(i).initialize({
      length: s.length,
      collectorCrossSectionArea: s.collectorCrossSectionArea,
      outletFlowRate: s.outletFlowRate,
      primaryTubeLength: s.primaryTubeLength,
      primaryFlowRate: s.primaryFlowRate,
      velocityDecay: s.velocityDecay,
      audioVolume: s.audioVolume,
      impulseResponse: s.impulseResponse,
      impulseResponseVolume: s.impulseResponseVolume,
    });
  }

  for (let i = 0; i < intakeSpecs.length; ++i) {
    const s = intakeSpecs[i];
    engine.getIntake(i).initialize({
      volume: s.plenumVolume,
      crossSectionArea: s.plenumCrossSectionArea,
      inputFlowK: s.intakeFlowRate,
      idleFlowK: s.idleFlowRate,
      runnerFlowRate: s.runnerFlowRate,
      molecularAfr: s.molecularAfr,
      idleThrottlePlatePosition: s.idleThrottlePlatePosition,
      runnerLength: s.runnerLength,
      velocityDecay: s.velocityDecay,
    });
  }

  // --- Crankshafts: assign journal indices ---------------------------------
  const rodJournalIndex = new Map<RodJournal, number>();
  const crankshaftOf = new Map<RodJournal, Crankshaft>();

  for (let i = 0; i < spec.crankshafts.length; ++i) {
    const cs = spec.crankshafts[i];
    const crankshaft = engine.getCrankshaft(i);

    crankshaft.initialize({
      mass: cs.mass,
      flywheelMass: cs.flywheelMass,
      momentOfInertia: cs.momentOfInertia,
      crankThrow: cs.throw,
      pos_x: cs.positionX,
      pos_y: cs.positionY,
      tdc: cs.tdc,
      frictionTorque: cs.frictionTorque,
      rodJournals: cs.rodJournals.length,
    });

    for (let j = 0; j < cs.rodJournals.length; ++j) {
      const journal = cs.rodJournals[j];
      crankshaft.setRodJournalAngle(j, journal.angle);
      rodJournalIndex.set(journal, j);
      crankshaftOf.set(journal, crankshaft);
    }
  }

  // --- Slave journals carried by master rods -------------------------------
  const masterRodSpecOf = new Map<RodJournal, ConnectingRodSpec>();
  for (const bank of spec.banks) {
    for (const cylinder of bank.cylinders) {
      const journals = cylinder.connectingRod.rodJournals;
      if (journals === undefined) continue;

      for (let i = 0; i < journals.length; ++i) {
        rodJournalIndex.set(journals[i], i);
        masterRodSpecOf.set(journals[i], cylinder.connectingRod);
      }
    }
  }

  // --- Banks, pistons and rods ---------------------------------------------
  const cylinderIndexOf = new Map<string, number>();
  const rodOfSpec = new Map<ConnectingRodSpec, number>();

  let cylinderBaseIndex = 0;
  for (let bankIndex = 0; bankIndex < spec.banks.length; ++bankIndex) {
    const bankSpec = spec.banks[bankIndex];
    const bank = engine.getCylinderBank(bankIndex);

    bank.initialize({
      angle: bankSpec.angle,
      bore: bankSpec.bore,
      deckHeight: bankSpec.deckHeight,
      positionX: bankSpec.positionX,
      positionY: bankSpec.positionY,
      displayDepth: bankSpec.displayDepth,
      cylinderCount: bankSpec.cylinders.length,
      index: bankIndex,
    });

    for (let i = 0; i < bankSpec.cylinders.length; ++i) {
      const cylinderSpec = bankSpec.cylinders[i];
      const globalIndex = cylinderBaseIndex + i;

      const piston = engine.getPiston(globalIndex);
      const rod = engine.getConnectingRod(globalIndex);

      cylinderIndexOf.set(cylinderKey(bankIndex, i), globalIndex);
      rodOfSpec.set(cylinderSpec.connectingRod, globalIndex);

      piston.initialize({
        rod,
        bank,
        cylinderIndex: i,
        mass: cylinderSpec.piston.mass,
        blowbyFlowCoefficient: cylinderSpec.piston.blowby,
        compressionHeight: cylinderSpec.piston.compressionHeight,
        wristPinPosition: cylinderSpec.piston.wristPinPosition,
        displacement: cylinderSpec.piston.displacement,
      });

      const journal = cylinderSpec.rodJournal;
      const rodSpec = cylinderSpec.connectingRod;
      const ownJournals = rodSpec.rodJournals ?? [];

      rod.initialize({
        mass: rodSpec.mass,
        momentOfInertia: rodSpec.momentOfInertia,
        centerOfMass: rodSpec.centerOfMass,
        length: rodSpec.length,
        rodJournals: ownJournals.length,
        slaveThrow: rodSpec.slaveThrow,
        piston,
        crankshaft: crankshaftOf.get(journal) ?? null,
        master: null,
        journal: rodJournalIndex.get(journal) ?? 0,
      });

      for (let j = 0; j < ownJournals.length; ++j) {
        rod.setRodJournalAngle(j, ownJournals[j].angle + PI / 2);
      }
    }

    // Head and per-cylinder port assignments.
    const head = engine.getHead(bankIndex);
    const headSpec = bankSpec.head;

    head.initialize({
      bank,
      intakePortFlow: headSpec.intakePortFlow,
      exhaustPortFlow: headSpec.exhaustPortFlow,
      valvetrain: makeValvetrain(headSpec.valvetrain, engine.getCrankshaft(0)),
      combustionChamberVolume: headSpec.chamberVolume,
      intakeRunnerVolume: headSpec.intakeRunnerVolume,
      intakeRunnerCrossSectionArea: headSpec.intakeRunnerCrossSectionArea,
      exhaustRunnerVolume: headSpec.exhaustRunnerVolume,
      exhaustRunnerCrossSectionArea: headSpec.exhaustRunnerCrossSectionArea,
      flipDisplay: headSpec.flipDisplay,
    });

    for (let i = 0; i < bankSpec.cylinders.length; ++i) {
      const cylinderSpec = bankSpec.cylinders[i];
      head.setIntake(i, engine.getIntake(intakeSpecs.indexOf(cylinderSpec.intake)));
      head.setExhaustSystem(
        i,
        engine.getExhaustSystem(exhaustSpecs.indexOf(cylinderSpec.exhaustSystem)),
      );
      head.setSoundAttenuation(i, cylinderSpec.soundAttenuation ?? 1.0);
      head.setHeaderPrimaryLength(i, cylinderSpec.primaryLength ?? 0.0);
    }

    cylinderBaseIndex += bankSpec.cylinders.length;
  }

  // --- Link slave rods to their master rods --------------------------------
  for (const bank of spec.banks) {
    for (const cylinder of bank.cylinders) {
      const masterSpec = masterRodSpecOf.get(cylinder.rodJournal);
      if (masterSpec === undefined) continue;

      const rodIndex = rodOfSpec.get(cylinder.connectingRod);
      const masterIndex = rodOfSpec.get(masterSpec);
      if (rodIndex === undefined || masterIndex === undefined) continue;
      if (rodIndex === masterIndex) continue;

      const rod = engine.getConnectingRod(rodIndex);
      const master = engine.getConnectingRod(masterIndex);
      rod.setMaster(master);
      rod.setCrankshaft(master.getCrankshaft());
    }
  }

  // --- Ignition module ------------------------------------------------------
  const ignition = engine.getIgnitionModule();
  ignition.initialize({
    crankshaft: engine.getCrankshaft(0),
    cylinderCount: engine.getCylinderCount(),
    timingCurve: spec.ignitionModule.timingCurve,
    revLimit: spec.ignitionModule.revLimit,
    limiterDuration: spec.ignitionModule.limiterDuration,
  });

  for (const post of spec.ignitionModule.posts) {
    for (const connection of post.wire.connections) {
      const bankIndex = spec.banks.indexOf(connection.bank);
      if (bankIndex === -1) continue;

      const index = cylinderIndexOf.get(cylinderKey(bankIndex, connection.index));
      if (index === undefined) continue;

      ignition.setFiringOrder(index, post.angle);
    }
  }

  // --- Fuel and combustion chambers ----------------------------------------
  const meanPistonSpeedToTurbulence = new Func();
  meanPistonSpeedToTurbulence.initialize(30, 1);
  for (let i = 0; i < 30; ++i) {
    meanPistonSpeedToTurbulence.addSample(i, i * 0.5);
  }

  const fuel = engine.getFuel();
  fuel.initialize(resolveFuelParameters(spec.fuel));

  for (let i = 0; i < engine.getCylinderCount(); ++i) {
    const piston = engine.getPiston(i);
    const chamber: CombustionChamber = engine.getChamber(i);
    chamber.initialize({
      piston,
      head: engine.getHead(piston.getCylinderBank().getIndex()),
      fuel,
      meanPistonSpeedToTurbulence,
      crankcasePressure: units.pressure(1.0, units.atm),
    });
  }

  // VTEC valvetrains need a reference back to the finished engine.
  for (let i = 0; i < engine.getCylinderBankCount(); ++i) {
    const valvetrain = engine.getHead(i).getValvetrain();
    if (valvetrain instanceof VtecValvetrain) valvetrain.setEngine(engine);
  }

  engine.calculateDisplacement();

  return engine;
}

function cylinderKey(bankIndex: number, localIndex: number): string {
  return `${bankIndex}:${localIndex}`;
}

function makeThrottle(spec: EngineSpec): Throttle {
  const throttle = spec.throttle ?? { kind: 'direct' as const };

  if (throttle.kind === 'governor') {
    return new Governor({
      minSpeed: throttle.minSpeed,
      maxSpeed: throttle.maxSpeed,
      minVelocity: throttle.minVelocity,
      maxVelocity: throttle.maxVelocity,
      k_s: throttle.k_s,
      k_d: throttle.k_d,
      gamma: throttle.gamma,
    });
  }

  return new DirectThrottleLinkage(throttle.gamma ?? 1.0);
}

function makeCamshaft(spec: CamshaftSpec, crankshaft: Crankshaft): Camshaft {
  const camshaft = new Camshaft();
  camshaft.initialize({
    lobes: spec.lobes.length,
    advance: spec.advance,
    crankshaft,
    lobeProfile: spec.lobeProfile,
    baseRadius: spec.baseRadius,
  });

  for (let i = 0; i < spec.lobes.length; ++i) {
    camshaft.setLobeCenterline(i, spec.lobes[i]);
  }

  return camshaft;
}

function makeValvetrain(spec: ValvetrainSpec, crankshaft: Crankshaft): Valvetrain {
  if (spec.kind === 'vtec') {
    return new VtecValvetrain({
      intakeCamshaft: makeCamshaft(spec.intakeCamshaft, crankshaft),
      exhaustCamshaft: makeCamshaft(spec.exhaustCamshaft, crankshaft),
      vtecIntakeCamshaft: makeCamshaft(spec.vtecIntakeCamshaft, crankshaft),
      vtecExhaustCamshaft: makeCamshaft(spec.vtecExhaustCamshaft, crankshaft),
      minRpm: spec.minRpm ?? units.rpm(5800),
      minSpeed: spec.minSpeed ?? units.distance(10, units.mph),
      manifoldVacuum:
        spec.manifoldVacuum ?? units.pressure(1.0, units.atm) - units.pressure(5.0, units.inHg),
      minThrottlePosition: spec.minThrottlePosition ?? 0.3,
    });
  }

  return new StandardValvetrain(
    makeCamshaft(spec.intakeCamshaft, crankshaft),
    makeCamshaft(spec.exhaustCamshaft, crankshaft),
  );
}

export function buildCylinderBankCount(spec: EngineSpec): number {
  return spec.banks.length;
}

export type { CylinderBankSpec };
