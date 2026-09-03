/** Ported from `include/crankshaft.h` / `src/crankshaft.cpp`. */
import { RigidBody } from '../physics/rigidBody';
import { PI } from '../core/constants';

export interface CrankshaftParameters {
  mass: number;
  flywheelMass: number;
  momentOfInertia: number;
  crankThrow: number;
  pos_x?: number;
  pos_y?: number;
  /** Top-dead-centre offset, in radians of crank angle. */
  tdc?: number;
  frictionTorque?: number;
  rodJournals: number;
}

export class Crankshaft {
  readonly body = new RigidBody();

  private rodJournalAngles: Float64Array = new Float64Array(0);
  private rodJournalCount = 0;

  private tdc = 0;
  private throwLength = 0;
  private mass = 0;
  private momentOfInertia = 0;
  private flywheelMass = 0;
  private p_x = 0;
  private p_y = 0;
  private frictionTorque = 0;

  initialize(params: CrankshaftParameters): void {
    this.mass = params.mass;
    this.flywheelMass = params.flywheelMass;
    this.momentOfInertia = params.momentOfInertia;
    this.throwLength = params.crankThrow;
    this.rodJournalCount = params.rodJournals;
    this.rodJournalAngles = new Float64Array(Math.max(params.rodJournals, 1));
    this.p_x = params.pos_x ?? 0;
    this.p_y = params.pos_y ?? 0;
    this.tdc = params.tdc ?? 0;
    this.frictionTorque = params.frictionTorque ?? 0;
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
    const theta = this.rodJournalAngles[i];
    out.x = Math.cos(theta) * this.throwLength;
    out.y = Math.sin(theta) * this.throwLength;
  }

  getRodJournalPositionGlobal(i: number, out: { x: number; y: number }): void {
    this.getRodJournalPositionLocal(i, out);
    out.x += this.body.p_x;
    out.y += this.body.p_y;
  }

  /** Keep theta inside one 720-degree cycle to avoid precision loss over time. */
  resetAngle(): void {
    this.body.theta = this.body.theta % (4 * PI);
  }

  getAngle(): number {
    return this.body.theta - this.tdc;
  }

  /** Position within the four-stroke cycle, in [0, 4 pi). */
  getCycleAngle(offset = 0.0): number {
    const wrapped = (-this.getAngle() + offset) % (4 * PI);
    return wrapped < 0 ? wrapped + 4 * PI : wrapped;
  }

  getTdc(): number {
    return this.tdc;
  }

  getThrow(): number {
    return this.throwLength;
  }

  getMass(): number {
    return this.mass;
  }

  getMomentOfInertia(): number {
    return this.momentOfInertia;
  }

  getFlywheelMass(): number {
    return this.flywheelMass;
  }

  getPosX(): number {
    return this.p_x;
  }

  getPosY(): number {
    return this.p_y;
  }

  getFrictionTorque(): number {
    return this.frictionTorque;
  }
}
