/** Ported from `include/engine.h` / `src/engine.cpp`. */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { Crankshaft } from './crankshaft';
import { CylinderBank } from './cylinderBank';
import { CylinderHead } from './cylinderHead';
import { Piston } from './piston';
import { ConnectingRod } from './connectingRod';
import { ExhaustSystem } from './exhaustSystem';
import { Intake } from './intake';
import { CombustionChamber } from './combustionChamber';
import { IgnitionModule } from './ignitionModule';
import { Fuel } from './fuel';
import type { Throttle } from './throttle';

export interface EngineParameters {
  cylinderBanks: number;
  cylinderCount: number;
  crankshaftCount: number;
  exhaustSystemCount: number;
  intakeCount: number;

  name: string;

  starterTorque?: number;
  starterSpeed?: number;
  redline?: number;
  dynoMinSpeed?: number;
  dynoMaxSpeed?: number;
  dynoHoldStep?: number;

  throttle: Throttle;

  initialSimulationFrequency?: number;
  initialHighFrequencyGain?: number;
  initialNoise?: number;
  initialJitter?: number;
}

export class Engine {
  private name = '';

  private crankshafts: Crankshaft[] = [];
  private cylinderBanks: CylinderBank[] = [];
  private heads: CylinderHead[] = [];
  private pistons: Piston[] = [];
  private connectingRods: ConnectingRod[] = [];
  private combustionChambers: CombustionChamber[] = [];
  private exhaustSystems: ExhaustSystem[] = [];
  private intakes: Intake[] = [];

  private starterTorque = units.torque(90.0, units.ft_lb);
  private starterSpeed = units.rpm(200);
  private redline = units.rpm(6500);
  private dynoMinSpeed = units.rpm(1000);
  private dynoMaxSpeed = units.rpm(6500);
  private dynoHoldStep = units.rpm(100);

  private initialSimulationFrequency = 10000.0;
  private initialHighFrequencyGain = 0.01;
  private initialNoise = 1.0;
  private initialJitter = 0.5;

  private readonly ignitionModule = new IgnitionModule();
  private readonly fuel = new Fuel();

  private throttle: Throttle | null = null;
  private throttleValue = 0.0;
  private displacement = 0.0;

  initialize(params: EngineParameters): void {
    this.name = params.name;
    this.throttle = params.throttle;

    this.starterTorque = params.starterTorque ?? this.starterTorque;
    this.starterSpeed = params.starterSpeed ?? this.starterSpeed;
    this.redline = params.redline ?? this.redline;
    this.dynoMinSpeed = params.dynoMinSpeed ?? this.dynoMinSpeed;
    this.dynoMaxSpeed = params.dynoMaxSpeed ?? this.dynoMaxSpeed;
    this.dynoHoldStep = params.dynoHoldStep ?? this.dynoHoldStep;

    this.initialSimulationFrequency =
      params.initialSimulationFrequency ?? this.initialSimulationFrequency;
    this.initialHighFrequencyGain =
      params.initialHighFrequencyGain ?? this.initialHighFrequencyGain;
    this.initialNoise = params.initialNoise ?? this.initialNoise;
    this.initialJitter = params.initialJitter ?? this.initialJitter;

    this.crankshafts = Array.from({ length: params.crankshaftCount }, () => new Crankshaft());
    this.cylinderBanks = Array.from({ length: params.cylinderBanks }, () => new CylinderBank());
    this.heads = Array.from({ length: params.cylinderBanks }, () => new CylinderHead());
    this.pistons = Array.from({ length: params.cylinderCount }, () => new Piston());
    this.connectingRods = Array.from(
      { length: params.cylinderCount },
      () => new ConnectingRod(),
    );
    this.exhaustSystems = Array.from(
      { length: params.exhaustSystemCount },
      () => new ExhaustSystem(),
    );
    this.intakes = Array.from({ length: params.intakeCount }, () => new Intake());
    this.combustionChambers = Array.from(
      { length: params.cylinderCount },
      () => new CombustionChamber(),
    );

    for (let i = 0; i < this.exhaustSystems.length; ++i) {
      this.exhaustSystems[i].index = i;
    }

    for (const chamber of this.combustionChambers) {
      chamber.setEngine(this);
    }
  }

  getName(): string {
    return this.name;
  }

  getOutputCrankshaft(): Crankshaft {
    return this.crankshafts[0];
  }

  setSpeedControl(s: number): void {
    this.throttle!.setSpeedControl(s);
  }

  getSpeedControl(): number {
    return this.throttle!.getSpeedControl();
  }

  /** 0 = wide open, 1 = closed. */
  setThrottle(throttle: number): void {
    for (const intake of this.intakes) intake.throttle = throttle;
    this.throttleValue = throttle;
  }

  getThrottle(): number {
    return this.throttleValue;
  }

