/**
 * Canvas 2D view of the engine.
 *
 * The C++ app renders through delta-studio (DirectX) with generated geometry;
 * this draws the same thing - crank, journals, rods, pistons, cylinder walls,
 * and per-cylinder combustion state - from the transferred frame state, in
 * engine world coordinates scaled to fit the canvas.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { C, S, crankshaftOffset, cylinderOffset } from '../worker/protocol';
import type { EngineInfo } from '../worker/protocol';

export interface Theme {
  background: string;
  shadow: string;
  foreground: string;
  metal: string;
  metalDark: string;
  metalLight: string;
  accent: string;
  hot: string;
  cold: string;
  outline: string;
}

export const DEFAULT_THEME: Theme = {
  background: '#0b0d10',
  shadow: '#14181d',
  foreground: '#e7ecf2',
  metal: '#39424d',
  metalDark: '#232a32',
  metalLight: '#5b6875',
  accent: '#f0a53c',
  hot: '#ff6b3d',
  cold: '#3d7dff',
  outline: '#0b0d10',
};

interface CylinderDraw {
  index: number;
  layer: number;
  bankIndex: number;
}

export class EngineRenderer {
  private ctx: CanvasRenderingContext2D;
  private info: EngineInfo | null = null;
  private drawOrder: CylinderDraw[] = [];

  private scale = 1;
  private originX = 0;
  private originY = 0;

  /** View layer: -1 draws every layer, otherwise only that rod journal depth. */
  layer = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private theme: Theme = DEFAULT_THEME,
  ) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  setEngine(info: EngineInfo): void {
    this.info = info;
    this.drawOrder = info.cylinders
      .map((cylinder, index) => ({
        index,
        layer: cylinder.layer,
        bankIndex: cylinder.bankIndex,
      }))
      // Deeper journals sit further back, so paint them first.
      .sort((a, b) => b.layer - a.layer);
  }

  getMaxLayer(): number {
    if (this.info === null) return 0;
    return this.info.cylinders.reduce((max, c) => Math.max(max, c.layer), 0);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();

    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Fit the engine's actual bounding box into the canvas.
   *
   * A V8 is much taller than it is wide and an opposed four is the reverse, so
   * measuring the real extents (crank circle plus every bank's bore rectangle)
   * frames both properly instead of leaving one of them adrift in empty space.
   */
  private updateTransform(): void {
    const info = this.info;
    if (info === null) return;

    const width = this.canvas.width;
    const height = this.canvas.height;

    const crankRadius = info.crankThrow * 2.0;
    let minX = -crankRadius;
    let maxX = crankRadius;
    let minY = -crankRadius;
    let maxY = crankRadius;

    for (const bank of info.banks) {
      const dx = Math.cos(bank.angle + PI / 2);
      const dy = Math.sin(bank.angle + PI / 2);
      const px = -dy;
      const py = dx;
      const halfBore = bank.bore / 2;

      for (const s of [0, bank.deckHeight + bank.bore * 0.35]) {
        for (const side of [-halfBore, halfBore]) {
          const x = bank.x + dx * s + px * side;
          const y = bank.y + dy * s + py * side;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const margin = 1.12;
    const spanX = (maxX - minX) * margin;
    const spanY = (maxY - minY) * margin;

    this.scale = Math.min(width / spanX, height / spanY);
    this.originX = width / 2 - ((minX + maxX) / 2) * this.scale;
    this.originY = height / 2 + ((minY + maxY) / 2) * this.scale;
  }

  private tx(x: number): number {
    return this.originX + x * this.scale;
  }

  private ty(y: number): number {
    // Engine space is y-up; canvas is y-down.
    return this.originY - y * this.scale;
  }

  render(state: Float32Array): void {
    const info = this.info;
    const ctx = this.ctx;

    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (info === null) return;

    this.updateTransform();

    const crankTheta = state[crankshaftOffset(info.cylinderCount)];

    this.drawCylinderWalls(state);

    for (const entry of this.drawOrder) {
      if (this.layer !== -1 && entry.layer !== this.layer) continue;
      this.drawCylinder(state, entry.index);
    }

    this.drawCrankshaft(crankTheta);
    this.drawSpinIndicator(state);
  }

  private drawCylinderWalls(state: Float32Array): void {
    const info = this.info!;
    const ctx = this.ctx;

    for (let b = 0; b < info.banks.length; ++b) {
      const bank = info.banks[b];
      const dx = Math.cos(bank.angle + PI / 2);
      const dy = Math.sin(bank.angle + PI / 2);
      const px = -dy;
      const py = dx;

      const halfBore = bank.bore / 2;
      const base = info.crankThrow * 0.85;
      const top = bank.deckHeight;
      const headTop = top + bank.bore * 0.3;

      // Hottest cylinder on this bank tints the head.
      let peakPressure = 0;
      for (let i = 0; i < info.cylinderCount; ++i) {
        if (info.cylinders[i].bankIndex !== b) continue;
        peakPressure = Math.max(peakPressure, state[cylinderOffset(i) + C.Pressure]);
      }
      const heat = Math.min(1, peakPressure / units.pressure(50, units.atm));

      const point = (s: number, side: number): [number, number] => [
        this.tx(bank.x + dx * s + px * side),
        this.ty(bank.y + dy * s + py * side),
      ];

      // Bore.
      ctx.beginPath();
      ctx.moveTo(...point(base, halfBore));
      ctx.lineTo(...point(top, halfBore));
      ctx.lineTo(...point(top, -halfBore));
      ctx.lineTo(...point(base, -halfBore));
      ctx.closePath();
      ctx.fillStyle = this.theme.shadow;
      ctx.fill();
      ctx.lineWidth = Math.max(1, this.scale * 0.005);
      ctx.strokeStyle = this.theme.metalDark;
      ctx.stroke();

      // Head, tinted by the hottest chamber on the bank.
      ctx.beginPath();
      ctx.moveTo(...point(top, halfBore * 1.12));
      ctx.lineTo(...point(headTop, halfBore * 1.12));
      ctx.lineTo(...point(headTop, -halfBore * 1.12));
      ctx.lineTo(...point(top, -halfBore * 1.12));
      ctx.closePath();
      ctx.fillStyle = this.theme.metalDark;
      ctx.fill();
      if (heat > 0.02) {
        ctx.save();
        ctx.globalAlpha = heat * 0.35;
        ctx.fillStyle = this.theme.hot;
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = this.theme.metal;
      ctx.stroke();
    }
  }

  private drawCylinder(state: Float32Array, index: number): void {
    const info = this.info!;
    const ctx = this.ctx;
    const cylinder = info.cylinders[index];
    const bank = info.banks[cylinder.bankIndex];
    const base = cylinderOffset(index);

    const pistonX = state[base + C.PistonX];
    const pistonY = state[base + C.PistonY];
    const pistonTheta = state[base + C.PistonTheta];
    const rodX = state[base + C.RodX];
    const rodY = state[base + C.RodY];
    const rodTheta = state[base + C.RodTheta];
    const pressure = state[base + C.Pressure];

    // Combustion glow above roughly 20 atmospheres.
    const glow = Math.min(1, Math.max(0, pressure / units.pressure(40, units.atm)));

    // Rod: big end to little end, drawn as a tapered beam.
    const cos = Math.cos(rodTheta);
    const sin = Math.sin(rodTheta);
    const bigX = rodX + -sin * cylinder.bigEndLocal;
    const bigY = rodY + cos * cylinder.bigEndLocal;
    const littleX = rodX + -sin * cylinder.littleEndLocal;
    const littleY = rodY + cos * cylinder.littleEndLocal;

    const width = bank.bore * 0.16;
    const nx = (littleY - bigY) / cylinder.rodLength;
    const ny = -(littleX - bigX) / cylinder.rodLength;

    ctx.beginPath();
    ctx.moveTo(this.tx(bigX + nx * width), this.ty(bigY + ny * width));
    ctx.lineTo(this.tx(littleX + nx * width * 0.55), this.ty(littleY + ny * width * 0.55));
    ctx.lineTo(this.tx(littleX - nx * width * 0.55), this.ty(littleY - ny * width * 0.55));
    ctx.lineTo(this.tx(bigX - nx * width), this.ty(bigY - ny * width));
    ctx.closePath();
    ctx.fillStyle = this.theme.metal;
    ctx.fill();
    ctx.strokeStyle = this.theme.outline;
    ctx.lineWidth = Math.max(1, this.scale * 0.003);
    ctx.stroke();

    // Big end bearing.
    ctx.beginPath();
    ctx.arc(this.tx(bigX), this.ty(bigY), bank.bore * 0.19 * this.scale, 0, 2 * PI);
    ctx.fillStyle = this.theme.metalLight;
    ctx.fill();
    ctx.strokeStyle = this.theme.outline;
    ctx.stroke();

    // Piston.
    const halfBore = bank.bore * 0.48;
    const height = cylinder.compressionHeight * 1.6;
    const pc = Math.cos(pistonTheta);
    const ps = Math.sin(pistonTheta);

    const corner = (lx: number, ly: number): [number, number] => [
      this.tx(pistonX + pc * lx - ps * ly),
      this.ty(pistonY + ps * lx + pc * ly),
    ];

    ctx.beginPath();
    ctx.moveTo(...corner(-halfBore, -height * 0.35));
    ctx.lineTo(...corner(halfBore, -height * 0.35));
    ctx.lineTo(...corner(halfBore, height * 0.65));
    ctx.lineTo(...corner(-halfBore, height * 0.65));
    ctx.closePath();

    const gradient = ctx.createLinearGradient(
      ...corner(-halfBore, 0),
      ...corner(halfBore, 0),
    );
    gradient.addColorStop(0, this.theme.metalDark);
    gradient.addColorStop(0.5, this.theme.metalLight);
    gradient.addColorStop(1, this.theme.metalDark);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = this.theme.outline;
    ctx.stroke();

    if (glow > 0.02) {
      ctx.save();
      ctx.globalAlpha = glow * 0.85;
      ctx.fillStyle = this.theme.hot;
      ctx.beginPath();
      ctx.moveTo(...corner(-halfBore, height * 0.55));
      ctx.lineTo(...corner(halfBore, height * 0.55));
      ctx.lineTo(...corner(halfBore, height * 0.68));
      ctx.lineTo(...corner(-halfBore, height * 0.68));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCrankshaft(theta: number): void {
    const info = this.info!;
    const ctx = this.ctx;
    const radius = info.crankThrow;

    ctx.beginPath();
    ctx.arc(this.tx(0), this.ty(0), radius * 1.08 * this.scale, 0, 2 * PI);
    ctx.fillStyle = this.theme.metalDark;
    ctx.fill();
    ctx.strokeStyle = this.theme.metal;
    ctx.lineWidth = Math.max(1, this.scale * 0.004);
    ctx.stroke();

    // Counterweight, so rotation direction and angle are readable.
    ctx.save();
    ctx.translate(this.tx(0), this.ty(0));
    ctx.rotate(-theta);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.03 * this.scale, PI * 0.15, PI * 0.85);
    ctx.closePath();
    ctx.fillStyle = this.theme.metal;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(this.tx(0), this.ty(0), radius * 0.28 * this.scale, 0, 2 * PI);
    ctx.fillStyle = this.theme.metalLight;
    ctx.fill();
  }

  private drawSpinIndicator(state: Float32Array): void {
    const ctx = this.ctx;
    const info = this.info!;

    const rpm = state[S.Rpm];
    const redlineRpm = units.toRpm(info.redline);
    const fraction = Math.min(1.2, rpm / Math.max(redlineRpm, 1));

    const radius = info.crankThrow * 1.32 * this.scale;
    const cx = this.tx(0);
    const cy = this.ty(0);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, -PI * 0.5, -PI * 0.5 + fraction * PI * 1.6);
    ctx.strokeStyle = fraction >= 1 ? this.theme.hot : this.theme.accent;
    ctx.lineWidth = Math.max(2, this.scale * 0.006);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}
