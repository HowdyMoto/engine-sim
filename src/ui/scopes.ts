/**
 * Oscilloscope strip, standing in for the original's `oscilloscope_cluster`
 * and `firing_order_display`.
 *
 * Six panes: cylinder 1 pressure, valve lift and exhaust pulse against cycle
 * angle (persistent sweeps, as the original draws them), the audio waveform,
 * a dyno torque/power-vs-RPM plot that accumulates while the dyno runs, and
 * the firing-order grid.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { C, S, Sc, SCOPE_STRIDE, cylinderOffset } from '../worker/protocol';
import type { EngineInfo } from '../worker/protocol';
import type { Theme } from './renderer';

const CYCLE = 4 * PI;

/** Cycle-angle-binned persistent sweep. */
class Sweep {
  readonly values: Float32Array;
  readonly written: Uint8Array;

  constructor(readonly bins: number) {
    this.values = new Float32Array(bins);
    this.written = new Uint8Array(bins);
  }

  clear(): void {
    this.written.fill(0);
  }

  record(cycleAngle: number, value: number): void {
    let bin = Math.floor((cycleAngle / CYCLE) * this.bins);
    if (bin < 0) bin = 0;
    else if (bin >= this.bins) bin = this.bins - 1;

    this.values[bin] = value;
    this.written[bin] = 1;
  }
}

interface DynoPoint {
  rpm: number;
  torque: number;
  power: number;
}

export class ScopeCluster {
  private ctx: CanvasRenderingContext2D;
  private info: EngineInfo | null = null;

  private pressure = new Sweep(512);
  private intakeLift = new Sweep(512);
  private exhaustLift = new Sweep(512);
  private exhaustFlow = new Sweep(512);

  private audio = new Float32Array(2048);
  private audioWrite = 0;

  private dynoPoints: DynoPoint[] = [];
  private dynoWasEnabled = false;

  private litDecay: Float32Array = new Float32Array(0);

  constructor(
    private canvas: HTMLCanvasElement,
    private theme: Theme,
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
    this.pressure.clear();
    this.intakeLift.clear();
    this.exhaustLift.clear();
    this.exhaustFlow.clear();
    this.audio.fill(0);
    this.dynoPoints = [];
    this.litDecay = new Float32Array(info.cylinderCount);
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

  pushAudio(samples: Float32Array): void {
    for (let i = 0; i < samples.length; ++i) {
      this.audio[this.audioWrite] = samples[i];
      this.audioWrite = (this.audioWrite + 1) % this.audio.length;
    }
  }

  ingest(state: Float32Array, scope: Float32Array): void {
    const info = this.info;
    if (info === null) return;

    const count = scope[0];
    for (let i = 0; i < count; ++i) {
      const base = 1 + i * SCOPE_STRIDE;
      const angle = scope[base + Sc.CycleAngle];

      this.pressure.record(angle, scope[base + Sc.CylinderPressure]);
      this.intakeLift.record(angle, scope[base + Sc.IntakeLift]);
      this.exhaustLift.record(angle, scope[base + Sc.ExhaustLift]);
      this.exhaustFlow.record(angle, scope[base + Sc.ExhaustFlow]);
    }

    // Dyno curve: accumulate while the dyno is on, clear when it turns on.
    const dynoEnabled = state[S.DynoEnabled] > 0.5;
    if (dynoEnabled && !this.dynoWasEnabled) this.dynoPoints = [];
    this.dynoWasEnabled = dynoEnabled;

    if (dynoEnabled) {
      const rpm = state[S.Rpm];
      const torque = state[S.DynoTorque] / units.ft_lb;
      const power = state[S.DynoPower] / units.hp;
      if (rpm > 60 && this.dynoPoints.length < 4000) {
        this.dynoPoints.push({ rpm, torque, power });
      }
    }

    // Firing-order flashes.
    for (let i = 0; i < info.cylinderCount; ++i) {
      const lit = state[cylinderOffset(i) + C.Lit] > 0.5;
      if (lit) this.litDecay[i] = 1;
      else this.litDecay[i] *= 0.82;
    }
  }

  render(): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);
    if (this.info === null) return;

    const panes = 6;
    const gap = Math.round(width * 0.008);
    const paneWidth = (width - gap * (panes - 1)) / panes;

    let x = 0;
    this.drawSweepPane(x, 0, paneWidth, height, 'CYL 1 PRESSURE', [
      { sweep: this.pressure, color: this.theme.hot },
    ]);
    x += paneWidth + gap;

