/** Ported from `include/connecting_rod.h` / `src/connecting_rod.cpp`. */
import { RigidBody } from '../physics/rigidBody';
import type { Crankshaft } from './crankshaft';
import type { Piston } from './piston';

export interface ConnectingRodParameters {
  mass?: number;
  momentOfInertia?: number;
  centerOfMass?: number;
  length?: number;
  /** Number of journals this rod carries when acting as a master rod. */
  rodJournals?: number;
  slaveThrow?: number;
  piston?: Piston | null;
  crankshaft?: Crankshaft | null;
  master?: ConnectingRod | null;
  journal?: number;
}

export class ConnectingRod {
  readonly body = new RigidBody();

  private centerOfMass = 0;
  private length = 0;
  private mass = 0;
  private momentOfInertia = 0;
  private journal = 0;
  private master: ConnectingRod | null = null;
  private crankshaft: Crankshaft | null = null;
  private piston: Piston | null = null;

  private slaveThrow = 0;
  private rodJournalAngles: Float64Array = new Float64Array(0);
  private rodJournalCount = 0;

  initialize(params: ConnectingRodParameters): void {
    this.centerOfMass = params.centerOfMass ?? 0;
    this.length = params.length ?? 0;
    this.mass = params.mass ?? 0;
    this.momentOfInertia = params.momentOfInertia ?? 0;
    this.journal = params.journal ?? 0;
    this.crankshaft = params.crankshaft ?? null;
    this.piston = params.piston ?? null;

    this.rodJournalCount = params.rodJournals ?? 0;
    this.rodJournalAngles = new Float64Array(Math.max(this.rodJournalCount, 1));
    this.slaveThrow = params.slaveThrow ?? 0;
    this.master = params.master ?? null;
  }

  getBigEndLocal(): number {
    return -(this.length / 2) + this.centerOfMass;
  }

  getLittleEndLocal(): number {
    return this.length / 2 - this.centerOfMass;
  }

  setMaster(rod: ConnectingRod | null): void {
    this.master = rod;
  }

  setCrankshaft(crank: Crankshaft | null): void {
    this.crankshaft = crank;
  }

  setPiston(piston: Piston): void {
    this.piston = piston;
  }

  getRodJournalCount(): number {
    return this.rodJournalCount;
  }

  setRodJournalAngle(i: number, angle: number): void {
    this.rodJournalAngles[i] = angle;
  }

  getRodJournalAngle(i: number): number {
    return this.rodJournalAngles[i];
  }

  getRodJournalPositionLocal(i: number, out: { x: number; y: number }): void {
    const journalAngle = this.getRodJournalAngle(i);
    out.x = Math.cos(journalAngle) * this.slaveThrow;
    out.y = Math.sin(journalAngle) * this.slaveThrow + this.getBigEndLocal();
  }

  getRodJournalPositionGlobal(i: number, out: { x: number; y: number }): void {
    this.getRodJournalPositionLocal(i, out);
    const lx = out.x;
    const ly = out.y;

    const angle = this.body.theta;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    out.x = dx * lx - dy * ly + this.body.p_x;
    out.y = dy * lx + dx * ly + this.body.p_y;
  }

  /** Depth used to order rods front-to-back in the renderer. */
  getLayer(): number {
    if (this.master !== null) return this.master.getLayer();
    return this.getJournal();
  }

  getSlaveThrow(): number {
    return this.slaveThrow;
  }

  getCenterOfMass(): number {
    return this.centerOfMass;
  }

  getLength(): number {
    return this.length;
  }

  getMass(): number {
    return this.mass;
  }

  getMomentOfInertia(): number {
    return this.momentOfInertia;
  }

  getJournal(): number {
    return this.journal;
  }

  getMasterRod(): ConnectingRod | null {
    return this.master;
  }

  getCrankshaft(): Crankshaft | null {
    return this.crankshaft;
  }

  getPiston(): Piston | null {
    return this.piston;
  }
}
