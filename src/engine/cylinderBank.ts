/** Ported from `include/cylinder_bank.h` / `src/cylinder_bank.cpp`. */
import { PI } from '../core/constants';
import type { Crankshaft } from './crankshaft';

export interface CylinderBankParameters {
  crankshaft?: Crankshaft | null;
  positionX?: number;
  positionY?: number;
  /** Bank angle from vertical, in radians. */
  angle: number;
  bore: number;
  deckHeight: number;
  displayDepth?: number;
  cylinderCount: number;
  index: number;
}

export class CylinderBank {
  private angle = 0;
  private bore = 0;
  private deckHeight = 0;
  private displayDepth = 0.4;
  private cylinderCount = 0;
  private index = -1;

  private dx = 0;
  private dy = 0;
  private x = 0;
  private y = 0;

  initialize(params: CylinderBankParameters): void {
    this.angle = params.angle;
    this.bore = params.bore;
    this.deckHeight = params.deckHeight;
    this.cylinderCount = params.cylinderCount;

    this.dx = Math.cos(this.angle + PI / 2);
    this.dy = Math.sin(this.angle + PI / 2);

    this.x = params.positionX ?? 0;
    this.y = params.positionY ?? 0;

    this.displayDepth = params.displayDepth ?? 0.4;
    this.index = params.index;
  }

  /** World position `h` metres above the deck along the bank axis. */
  getPositionAboveDeck(h: number, out: { x: number; y: number }): void {
    out.x = this.dx * (this.deckHeight + h) + this.x;
    out.y = this.dy * (this.deckHeight + h) + this.y;
  }

  boreSurfaceArea(): number {
    return (PI * this.bore * this.bore) / 4.0;
  }

  getAngle(): number {
    return this.angle;
  }

  getBore(): number {
    return this.bore;
  }

  getDeckHeight(): number {
    return this.deckHeight;
  }

  getCylinderCount(): number {
    return this.cylinderCount;
  }

  getIndex(): number {
    return this.index;
  }

  getDx(): number {
    return this.dx;
  }

  getDy(): number {
    return this.dy;
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  getDisplayDepth(): number {
    return this.displayDepth;
  }
}