    this.drawSweepPane(x, 0, paneWidth, height, 'VALVE LIFT', [
      { sweep: this.intakeLift, color: this.theme.cold },
      { sweep: this.exhaustLift, color: this.theme.hot },
    ]);
    x += paneWidth + gap;

    this.drawSweepPane(x, 0, paneWidth, height, 'EXHAUST PULSE', [
      { sweep: this.exhaustFlow, color: this.theme.accent, centered: true },
    ]);
    x += paneWidth + gap;

    this.drawAudioPane(x, 0, paneWidth, height);
    x += paneWidth + gap;

    this.drawDynoPane(x, 0, paneWidth, height);
    x += paneWidth + gap;

    this.drawFiringOrderPane(x, 0, paneWidth, height);
  }

  private paneChrome(x: number, y: number, w: number, h: number, title: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.shadow;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = this.theme.fgDim;
    ctx.font = `500 ${Math.max(9, Math.round(h * 0.085))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 6, y + Math.max(12, h * 0.12));
  }

  private drawSweepPane(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    traces: { sweep: Sweep; color: string; centered?: boolean }[],
  ): void {
    const ctx = this.ctx;
    this.paneChrome(x, y, w, h, title);

    const top = y + h * 0.2;
    const bottom = y + h * 0.92;

    let min = Infinity;
    let max = -Infinity;
    for (const trace of traces) {
      const { values, written, bins } = trace.sweep;
      for (let i = 0; i < bins; ++i) {
        if (!written[i]) continue;
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
      }
    }

    if (!Number.isFinite(min) || max - min < 1e-12) return;

    for (const trace of traces) {
      if (trace.centered) {
        const extreme = Math.max(Math.abs(min), Math.abs(max), 1e-12);
        min = -extreme;
        max = extreme;
      }

      const { values, written, bins } = trace.sweep;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < bins; ++i) {
        if (!written[i]) {
          started = false;
          continue;
        }

        const px = x + (i / (bins - 1)) * w;
        const py = bottom - ((values[i] - min) / (max - min)) * (bottom - top);
        if (started) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        started = true;
      }

      ctx.strokeStyle = trace.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  private drawAudioPane(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    this.paneChrome(x, y, w, h, 'AUDIO');

    const mid = y + h * 0.56;
    const amp = h * 0.36;
    const n = this.audio.length;

    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const idx = (this.audioWrite + i) % n;
      const px = x + (i / (n - 1)) * w;
      const py = mid - this.audio[idx] * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = this.theme.foreground;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawDynoPane(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    this.paneChrome(x, y, w, h, 'DYNO ft-lb / hp');

    const info = this.info!;
    if (this.dynoPoints.length < 2) return;

    const maxRpm = units.toRpm(info.redline) * 1.05;
    let maxValue = 1;
    for (const point of this.dynoPoints) {
      maxValue = Math.max(maxValue, point.torque, point.power);
    }

    const top = y + h * 0.2;
    const bottom = y + h * 0.92;

    const plot = (pick: (p: DynoPoint) => number, color: string) => {
      ctx.beginPath();
      for (let i = 0; i < this.dynoPoints.length; ++i) {
        const point = this.dynoPoints[i];
        const px = x + Math.min(1, point.rpm / maxRpm) * w;
        const py = bottom - (Math.max(0, pick(point)) / maxValue) * (bottom - top);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    plot((p) => p.torque, this.theme.accent);
    plot((p) => p.power, this.theme.cold);
  }

  private drawFiringOrderPane(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    this.paneChrome(x, y, w, h, 'FIRING ORDER');

    const info = this.info!;
    const n = info.cylinderCount;

    const columns = Math.ceil(Math.sqrt(n * (w / h)));
    const rows = Math.ceil(n / columns);
    const cellW = (w * 0.86) / columns;
    const cellH = (h * 0.66) / rows;
    const originX = x + w * 0.07;
    const originY = y + h * 0.26;
    const radius = Math.min(cellW, cellH) * 0.33;

    for (let i = 0; i < n; ++i) {
      const cx = originX + (i % columns) * cellW + cellW / 2;
      const cy = originY + Math.floor(i / columns) * cellH + cellH / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * PI);
      ctx.fillStyle = this.theme.metalDark;
      ctx.fill();

      const glow = this.litDecay[i];
      if (glow > 0.02) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * PI);
        ctx.globalAlpha = glow;
        ctx.fillStyle = this.theme.accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = this.theme.fgDim;
      ctx.font = `600 ${Math.max(8, radius * 0.9)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, cy);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