  getThrottlePlateAngle(): number {
    return (1 - this.intakes[0].getThrottlePlatePosition()) * (PI / 2);
  }

  update(dt: number): void {
    this.throttle!.update(dt, this);
  }

  /**
   * Numerically integrate the swept volume of every cylinder over one crank
   * revolution (matching the original's approximation).
   */
  calculateDisplacement(): void {
    const RESOLUTION = 1000;
    const n = this.pistons.length;

    const min_s = new Float64Array(n).fill(Number.MAX_VALUE);
    const max_s = new Float64Array(n).fill(-Number.MAX_VALUE);

    const scratch = { p_x: 0, p_y: 0, theta: 0, s: 0 };

    for (let j = 0; j < RESOLUTION; ++j) {
      const crankshaftAngle = 2 * (j / RESOLUTION) * PI;

      for (let i = 0; i < n; ++i) {
        const piston = this.pistons[i];
        const bank = piston.getCylinderBank();
        const rod = piston.getRod();

        if (!placeRod(rod, bank, crankshaftAngle, scratch)) continue;

        min_s[i] = Math.min(min_s[i], scratch.s);
        max_s[i] = Math.max(max_s[i], scratch.s);
      }
    }

    let displacement = 0;
    for (let i = 0; i < n; ++i) {
      const bank = this.pistons[i].getCylinderBank();
      if (min_s[i] < max_s[i]) {
        const r = bank.getBore() / 2.0;
        displacement += PI * r * r * (max_s[i] - min_s[i]);
      }
    }

    this.displacement = displacement;
  }

  getDisplacement(): number {
    return this.displacement;
  }

  getIntakeFlowRate(): number {
    let airIntake = 0;
    for (const intake of this.intakes) airIntake += intake.flowRate;
    return airIntake;
  }

  getManifoldPressure(): number {
    let pressureSum = 0.0;
    for (const intake of this.intakes) pressureSum += intake.system.pressure();
    return pressureSum / this.intakes.length;
  }

  getIntakeAfr(): number {
    let totalOxygen = 0.0;
    let totalFuel = 0.0;
    for (const intake of this.intakes) {
      totalOxygen += intake.system.n_o2();
      totalFuel += intake.system.n_fuel();
    }

    const octaneMolarMass = units.mass(114.23, units.g);
    const oxygenMolarMass = units.mass(31.9988, units.g);

    if (totalFuel === 0) return 0;
    return (oxygenMolarMass * totalOxygen) / 0.21 / (totalFuel * octaneMolarMass);
  }

  getExhaustO2(): number {
    let totalInert = 0.0;
    let totalOxygen = 0.0;
    let totalFuel = 0.0;
    for (const exhaust of this.exhaustSystems) {
      totalInert += exhaust.getSystem().n_inert();
      totalOxygen += exhaust.getSystem().n_o2();
      totalFuel += exhaust.getSystem().n_fuel();
    }

    const octaneMolarMass = units.mass(114.23, units.g);
    const oxygenMolarMass = units.mass(31.9988, units.g);
    const nitrogenMolarMass = units.mass(28.014, units.g);

    if (totalFuel === 0) return 0;
    return (
      (oxygenMolarMass * totalOxygen) /
      (totalFuel * octaneMolarMass +
        nitrogenMolarMass * totalInert +
        oxygenMolarMass * totalOxygen)
    );
  }

  resetFuelConsumption(): void {
    for (const intake of this.intakes) intake.totalFuelInjected = 0;
  }

  getTotalFuelMassConsumed(): number {
    let n_fuelConsumed = 0;
    for (const intake of this.intakes) n_fuelConsumed += intake.totalFuelInjected;
    return n_fuelConsumed * this.fuel.getMolecularMass();
  }

  getTotalVolumeFuelConsumed(): number {
    return this.getTotalFuelMassConsumed() / this.fuel.getDensity();
  }

  getRpm(): number {
    if (this.crankshafts.length === 0) return 0;
    return Math.abs(units.toRpm(this.crankshafts[0].body.v_theta));
  }

  getSpeed(): number {
    if (this.crankshafts.length === 0) return 0;
    return Math.abs(this.crankshafts[0].body.v_theta);
  }

  isSpinningCw(): boolean {
    return this.getOutputCrankshaft().body.v_theta <= 0;
  }

  getMaxDepth(): number {
    let maxDepth = 0;
    for (const crankshaft of this.crankshafts) {
      maxDepth = Math.max(crankshaft.getRodJournalCount(), maxDepth);
    }
    return maxDepth;
  }

  getStarterTorque(): number {
    return this.starterTorque;
  }

  getStarterSpeed(): number {
    return this.starterSpeed;
  }

  getRedline(): number {
    return this.redline;
  }

  getDynoMinSpeed(): number {
    return this.dynoMinSpeed;
  }

  getDynoMaxSpeed(): number {
    return this.dynoMaxSpeed;
  }

