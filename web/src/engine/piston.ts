/** Ported from `include/piston.h` / `src/piston.cpp`. */
import { RigidBody } from '../physics/rigidBody';
import { MAX_BODY_COUNT } from '../physics/constraint';
import type { LineConstraint } from '../physics/constraints/lineConstraint';
import type { ConnectingRod } from './connectingRod';
import type { CylinderBank } from './cylinderBank';

export interface PistonParameters {
  rod?: ConnectingRod | null;
  bank?: CylinderBank | null;
  cylinderIndex?: number;
  /** Flow coefficient of the gap between ring and bore. */
  blowbyFlowCoefficient?: number;
  compressionHeight?: number;
  wristPinPosition?: number;
  displacement?: number;
  mass?: number;
}

export class Piston {
  readonly body = new RigidBody();

  private rod: ConnectingRod | null = null;
  private bank: CylinderBank | null = null;
  private cylinderConstraint: LineConstraint | null = null;
  private cylinderIndex = -1;
  private compressionHeight = 0;
  private displacement = 0;
  private wristPinLocation = 0;
  private mass = 0;
  private blowby_k = 0;

  initialize(params: PistonParameters): void {
    this.rod = params.rod ?? null;
    this.bank = params.bank ?? null;
    this.cylinderIndex = params.cylinderIndex ?? -1;
    this.compressionHeight = params.compressionHeight ?? 0;
    this.displacement = params.displacement ?? 0;
    this.wristPinLocation = params.wristPinPosition ?? 0;
    this.mass = params.mass ?? 0;
    this.blowby_k = params.blowbyFlowCoefficient ?? 0;
  }

  setCylinderConstraint(constraint: LineConstraint): void {
    this.cylinderConstraint = constraint;
  }

  /** Piston position relative to the base of its cylinder bank. */
  relativeX(): number {
    return this.body.p_x - this.bank!.getX();
  }

  relativeY(): number {
    return this.body.p_y - this.bank!.getY();
  }

  /** Magnitude of the side load the cylinder wall is carrying. */
  calculateCylinderWallForce(): number {
    const c = this.cylinderConstraint;
    if (c === null) return 0;

    const fx = c.F_x[0 * MAX_BODY_COUNT + 0];
    const fy = c.F_y[0 * MAX_BODY_COUNT + 0];
    return Math.sqrt(fx * fx + fy * fy);
  }

  getRod(): ConnectingRod {
    return this.rod!;
  }

  getCylinderBank(): CylinderBank {
    return this.bank!;
  }

  getCylinderIndex(): number {
    return this.cylinderIndex;
  }

  getCompressionHeight(): number {
    return this.compressionHeight;
  }

  getDisplacement(): number {
    return this.displacement;
  }

  getWristPinLocation(): number {
    return this.wristPinLocation;
  }

  getMass(): number {
    return this.mass;
  }

  getBlowbyK(): number {
    return this.blowby_k;
  }
}
