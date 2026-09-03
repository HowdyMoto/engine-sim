/**
 * Piston-engine simulation, ported from `src/piston_engine_simulator.cpp`.
 *
 * Builds the constraint network for the crank/rod/piston assembly, runs the
 * fluid sub-steps each physics step, and converts exhaust runner pressure into
 * the synthesizer's input signal.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { Simulator } from './simulator';
import { RigidBody } from '../physics/rigidBody';
import { FixedPositionConstraint } from '../physics/constraints/fixedPositionConstraint';
import { LineConstraint } from '../physics/constraints/lineConstraint';
import { LinkConstraint } from '../physics/constraints/linkConstraint';
import { ClutchConstraint } from '../physics/constraints/clutchConstraint';
import { RotationFrictionConstraint } from '../physics/constraints/rotationFrictionConstraint';
import { VehicleDragConstraint } from '../engine/vehicle';
import { DelayFilter } from '../audio/filters';
import type { Engine } from '../engine/engine';
import type { Vehicle } from '../engine/vehicle';
import type { Transmission } from '../engine/transmission';

const SOUND_ATTENUATION_RPM_SCALE = 40.0;

export class PistonEngineSimulator extends Simulator {
  private delayFilters: DelayFilter[] = [];

  private crankConstraints: FixedPositionConstraint[] = [];
  private crankshaftLinks: ClutchConstraint[] = [];
  private crankshaftFrictionConstraints: RotationFrictionConstraint[] = [];
  private cylinderWallConstraints: LineConstraint[] = [];
  private linkConstraints: LinkConstraint[] = [];

  private vehicleMass = new RigidBody();
  private vehicleDrag = new VehicleDragConstraint();

  private exhaustFlowStagingBuffer = new Float64Array(0);

  private fluidSimulationSteps = 8;

  setFluidSimulationSteps(steps: number): void {
    this.fluidSimulationSteps = steps;
  }

  getFluidSimulationSteps(): number {
    return this.fluidSimulationSteps;
  }

  getFluidSimulationFrequency(): number {
    return this.fluidSimulationSteps * this.getSimulationFrequency();
  }

  override loadSimulation(engine: Engine, vehicle: Vehicle, transmission: Transmission): void {
    super.loadSimulation(engine, vehicle, transmission);

    const crankCount = engine.getCrankshaftCount();
    const cylinderCount = engine.getCylinderCount();

    if (crankCount <= 0) return;

    this.crankConstraints = makeArray(crankCount, () => new FixedPositionConstraint());
    this.cylinderWallConstraints = makeArray(cylinderCount, () => new LineConstraint());
    this.linkConstraints = makeArray(cylinderCount * 2, () => new LinkConstraint());
    this.crankshaftFrictionConstraints = makeArray(
      crankCount,
      () => new RotationFrictionConstraint(),
    );
    this.crankshaftLinks = makeArray(Math.max(crankCount - 1, 0), () => new ClutchConstraint());
    this.delayFilters = makeArray(cylinderCount, () => new DelayFilter());

    const ks = 5000;
    const kd = 10;

    const outputShaft = engine.getCrankshaft(0);

    for (let i = 0; i < crankCount; ++i) {
      const crankshaft = engine.getCrankshaft(i);

      const constraint = this.crankConstraints[i];
      constraint.setBody(crankshaft.body);
      constraint.setWorldPosition(crankshaft.getPosX(), crankshaft.getPosY());
      constraint.setLocalPosition(0.0, 0.0);
      constraint.kd = kd;
      constraint.ks = ks;

      crankshaft.body.p_x = crankshaft.getPosX();
      crankshaft.body.p_y = crankshaft.getPosY();
      crankshaft.body.theta = 0;
      crankshaft.body.m = crankshaft.getMass() + crankshaft.getFlywheelMass();
      crankshaft.body.I = crankshaft.getMomentOfInertia();

      const friction = this.crankshaftFrictionConstraints[i];
      friction.minTorque = -crankshaft.getFrictionTorque();
      friction.maxTorque = crankshaft.getFrictionTorque();
      friction.setBody(crankshaft.body);

      this.system.addRigidBody(crankshaft.body);
      this.system.addConstraint(constraint);
      this.system.addConstraint(friction);

      if (crankshaft !== outputShaft) {
        const crankLink = this.crankshaftLinks[i - 1];
        crankLink.setBody1(outputShaft.body);
        crankLink.setBody2(crankshaft.body);
        this.system.addConstraint(crankLink);
      }
    }

    transmission.addToSystem(this.system, this.vehicleMass, vehicle, engine);
    vehicle.setRotatingMass(this.vehicleMass);

    this.vehicleDrag.initialize(this.vehicleMass, vehicle);
    this.system.addConstraint(this.vehicleDrag);

    this.vehicleMass.reset();
    this.vehicleMass.m = 1.0;
    this.vehicleMass.I = 1.0;
    this.system.addRigidBody(this.vehicleMass);

    const journal = { x: 0, y: 0 };

    for (let i = 0; i < cylinderCount; ++i) {
      const piston = engine.getPiston(i);
      const connectingRod = piston.getRod();
      const bank = piston.getCylinderBank();

      const dx = Math.cos(bank.getAngle() + PI / 2);
      const dy = Math.sin(bank.getAngle() + PI / 2);

      const wall = this.cylinderWallConstraints[i];
      wall.setBody(piston.body);
      wall.dx = dx;
      wall.dy = dy;
      wall.local_x = 0.0;
      wall.local_y = piston.getWristPinLocation();
      wall.p0_x = bank.getX();
      wall.p0_y = bank.getY();
      wall.ks = ks;
      wall.kd = kd;

      piston.setCylinderConstraint(wall);

      const wristPinLink = this.linkConstraints[i * 2 + 0];
      wristPinLink.setBody1(connectingRod.body);
      wristPinLink.setBody2(piston.body);
      wristPinLink.setLocalPosition1(0.0, connectingRod.getLittleEndLocal());
      wristPinLink.setLocalPosition2(0.0, piston.getWristPinLocation());
      wristPinLink.ks = ks;
      wristPinLink.kd = kd;

      journal.x = 0.0;
      journal.y = 0.0;

      const bigEndLink = this.linkConstraints[i * 2 + 1];
      const masterRod = connectingRod.getMasterRod();
      if (masterRod === null) {
        const crankshaft = connectingRod.getCrankshaft()!;
        crankshaft.getRodJournalPositionLocal(connectingRod.getJournal(), journal);
        bigEndLink.setBody2(crankshaft.body);
      } else {
        masterRod.getRodJournalPositionLocal(connectingRod.getJournal(), journal);
        bigEndLink.setBody2(masterRod.body);
      }

      bigEndLink.setBody1(connectingRod.body);
      bigEndLink.setLocalPosition1(0.0, connectingRod.getBigEndLocal());
      bigEndLink.setLocalPosition2(journal.x, journal.y);
      bigEndLink.ks = ks;
      bigEndLink.kd = kd;

      piston.body.m = piston.getMass();
      piston.body.I = 1.0;

      connectingRod.body.m = connectingRod.getMass();
      connectingRod.body.I = connectingRod.getMomentOfInertia();

      this.system.addRigidBody(piston.body);
      this.system.addRigidBody(connectingRod.body);
      this.system.addConstraint(wristPinLink);
      this.system.addConstraint(bigEndLink);
      this.system.addConstraint(wall);
      this.system.addForceGenerator(engine.getChamber(i));
    }

    this.dyno.connectCrankshaft(engine.getOutputCrankshaft());
    this.system.addConstraint(this.dyno);

    this.starterMotor.connectCrankshaft(engine.getOutputCrankshaft());
    this.starterMotor.maxTorque = engine.getStarterTorque();
    this.starterMotor.rotationSpeed = -engine.getStarterSpeed();
    this.system.addConstraint(this.starterMotor);

    this.placeAndInitialize();
    this.initializeSynthesizer();
  }

  override getAverageOutputSignal(): number {
    const engine = this.engine!;
    let sum = 0.0;
    for (let i = 0; i < engine.getExhaustSystemCount(); ++i) {
      sum += engine.getExhaustSystem(i).getSystem().pressure();
    }
    return sum / engine.getExhaustSystemCount();
  }

  /** Place every rod/piston pair consistently with the crank's start angle. */
  private placeAndInitialize(): void {
    const engine = this.engine!;
    const cylinderCount = engine.getCylinderCount();

    // Master rods first: slave rods hang off their journals.
    for (let i = 0; i < cylinderCount; ++i) {
      if (engine.getConnectingRod(i).getRodJournalCount() !== 0) {
        this.placeCylinder(i);
      }
    }

    for (let i = 0; i < cylinderCount; ++i) {
      this.placeCylinder(i);
    }

    for (let i = 0; i < cylinderCount; ++i) {
      const chamber = engine.getChamber(i);
      chamber.system.initialize(
        units.pressure(1.0, units.atm),
        chamber.getVolume(),
        units.celcius(25.0),
      );

      const piston = chamber.getPiston();
      const head = chamber.getCylinderHead();
      const exhaust = head.getExhaustSystem(piston.getCylinderIndex());
      const exhaustLength =
        head.getHeaderPrimaryLength(piston.getCylinderIndex()) + exhaust.getLength();
      const speedOfSound = (343.0 * units.m) / units.sec;
      const delay = exhaustLength / speedOfSound;
      this.delayFilters[i].initialize(delay, 10000.0);
    }

    engine.getIgnitionModule().reset();

    this.exhaustFlowStagingBuffer = new Float64Array(engine.getExhaustSystemCount());
  }

  private placeCylinder(i: number): void {
    const engine = this.engine!;
    const rod = engine.getConnectingRod(i);
    const piston = engine.getPiston(i);
    const bank = piston.getCylinderBank();

    const journal = { x: 0, y: 0 };
    const masterRod = rod.getMasterRod();
    if (masterRod !== null) {
      masterRod.getRodJournalPositionGlobal(rod.getJournal(), journal);
    } else {
      rod.getCrankshaft()!.getRodJournalPositionGlobal(rod.getJournal(), journal);
    }

    const p_x = journal.x;
    const p_y = journal.y;

    // Intersect the bank axis with a circle of radius `rod length` about the journal.
    const a = bank.getDx() * bank.getDx() + bank.getDy() * bank.getDy();
    const b = -2 * bank.getDx() * (p_x - bank.getX()) - 2 * bank.getDy() * (p_y - bank.getY());
    const c =
      (p_x - bank.getX()) * (p_x - bank.getX()) +
      (p_y - bank.getY()) * (p_y - bank.getY()) -
      rod.getLength() * rod.getLength();

    const det = b * b - 4 * a * c;
    if (det < 0) return;

    const sqrt_det = Math.sqrt(det);
    const s0 = (-b + sqrt_det) / (2 * a);
    const s1 = (-b - sqrt_det) / (2 * a);

    const s = Math.max(s0, s1);
    if (s < 0) return;

    const e_x = s * bank.getDx() + bank.getX();
    const e_y = s * bank.getDy() + bank.getY();

    const cosArg = clampUnit((e_x - p_x) / rod.getLength());
    const theta = e_y - p_y > 0 ? Math.acos(cosArg) : 2 * PI - Math.acos(cosArg);
    rod.body.theta = theta - PI / 2;

    const centre = { x: 0, y: 0 };
    rod.body.localToWorld(0, rod.getBigEndLocal(), centre);
    rod.body.p_x += p_x - centre.x;
    rod.body.p_y += p_y - centre.y;

    piston.body.p_x = e_x;
    piston.body.p_y = e_y;
    piston.body.theta = bank.getAngle() + PI;
  }

  protected override simulateStepInternal(): void {
    const engine = this.engine!;
    const timestep = this.getTimestep();
    const im = engine.getIgnitionModule();
    im.update(timestep);

    const cylinderCount = engine.getCylinderCount();
    for (let i = 0; i < cylinderCount; ++i) {
      if (im.getIgnitionEvent(i)) {
        engine.getChamber(i).ignite();
      }

      engine.getChamber(i).update(timestep);
    }

    for (let i = 0; i < cylinderCount; ++i) {
      engine.getChamber(i).resetLastTimestepExhaustFlow();
      engine.getChamber(i).resetLastTimestepIntakeFlow();
    }

    const exhaustSystemCount = engine.getExhaustSystemCount();
    const intakeCount = engine.getIntakeCount();
    const fluidTimestep = timestep / this.fluidSimulationSteps;

    for (let i = 0; i < this.fluidSimulationSteps; ++i) {
      for (let j = 0; j < exhaustSystemCount; ++j) {
        engine.getExhaustSystem(j).process(fluidTimestep);
      }

      for (let j = 0; j < intakeCount; ++j) {
        const intake = engine.getIntake(j);
        intake.process(fluidTimestep);
        intake.flowRate += intake.flow;
      }

      for (let j = 0; j < cylinderCount; ++j) {
        engine.getChamber(j).flow(fluidTimestep);
      }
    }

    im.resetIgnitionEvents();
  }

  override getTotalExhaustFlow(): number {
    const engine = this.engine!;
    let totalFlow = 0.0;
    for (let i = 0; i < engine.getCylinderCount(); ++i) {
      totalFlow += engine.getChamber(i).getLastTimestepExhaustFlow();
    }
    return totalFlow;
  }

  override endFrame(): void {
    super.endFrame();

    const engine = this.engine;
    if (engine === null) return;

    const frameTimestep = this.simulationSteps() * this.getTimestep();
    if (frameTimestep === 0) return;

    for (let i = 0; i < engine.getIntakeCount(); ++i) {
      engine.getIntake(i).flowRate /= frameTimestep;
    }
  }

  /**
   * Mix each cylinder's delayed exhaust pulse into its collector's channel.
   * Pulse strength combines static and forward/backward dynamic pressure, and
   * is attenuated at low RPM so a stopped engine is silent.
   */
  protected override writeToSynthesizer(): void {
    const engine = this.engine!;
    const exhaustSystemCount = engine.getExhaustSystemCount();

    this.exhaustFlowStagingBuffer.fill(0);

    const attenuation =
      Math.min(Math.abs(this.filteredEngineSpeed()), SOUND_ATTENUATION_RPM_SCALE) /
      SOUND_ATTENUATION_RPM_SCALE;
    const attenuation_3 = attenuation * attenuation * attenuation;

    const cylinderCount = engine.getCylinderCount();
    const atmosphericPressure = units.pressure(1.0, units.atm);

    for (let i = 0; i < cylinderCount; ++i) {
      const piston = engine.getPiston(i);
      const bank = piston.getCylinderBank();
      const head = engine.getHead(bank.getIndex());
      const exhaustSystem = head.getExhaustSystem(piston.getCylinderIndex());
      const chamber = engine.getChamber(i);

      const exhaustLength =
        head.getHeaderPrimaryLength(piston.getCylinderIndex()) + exhaustSystem.getLength();

      const runner = chamber.exhaustRunnerAndPrimary;
      const exhaustFlow =
        attenuation_3 *
        1600 *
        (1.0 * (runner.pressure() - atmosphericPressure) +
          0.1 * runner.dynamicPressure(1.0, 0.0) +
          0.1 * runner.dynamicPressure(-1.0, 0.0));

      const delayedExhaustPulse = this.delayFilters[i].f(exhaustFlow);

      this.exhaustFlowStagingBuffer[exhaustSystem.getIndex()] +=
        head.getSoundAttenuation(piston.getCylinderIndex()) *
        ((exhaustSystem.getAudioVolume() * delayedExhaustPulse) / cylinderCount) *
        (1 / (exhaustLength * exhaustLength));
    }

    void exhaustSystemCount;
    this.synthesizer.writeInput(this.exhaustFlowStagingBuffer);
  }
}

function makeArray<T>(n: number, factory: () => T): T[] {
  const result: T[] = [];
  for (let i = 0; i < n; ++i) result.push(factory());
  return result;
}

function clampUnit(x: number): number {
  if (x < -1) return -1;
  if (x > 1) return 1;
  return x;
}