  getDynoHoldStep(): number {
    return this.dynoHoldStep;
  }

  getCylinderBankCount(): number {
    return this.cylinderBanks.length;
  }

  getCylinderCount(): number {
    return this.pistons.length;
  }

  getCrankshaftCount(): number {
    return this.crankshafts.length;
  }

  getExhaustSystemCount(): number {
    return this.exhaustSystems.length;
  }

  getIntakeCount(): number {
    return this.intakes.length;
  }

  getCrankshaft(i: number): Crankshaft {
    return this.crankshafts[i];
  }

  getCylinderBank(i: number): CylinderBank {
    return this.cylinderBanks[i];
  }

  getHead(i: number): CylinderHead {
    return this.heads[i];
  }

  getPiston(i: number): Piston {
    return this.pistons[i];
  }

  getConnectingRod(i: number): ConnectingRod {
    return this.connectingRods[i];
  }

  getIgnitionModule(): IgnitionModule {
    return this.ignitionModule;
  }

  getExhaustSystem(i: number): ExhaustSystem {
    return this.exhaustSystems[i];
  }

  getIntake(i: number): Intake {
    return this.intakes[i];
  }

  getChamber(i: number): CombustionChamber {
    return this.combustionChambers[i];
  }

  getFuel(): Fuel {
    return this.fuel;
  }

  getSimulationFrequency(): number {
    return this.initialSimulationFrequency;
  }

  getInitialHighFrequencyGain(): number {
    return this.initialHighFrequencyGain;
  }

  getInitialNoise(): number {
    return this.initialNoise;
  }

  getInitialJitter(): number {
    return this.initialJitter;
  }
}

interface RodPlacement {
  p_x: number;
  p_y: number;
  theta: number;
  s: number;
}

/**
 * Solve for where a rod's little end sits on the bank axis at a given crank
 * angle. Recurses through master rods for articulated (radial) layouts.
 *
 * Ported from the free `placeRod` function in `src/engine.cpp`, including two
 * quirks that matter for matching the original's displacement figure: the
 * journal is looked up by the piston's index within its bank rather than by the
 * rod's journal index, and the returned angle is `acos` of an unnormalised
 * offset. This result only feeds the displacement approximation - the physical
 * placement in `PistonEngineSimulator` does its own, correct, solve.
 */
function placeRod(
  rod: ConnectingRod,
  bank: CylinderBank,
  crankshaftAngle: number,
  out: RodPlacement,
): boolean {
  let p_x_0: number;
  let p_y_0: number;
  let theta_0: number;
  const local = { x: 0, y: 0 };

  const piston = rod.getPiston();
  if (piston === null) return false;
  const journalIndex = piston.getCylinderIndex();

  const master = rod.getMasterRod();
  if (master !== null) {
    const masterPiston = master.getPiston();
    if (masterPiston === null) return false;

    const nested: RodPlacement = { p_x: 0, p_y: 0, theta: 0, s: 0 };
    if (!placeRod(master, masterPiston.getCylinderBank(), crankshaftAngle, nested)) {
      return false;
    }

    p_x_0 = nested.p_x;
    p_y_0 = nested.p_y;
    theta_0 = nested.theta;
    master.getRodJournalPositionLocal(journalIndex, local);
  } else {
    const crankshaft = rod.getCrankshaft();
    if (crankshaft === null) return false;

    theta_0 = crankshaftAngle;
    p_x_0 = crankshaft.getPosX();
    p_y_0 = crankshaft.getPosY();
    crankshaft.getRodJournalPositionLocal(journalIndex, local);
  }

  const dx = Math.cos(theta_0);
  const dy = Math.sin(theta_0);
  out.p_x = p_x_0 + (dx * local.x - dy * local.y);
  out.p_y = p_y_0 + (dy * local.x + dx * local.y);

  const a = bank.getDx() * bank.getDx() + bank.getDy() * bank.getDy();
  const b =
    -2 * bank.getDx() * (out.p_x - bank.getX()) - 2 * bank.getDy() * (out.p_y - bank.getY());
  const c =
    (out.p_x - bank.getX()) * (out.p_x - bank.getX()) +
    (out.p_y - bank.getY()) * (out.p_y - bank.getY()) -
    rod.getLength() * rod.getLength();

  const det = b * b - 4 * a * c;
  if (det < 0) return false;

  const sqrt_det = Math.sqrt(det);
  const s0 = (-b + sqrt_det) / (2 * a);
  const s1 = (-b - sqrt_det) / (2 * a);

  out.s = Math.max(s0, s1);
  if (out.s < 0) return false;

  const toPin_x = bank.getX() + bank.getDx() * out.s - out.p_x;
  const toPin_y = bank.getY() + bank.getDy() * out.s - out.p_y;
  out.theta = toPin_y > 0 ? Math.acos(toPin_x) : -Math.acos(toPin_x);

  return true;
}
