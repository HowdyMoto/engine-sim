/**
 * Instrument cluster: the tachometer, dyno gauges and the numeric readouts the
 * original shows in its right-hand gauge cluster and info panel.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { S } from '../worker/protocol';
import type { EngineInfo } from '../worker/protocol';
import type { Theme } from './renderer';

interface GaugeSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
  redline?: number;
  value: (state: Float32Array, info: EngineInfo) => number;
  /** Digits after the decimal point in the numeric readout. */
  precision?: number;
}

const GAUGES: GaugeSpec[] = [
  {
    label: 'RPM',
    unit: 'x1000',
    min: 0,
    max: 8,
    value: (state) => state[S.Rpm] / 1000,
    precision: 2,
  },
  {
    label: 'TORQUE',
    unit: 'ft-lb',
    min: 0,
    max: 600,
    value: (state) => state[S.DynoTorque] / units.ft_lb,
    precision: 0,
  },
  {
    label: 'POWER',
    unit: 'hp',
    min: 0,
    max: 600,
    value: (state) => state[S.DynoPower] / units.hp,
    precision: 0,
  },
  {
    label: 'DYNO SPEED',
    unit: 'rpm',
    min: 0,
    max: 8000,
    value: (state) => units.toRpm(state[S.DynoSpeed]),
    precision: 0,
  },
];

export class GaugeCluster {
  private ctx: CanvasRenderingContext2D;
  private info: EngineInfo | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private theme: Theme,
  ) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  setEngine(info: EngineInfo): void {
    this.info = info;

    const redlineRpm = units.toRpm(info.redline);
    GAUGES[0].max = Math.max(2, Math.ceil((redlineRpm * 1.15) / 1000));
    GAUGES[0].redline = redlineRpm / 1000;
    GAUGES[3].max = units.toRpm(info.dynoMaxSpeed) * 1.1;
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

  render(state: Float32Array): void {
    const ctx = this.ctx;
    const info = this.info;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (info === null) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.width;
    const height = this.canvas.height;

    const columns = width > height * 1.6 ? 4 : 2;
    const rows = Math.ceil(GAUGES.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const radius = Math.min(cellWidth, cellHeight) * 0.38;

    for (let i = 0; i < GAUGES.length; ++i) {
      const gauge = GAUGES[i];
      const cx = (i % columns) * cellWidth + cellWidth / 2;
      const cy = Math.floor(i / columns) * cellHeight + cellHeight / 2;

      this.drawGauge(gauge, gauge.value(state, info), cx, cy, radius, dpr);
    }
  }

  private drawGauge(
    gauge: GaugeSpec,
    value: number,
    cx: number,
    cy: number,
    radius: number,
    dpr: number,
  ): void {
    const ctx = this.ctx;

    const startAngle = PI * 0.75;
    const sweep = PI * 1.5;
    const fraction = Math.max(0, Math.min(1, (value - gauge.min) / (gauge.max - gauge.min)));

    ctx.lineCap = 'butt';

    // Track.
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
    ctx.strokeStyle = this.theme.shadow;
    ctx.lineWidth = radius * 0.22;
    ctx.stroke();

    // Redline band.
    if (gauge.redline !== undefined) {
      const redlineFraction = Math.max(
        0,
        Math.min(1, (gauge.redline - gauge.min) / (gauge.max - gauge.min)),
      );
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle + sweep * redlineFraction, startAngle + sweep);
      ctx.strokeStyle = 'rgba(255, 107, 61, 0.35)';
      ctx.lineWidth = radius * 0.22;
      ctx.stroke();
    }

    // Value.
    const overRedline = gauge.redline !== undefined && value >= gauge.redline;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep * fraction);
    ctx.strokeStyle = overRedline ? this.theme.hot : this.theme.accent;
    ctx.lineWidth = radius * 0.22;
    ctx.stroke();

    // Needle.
    const angle = startAngle + sweep * fraction;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius * 0.92, cy + Math.sin(angle) * radius * 0.92);
    ctx.strokeStyle = this.theme.foreground;
    ctx.lineWidth = Math.max(1, radius * 0.035);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.09, 0, 2 * PI);
    ctx.fillStyle = this.theme.foreground;
    ctx.fill();

    // Readout.
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.foreground;
    ctx.font = `600 ${Math.round(radius * 0.36)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText(value.toFixed(gauge.precision ?? 0), cx, cy + radius * 0.5);

    ctx.fillStyle = 'rgba(231, 236, 242, 0.55)';
    ctx.font = `500 ${Math.round(radius * 0.17)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(gauge.label, cx, cy + radius * 0.78);
    ctx.fillText(gauge.unit, cx, cy - radius * 0.42);

    void dpr;
  }
}
