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
import { C, S, crankshaftOffset, cylinderOffset, frameStateSize } from '../worker/protocol';
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
  /** Head casting color - the original paints its castings theme pink. */
  head: string;
  /** Intake-side tint (ports and valves). */
  intake: string;
  /** Exhaust-side tint (ports and valves). */
  exhaust: string;
  /** Combustion color, packed 0xRRGGBB for gradient math. */
  flame: number;
  /** Muted foreground for labels. */
  fgDim: string;
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
  head: '#c2809d',
  intake: '#77cee0',
  exhaust: '#fdbd2e',
  flame: 0xf4802a,
  fgDim: 'rgba(231, 236, 242, 0.5)',
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

  private litDecay = new Float32Array(0);

  // User camera on top of the auto-fit: zoom factor and pan in canvas pixels.
  private userZoom = 1;
  private userPanX = 0;
  private userPanY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private theme: Theme = DEFAULT_THEME,
  ) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
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
    this.litDecay = new Float32Array(info.cylinderCount);
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

      for (const s of [0, bank.deckHeight + bank.bore * 0.78]) {
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

    this.scale = Math.min(width / spanX, height / spanY) * this.userZoom;
    this.originX = width / 2 - ((minX + maxX) / 2) * this.scale + this.userPanX;
    this.originY = height / 2 + ((minY + maxY) / 2) * this.scale + this.userPanY;
  }

  /** Zoom about a canvas point (CSS pixels), keeping it fixed on screen. */
  zoomAt(cssX: number, cssY: number, factor: number): void {
    const dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    const x = cssX * dpr;
    const y = cssY * dpr;

    const nextZoom = Math.min(12, Math.max(0.4, this.userZoom * factor));
    const applied = nextZoom / this.userZoom;
    this.userZoom = nextZoom;

    // Keep the point under the cursor stationary: pan moves with the zoom.
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    this.userPanX = (this.userPanX + cx - x) * applied - (cx - x);
    this.userPanY = (this.userPanY + cy - y) * applied - (cy - y);
  }

  panBy(cssDx: number, cssDy: number): void {
    const dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    this.userPanX += cssDx * dpr;
    this.userPanY += cssDy * dpr;
  }

  resetView(): void {
    this.userZoom = 1;
    this.userPanX = 0;
    this.userPanY = 0;
  }

  isViewModified(): boolean {
    return this.userZoom !== 1 || this.userPanX !== 0 || this.userPanY !== 0;
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
    // A frame from a different engine (mid-switch) would index out of range.
    if (state.length < frameStateSize(info.cylinderCount, info.crankshaftCount)) return;

    this.updateTransform();

    const crankTheta = state[crankshaftOffset(info.cylinderCount)];

    // Ignition flashes decay over a few frames so they are visible at speed.
    for (let i = 0; i < info.cylinderCount; ++i) {
      if (state[cylinderOffset(i) + C.Lit] > 0.5) this.litDecay[i] = 1;
      else this.litDecay[i] *= 0.7;
    }

    this.drawCylinderWalls();

    // The front-most drawn cylinder on each bank is the one whose valvetrain
    // is visible, exactly as the overlapping pistons already behave.
    const bankFront = new Array<number>(info.banks.length).fill(-1);
    for (const entry of this.drawOrder) {
      if (this.layer !== -1 && entry.layer !== this.layer) continue;
      this.drawCylinder(state, entry.index);
      bankFront[entry.bankIndex] = entry.index;
    }

    for (let b = 0; b < info.banks.length; ++b) {
      if (bankFront[b] !== -1) this.drawValvetrain(state, b, bankFront[b]);
    }

    this.drawCrankshaft(crankTheta);
    this.drawSpinIndicator(state);
  }

  private drawCylinderWalls(): void {
    const info = this.info!;
    const ctx = this.ctx;

    for (let b = 0; b < info.banks.length; ++b) {
      const bank = info.banks[b];
      const dx = Math.cos(bank.angle + PI / 2);
      const dy = Math.sin(bank.angle + PI / 2);
      const px = -dy;
      const py = dx;

      const bore = bank.bore;
      const halfBore = bore / 2;
      const base = info.crankThrow * 0.85;
      const deck = bank.deckHeight;

      const point = (s: number, side: number): [number, number] => [
        this.tx(bank.x + dx * s + px * side),
        this.ty(bank.y + dy * s + py * side),
      ];

      // Bore.
      ctx.beginPath();
      ctx.moveTo(...point(base, halfBore));
      ctx.lineTo(...point(deck, halfBore));
      ctx.lineTo(...point(deck, -halfBore));
      ctx.lineTo(...point(base, -halfBore));
      ctx.closePath();
      ctx.fillStyle = this.theme.shadow;
      ctx.fill();
      ctx.lineWidth = Math.max(1, this.scale * 0.005);
      ctx.strokeStyle = this.theme.metalDark;
      ctx.stroke();

      // Head casting: a slab over the deck with a shallow pent roof.
      ctx.beginPath();
      ctx.moveTo(...point(deck, halfBore * 1.16));
      ctx.lineTo(...point(deck + bore * 0.5, halfBore * 1.16));
      ctx.lineTo(...point(deck + bore * 0.58, halfBore * 0.62));
      ctx.lineTo(...point(deck + bore * 0.58, -halfBore * 0.62));
      ctx.lineTo(...point(deck + bore * 0.5, -halfBore * 1.16));
      ctx.lineTo(...point(deck, -halfBore * 1.16));
      ctx.closePath();
      ctx.fillStyle = this.theme.head;
      ctx.fill();
      ctx.strokeStyle = this.theme.metal;
      ctx.stroke();

      // Port channels above each valve: intake tint on one side, exhaust
      // on the other.
      const intakeSide = bank.flipDisplay ? 1 : -1;
      for (const [side, tint] of [
        [intakeSide, this.theme.intake],
        [-intakeSide, this.theme.exhaust],
      ] as [number, string][]) {
        const t = side * bore * 0.24;
        ctx.beginPath();
        ctx.moveTo(...point(deck, t - bore * 0.1));
        ctx.lineTo(...point(deck + bore * 0.2, t - bore * 0.075));
        ctx.lineTo(...point(deck + bore * 0.2, t + bore * 0.075));
        ctx.lineTo(...point(deck, t + bore * 0.1));
        ctx.closePath();
        ctx.fillStyle = this.theme.shadow;
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = tint;
        ctx.fill();
        ctx.restore();
      }
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
    const temperature = state[base + C.Temperature];

    // Canvas gradients throw on non-finite coordinates (unlike every other
    // canvas call, which ignores them) - and a thrown frame kills the
    // animation loop. Whatever produced a bad pose, skip this cylinder
    // rather than take the app down with it.
    if (
      !Number.isFinite(pistonX) ||
      !Number.isFinite(pistonY) ||
      !Number.isFinite(pistonTheta) ||
      !Number.isFinite(rodX) ||
      !Number.isFinite(rodY) ||
      !Number.isFinite(rodTheta)
    ) {
      return;
    }

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

    this.drawChamberGas(index, pistonX, pistonY, pressure, temperature);
  }

  /**
   * The gas above the piston crown, tinted by temperature with opacity from
   * pressure, plus the ignition flash. This is the per-cylinder combustion
   * view the original renders as the chamber gas color.
   */
  private drawChamberGas(
    index: number,
    pistonX: number,
    pistonY: number,
    pressure: number,
    temperature: number,
  ): void {
    const info = this.info!;
    const ctx = this.ctx;
    const cylinder = info.cylinders[index];
    const bank = info.banks[cylinder.bankIndex];

    const dx = Math.cos(bank.angle + PI / 2);
    const dy = Math.sin(bank.angle + PI / 2);
    const px = -dy;
    const py = dx;

    // Piston crown position along the bank axis.
    const sPiston = (pistonX - bank.x) * dx + (pistonY - bank.y) * dy;
    const sCrown = sPiston + cylinder.compressionHeight * 1.04;
    const sDeck = bank.deckHeight;
    if (sCrown >= sDeck) return;

    const halfBore = bank.bore * 0.47;
    const point = (s: number, side: number): [number, number] => [
      this.tx(bank.x + dx * s + px * side),
      this.ty(bank.y + dy * s + py * side),
    ];

    // Temperature picks the color (cold blue -> orange -> near white),
    // pressure the opacity.
    const heat = Math.min(1, Math.max(0, (temperature - 300) / 2200));
    const alpha = Math.min(0.85, (pressure / units.pressure(35, units.atm)) * 0.85);
    const flash = this.litDecay[index];

    if (alpha > 0.01 || flash > 0.02) {
      ctx.beginPath();
      ctx.moveTo(...point(sCrown, -halfBore));
      ctx.lineTo(...point(sCrown, halfBore));
      ctx.lineTo(...point(sDeck, halfBore));
      ctx.lineTo(...point(sDeck, -halfBore));
      ctx.closePath();

      const flame = this.theme.flame;
      const fr = (flame >> 16) & 0xff;
      const fgr = (flame >> 8) & 0xff;
      const fb = flame & 0xff;
      // Cold charge to combustion color as temperature rises.
      const r = Math.round(90 + heat * (fr - 90));
      const g = Math.round(120 + heat * (fgr - 120));
      const bch = Math.round(220 + heat * (fb - 220));
      ctx.save();
      ctx.globalAlpha = Math.max(alpha, flash * 0.4);
      ctx.fillStyle = `rgb(${r}, ${g}, ${bch})`;
      ctx.fill();

      if (flash > 0.02) {
        // Spark flash washing the chamber from the plug at the head center.
        const [cx, cy] = point(sDeck, 0);
        const radius = Math.max(1, bank.bore * 0.55 * this.scale);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * flash})`);
        gradient.addColorStop(0.5, `rgba(${fr}, ${fgr}, ${fb}, ${0.6 * flash})`);
        gradient.addColorStop(1, `rgba(${fr}, ${fgr}, ${fb}, 0)`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * Valves, springs and cams for one bank, driven by the front-most drawn
   * cylinder - overlapping cylinders behind it show through exactly as the
   * pistons do. Cam rotation comes from the real lobe phase (0 = tip on the
   * follower at max lift), so timing reads correctly against the crank.
   */
  private drawValvetrain(state: Float32Array, bankIndex: number, cylinderIndex: number): void {
    const info = this.info!;
    const bank = info.banks[bankIndex];
    const base = cylinderOffset(cylinderIndex);

    const intakeSide = bank.flipDisplay ? 1 : -1;
    this.drawValveAssembly(
      bank,
      intakeSide,
      state[base + C.IntakeLift],
      bank.maxIntakeLift,
      state[base + C.IntakeCamAngle],
      this.theme.intake,
    );
    this.drawValveAssembly(
      bank,
      -intakeSide,
      state[base + C.ExhaustLift],
      bank.maxExhaustLift,
      state[base + C.ExhaustCamAngle],
      this.theme.exhaust,
    );
  }

  private drawValveAssembly(
    bank: EngineInfo['banks'][number],
    side: number,
    lift: number,
    maxLift: number,
    camAngle: number,
    tint: string,
  ): void {
    const ctx = this.ctx;
    const bore = bank.bore;
    const deck = bank.deckHeight;

    const dx = Math.cos(bank.angle + PI / 2);
    const dy = Math.sin(bank.angle + PI / 2);
    const px = -dy;
    const py = dx;

    const t = side * bore * 0.24;
    const point = (s: number, lateral: number): [number, number] => [
      this.tx(bank.x + dx * s + px * (t + lateral)),
      this.ty(bank.y + dy * s + py * (t + lateral)),
    ];

    const liftFraction = maxLift > 0 ? Math.min(1.15, lift / maxLift) : 0;
    const travel = liftFraction * bore * 0.1;

    const discHalf = bore * 0.15;
    const discThickness = bore * 0.045;
    const stemHalf = bore * 0.018;
    const stemTop = deck + bore * 0.42;

    const line = Math.max(1, this.scale * 0.003);

    // Stem, sliding down with lift.
    ctx.beginPath();
    ctx.moveTo(...point(stemTop - travel, -stemHalf));
    ctx.lineTo(...point(stemTop - travel, stemHalf));
    ctx.lineTo(...point(deck - travel + discThickness, stemHalf));
    ctx.lineTo(...point(deck - travel + discThickness, -stemHalf));
    ctx.closePath();
    ctx.fillStyle = this.theme.metalLight;
    ctx.fill();
    ctx.strokeStyle = this.theme.outline;
    ctx.lineWidth = line;
    ctx.stroke();

    // Valve head, seated at the deck when closed.
    ctx.beginPath();
    ctx.moveTo(...point(deck - travel + discThickness, -discHalf * 0.55));
    ctx.lineTo(...point(deck - travel + discThickness, discHalf * 0.55));
    ctx.lineTo(...point(deck - travel - discThickness, discHalf));
    ctx.lineTo(...point(deck - travel - discThickness, -discHalf));
    ctx.closePath();
    ctx.fillStyle = this.theme.metalLight;
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = this.theme.outline;
    ctx.stroke();

    // Spring: coils between the head seat and the retainer at the stem top.
    const seat = deck + bore * 0.2;
    const retainer = stemTop - travel;
    const coilHalf = bore * 0.05;
    const coils = 5;
    ctx.beginPath();
    ctx.moveTo(...point(seat, -coilHalf));
    for (let i = 1; i <= coils * 2; ++i) {
      const s = seat + ((retainer - seat) * i) / (coils * 2);
      ctx.lineTo(...point(s, i % 2 === 0 ? -coilHalf : coilHalf));
    }
    ctx.strokeStyle = this.theme.metal;
    ctx.lineWidth = Math.max(1, this.scale * 0.004);
    ctx.stroke();

    // Cam: base circle plus a lobe rotating with the real phase. Tip points
    // at the follower (down the bank axis) at max lift.
    const camS = deck + bore * 0.52;
    const [camX, camY] = point(camS, 0);
    const baseRadius = bore * 0.085 * this.scale;
    const tipRadius = bore * 0.165 * this.scale;

    // Engine-space angle of the lobe tip: straight down the bank axis at
    // phase 0, advancing with cam rotation. Canvas y is flipped, so the
    // engine-space angle negates.
    const downAngle = Math.atan2(-dy, -dx);
    const tipAngle = -(downAngle + camAngle);

    ctx.save();
    ctx.translate(camX, camY);
    ctx.rotate(tipAngle);

    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, 0.9, 2 * PI - 0.9);
    ctx.quadraticCurveTo(tipRadius * 0.85, -baseRadius * 0.5, tipRadius, 0);
    ctx.quadraticCurveTo(tipRadius * 0.85, baseRadius * 0.5, Math.cos(0.9) * baseRadius, Math.sin(0.9) * baseRadius);
    ctx.closePath();
    ctx.fillStyle = this.theme.metal;
    ctx.fill();
    ctx.strokeStyle = this.theme.outline;
    ctx.lineWidth = line;
    ctx.stroke();

    // Journal dot so rotation is readable even between lift events.
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.3, 0, 2 * PI);
    ctx.fillStyle = this.theme.metalDark;
    ctx.fill();
    ctx.restore();
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
