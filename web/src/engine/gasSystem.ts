/**
 * Zero-dimensional gas control volume with bulk momentum, ported from
 * `include/gas_system.h` / `src/gas_system.cpp`.
 *
 * This is the model that produces the pressure waves the exhaust audio is
 * derived from, so the arithmetic is kept identical to the original.
 *
 * State lives in a flat Float64Array rather than scalar fields. Each system
 * owns a private 18-slot array until `bindTo` re-points it at a slot inside a
 * shared buffer - WebAssembly linear memory in practice - after which the
 * JavaScript methods and the WASM kernels operate on the same doubles. When
 * kernels are registered via `setGasKernels`, the four hot operations (pair
 * flow, environment flow, velocity update, dissipation) route to them for
 * bound systems; the JavaScript implementations below remain the reference
 * and the fallback.
 */
import { R, PI } from '../core/constants';
import * as units from '../core/units';
import { clamp } from '../core/utilities';

export interface Mix {
  p_fuel: number;
  p_inert: number;
  p_o2: number;
}

export function makeMix(p_fuel = 0.0, p_inert = 1.0, p_o2 = 0.0): Mix {
  return { p_fuel, p_inert, p_o2 };
}

export interface FlowParameters {
  k_flow: number;
  dt: number;
  direction_x: number;
  direction_y: number;
  crossSectionArea_0: number;
  crossSectionArea_1: number;
  system_0: GasSystem;
  system_1: GasSystem;
}

/** Kernel surface a WASM module provides; indices are `GasSystem.slot`s. */
export interface GasKernels {
  pairFlow(
    i0: number,
    i1: number,
    kFlow: number,
    dt: number,
    directionX: number,
    directionY: number,
    crossSectionArea0: number,
    crossSectionArea1: number,
  ): number;
  envFlow(
    i: number,
    kFlow: number,
    dt: number,
    pEnv: number,
    tEnv: number,
    pFuel: number,
    pInert: number,
    pO2: number,
  ): number;
  updateVelocity(i: number, dt: number, beta: number): void;
  dissipateExcessVelocity(i: number): void;
}

let kernels: GasKernels | null = null;

export function setGasKernels(next: GasKernels | null): void {
  kernels = next;
}

export function getGasKernels(): GasKernels | null {
  return kernels;
}

// State slot layout. WASM mirrors these offsets; keep the two in sync with
// `wasm/assembly/index.ts`.
export const GAS_STATE_STRIDE = 18;

const N_MOL = 0;
const E_K = 1;
const VOL = 2;
const MOM_X = 3;
const MOM_Y = 4;
const P_FUEL = 5;
const P_INERT = 6;
const P_O2 = 7;
const DOF = 8;
const HCR = 9;
const INV_HCR = 10;
const HALF_DOF = 11;
const CHOKED_LIMIT = 12;
const CHOKED_RATE = 13;
const WIDTH = 14;
const HEIGHT = 15;
const DIR_X = 16;
const DIR_Y = 17;

export class GasSystem {
  /** State slots; a private array until bound to shared memory. */
  private s: Float64Array;

  /** Index into the shared kernel buffer, or -1 while unbound. */
  slot = -1;

  constructor() {
    this.s = new Float64Array(GAS_STATE_STRIDE);
    this.s[P_INERT] = 1.0;
    this.s[DOF] = 5;
    this.s[HCR] = GasSystem.heatCapacityRatioOf(5);
    this.s[INV_HCR] = 1 / this.s[HCR];
    this.s[HALF_DOF] = 2.5;
  }

  /**
   * Move this system's state into `buffer` at `slot`, so kernels and JS share
   * it. Call after `initialize`; the current values are copied across.
   */
  bindTo(buffer: Float64Array, slot: number): void {
    const view = buffer.subarray(slot * GAS_STATE_STRIDE, (slot + 1) * GAS_STATE_STRIDE);
    view.set(this.s);
    this.s = view;
    this.slot = slot;
  }

  // ---- Field accessors ----------------------------------------------------

  get n_mol(): number {
    return this.s[N_MOL];
  }

  set n_mol(v: number) {
    this.s[N_MOL] = v;
  }

  get E_k(): number {
    return this.s[E_K];
  }

  set E_k(v: number) {
    this.s[E_K] = v;
  }

  get V(): number {
    return this.s[VOL];
  }

  set V(v: number) {
    this.s[VOL] = v;
  }

  get momentum_x(): number {
    return this.s[MOM_X];
  }

  set momentum_x(v: number) {
    this.s[MOM_X] = v;
  }

  get momentum_y(): number {
    return this.s[MOM_Y];
  }

  set momentum_y(v: number) {
    this.s[MOM_Y] = v;
  }

  get p_fuel(): number {
    return this.s[P_FUEL];
  }

  set p_fuel(v: number) {
    this.s[P_FUEL] = v;
  }

  get p_inert(): number {
    return this.s[P_INERT];
  }

  set p_inert(v: number) {
    this.s[P_INERT] = v;
  }

  get p_o2(): number {
    return this.s[P_O2];
  }

  set p_o2(v: number) {
    this.s[P_O2] = v;
  }

  get degreesOfFreedom(): number {
    return this.s[DOF];
  }

  // ---- Setup --------------------------------------------------------------

  setGeometry(width: number, height: number, dx: number, dy: number): void {
    this.s[WIDTH] = width;
    this.s[HEIGHT] = height;
    this.s[DIR_X] = dx;
    this.s[DIR_Y] = dy;
  }

  initialize(P: number, V: number, T: number, mix?: Mix, degreesOfFreedom = 5): void {
    const s = this.s;
    s[DOF] = degreesOfFreedom;
    s[HCR] = GasSystem.heatCapacityRatioOf(degreesOfFreedom);
    s[INV_HCR] = 1 / s[HCR];
    s[HALF_DOF] = 0.5 * degreesOfFreedom;
    s[N_MOL] = (P * V) / (R * T);
    s[VOL] = V;
    s[E_K] = T * (0.5 * degreesOfFreedom * s[N_MOL] * R);
    this.setMix(mix);
    s[MOM_X] = s[MOM_Y] = 0;

    s[CHOKED_LIMIT] = GasSystem.chokedFlowLimit(degreesOfFreedom);
    s[CHOKED_RATE] = GasSystem.chokedFlowRate(degreesOfFreedom);
  }

  reset(P: number, T: number, mix?: Mix): void {
    const s = this.s;
    s[N_MOL] = (P * s[VOL]) / (R * T);
    s[E_K] = T * (s[HALF_DOF] * s[N_MOL] * R);
    this.setMix(mix);
    s[MOM_X] = s[MOM_Y] = 0;
  }

  private setMix(mix?: Mix): void {
    if (mix === undefined) {
      this.s[P_FUEL] = 0.0;
      this.s[P_INERT] = 1.0;
      this.s[P_O2] = 0.0;
    } else {
      this.s[P_FUEL] = mix.p_fuel;
      this.s[P_INERT] = mix.p_inert;
      this.s[P_O2] = mix.p_o2;
    }
  }

  mix(): Mix {
    return { p_fuel: this.s[P_FUEL], p_inert: this.s[P_INERT], p_o2: this.s[P_O2] };
  }

  changeMix(mix: Mix): void {
    this.setMix(mix);
  }

  // ---- State changes ------------------------------------------------------

  setVolume(V: number): void {
    this.changeVolume(V - this.s[VOL]);
  }

  setN(n: number): void {
    this.s[E_K] = this.kineticEnergyOf(n);
    this.s[N_MOL] = n;
  }

  changeVolume(dV: number): void {
    const s = this.s;
    const V = s[VOL];
    const L = Math.pow(V + dV, 1 / 3.0);
    const surfaceArea = L * L;
    const dL = -dV / surfaceArea;
    const W = dL * this.pressure() * surfaceArea;

    s[VOL] += dV;
    s[E_K] += W;
  }

  changePressure(dP: number): void {
    this.s[E_K] += dP * this.s[VOL] * this.s[HALF_DOF];
  }

  changeTemperature(dT: number, n = this.n()): void {
    this.s[E_K] += dT * this.s[HALF_DOF] * n * R;
  }

  changeEnergy(dE: number): void {
    this.s[E_K] += dE;
  }

  injectFuel(n: number): void {
    const n_fuel = this.n_fuel() + n;
    this.s[P_FUEL] = n_fuel / this.n();
  }

  /**
   * Burn `n` moles of the given mixture assuming 25[O2] + 2[C8H16] ->
   * 16[CO2] + 18[H2O]. Returns the moles of fuel actually consumed.
   */
  react(n: number, mix: Mix): number {
    const s = this.s;
    const l_n_fuel = mix.p_fuel * n;
    const l_n_o2 = mix.p_o2 * n;

    const system_n_fuel = this.n_fuel();
    const system_n_o2 = this.n_o2();
    const system_n_inert = this.n_inert();
    const system_n = this.n();

    const ideal_o2_ratio = 25.0 / 2;
    const ideal_fuel_ratio = 2.0 / 25;
    const output_input_ratio = (16.0 + 18.0) / (25 + 2);

    const ideal_fuel_n = ideal_fuel_ratio * l_n_o2;
    const ideal_o2_n = ideal_o2_ratio * l_n_fuel;

    const a_n_fuel = Math.min(Math.min(system_n_fuel, l_n_fuel), ideal_fuel_n);
    const a_n_o2 = Math.min(Math.min(system_n_o2, l_n_o2), ideal_o2_n);

    const reactants_n = a_n_fuel + a_n_o2;
    const products_n = output_input_ratio * reactants_n;
    const dn = products_n - reactants_n;

    s[N_MOL] += dn;

    const new_system_n_fuel = system_n_fuel - a_n_fuel;
    const new_system_n_o2 = system_n_o2 - a_n_o2;
    const new_system_n_inert = system_n_inert + products_n;
    const new_system_n = system_n + dn;

    if (new_system_n !== 0) {
      s[P_FUEL] = new_system_n_fuel / new_system_n;
      s[P_INERT] = new_system_n_inert / new_system_n;
      s[P_O2] = new_system_n_o2 / new_system_n;
    } else {
      s[P_FUEL] = s[P_INERT] = s[P_O2] = 0;
    }

    return a_n_fuel;
  }

  // ---- Static flow math ---------------------------------------------------

  static flowConstant(
    targetFlowRate: number,
    P: number,
    pressureDrop: number,
    T: number,
    hcr: number,
  ): number {
    const T_0 = T;
    const p_0 = P;
    const p_T = P - pressureDrop;

    const chokedLimit = Math.pow(2.0 / (hcr + 1), hcr / (hcr - 1));
    const p_ratio = p_T / p_0;

    let flowRate: number;
    if (p_ratio <= chokedLimit) {
      flowRate = Math.sqrt(hcr);
      flowRate *= Math.pow(2 / (hcr + 1), (hcr + 1) / (2 * (hcr - 1)));
    } else {
      flowRate = (2 * hcr) / (hcr - 1);
      flowRate *= 1 - Math.pow(p_ratio, (hcr - 1) / hcr);
      flowRate = Math.sqrt(flowRate);
      flowRate *= Math.pow(p_ratio, 1 / hcr);
    }

    flowRate *= p_0 / Math.sqrt(R * T_0);

    return targetFlowRate / flowRate;
  }

  /** Flow coefficient from a flow bench figure measured at 28 inH2O. */
  static k_28inH2O(flowRateScfm: number): number {
    return GasSystem.flowConstant(
      units.flow(flowRateScfm, units.scfm),
      units.pressure(1.0, units.atm),
      units.pressure(28.0, units.inH2O),
      units.celcius(25),
      GasSystem.heatCapacityRatioOf(5),
    );
  }

  /** Flow coefficient from a carburettor CFM rating (1.5 inHg). */
  static k_carb(flowRateScfm: number): number {
    return GasSystem.flowConstant(
      units.flow(flowRateScfm, units.scfm),
      units.pressure(1.0, units.atm),
      units.pressure(1.5, units.inHg),
      units.celcius(25),
      GasSystem.heatCapacityRatioOf(5),
    );
  }

  static flowRate(
    k_flow: number,
    P0: number,
    P1: number,
    T0: number,
    T1: number,
    hcr: number,
    invHcr: number,
    chokedFlowLimit: number,
    chokedFlowRateCached: number,
  ): number {
    if (k_flow === 0) return 0;

    let direction: number;
    let T_0: number;
    let p_0: number;
    let p_T: number;

    if (P0 > P1) {
      direction = 1.0;
      T_0 = T0;
      p_0 = P0;
      p_T = P1;
    } else {
      direction = -1.0;
      T_0 = T1;
      p_0 = P1;
      p_T = P0;
    }

    const p_ratio = p_T / p_0;
    let flowRate = 0;
    if (p_ratio <= chokedFlowLimit) {
      flowRate = chokedFlowRateCached;
      flowRate /= Math.sqrt(R * T_0);
    } else {
      const s = Math.pow(p_ratio, invHcr);
      flowRate = (2 * hcr) / (hcr - 1);
      flowRate *= s * (s - p_ratio);
      flowRate = Math.sqrt(Math.max(flowRate, 0.0) / (R * T_0));
    }

    flowRate *= direction * p_0;

    return flowRate * k_flow;
  }

  // ---- Mole transfer ------------------------------------------------------

  loseN(dn: number, E_k_per_mol: number): number {
    const s = this.s;
    s[E_K] -= E_k_per_mol * dn;
    s[N_MOL] -= dn;
    if (s[N_MOL] < 0) s[N_MOL] = 0;
    return dn;
  }

  gainN(dn: number, E_k_per_mol: number, mix?: Mix): number {
    if (mix === undefined) return this.gainNRaw(dn, E_k_per_mol, 0, 1, 0);
    return this.gainNRaw(dn, E_k_per_mol, mix.p_fuel, mix.p_inert, mix.p_o2);
  }

  /** Allocation-free form of `gainN`, used on the per-substep flow path. */
  gainNRaw(
    dn: number,
    E_k_per_mol: number,
    p_fuel: number,
    p_inert: number,
    p_o2: number,
  ): number {
    const s = this.s;
    const current_n = s[N_MOL];
    const next_n = current_n + dn;

    s[E_K] += dn * E_k_per_mol;
    s[N_MOL] = next_n;

    if (next_n !== 0) {
      const inv = 1 / next_n;
      s[P_FUEL] = (s[P_FUEL] * current_n + dn * p_fuel) * inv;
      s[P_INERT] = (s[P_INERT] * current_n + dn * p_inert) * inv;
      s[P_O2] = (s[P_O2] * current_n + dn * p_o2) * inv;
    } else {
      s[P_FUEL] = s[P_INERT] = s[P_O2] = 0;
    }

    return -dn;
  }

  // ---- Velocity handling --------------------------------------------------

  /** Clamp bulk velocity to the local speed of sound, returning the energy to heat. */
  dissipateExcessVelocity(): void {
    if (kernels !== null && this.slot >= 0) {
      kernels.dissipateExcessVelocity(this.slot);
      return;
    }

    this.dissipateExcessVelocityJs();
  }

  dissipateExcessVelocityJs(): void {
    const s = this.s;
    const n_mol = s[N_MOL];
    if (n_mol === 0) return;

    const mass = units.AirMolecularMass * n_mol;
    const invMass = 1 / mass;
    const v_x = s[MOM_X] * invMass;
    const v_y = s[MOM_Y] * invMass;
    const v_squared = v_x * v_x + v_y * v_y;

    if (v_squared === 0) return;

    const c_squared = s[E_K] !== 0 ? (s[HCR] * s[E_K]) / (s[HALF_DOF] * mass) : 0;
    if (c_squared >= v_squared) return;

    const k = Math.sqrt(c_squared / v_squared);

    s[MOM_X] *= k;
    s[MOM_Y] *= k;

    s[E_K] += 0.5 * mass * (v_squared - c_squared);
    if (s[E_K] < 0) s[E_K] = 0;
  }

  /** Accelerate the bulk gas by its own dynamic pressure imbalance. */
  updateVelocity(dt: number, beta = 1.0): void {
    if (kernels !== null && this.slot >= 0) {
      kernels.updateVelocity(this.slot, dt, beta);
      return;
    }

    this.updateVelocityJs(dt, beta);
  }

  updateVelocityJs(dt: number, beta = 1.0): void {
    const s = this.s;
    if (s[N_MOL] === 0) return;

    const depth = s[VOL] / (s[WIDTH] * s[HEIGHT]);
    const dx = s[DIR_X];
    const dy = s[DIR_Y];

    let d_momentum_x = 0;
    let d_momentum_y = 0;

    const p0 = this.dynamicPressure(dx, dy);
    const p1 = this.dynamicPressure(-dx, -dy);
    const p2 = this.dynamicPressure(dy, dx);
    const p3 = this.dynamicPressure(-dy, -dx);

    const p_sa_0 = p0 * (s[HEIGHT] * depth);
    const p_sa_1 = p1 * (s[HEIGHT] * depth);
    const p_sa_2 = p2 * (s[WIDTH] * depth);
    const p_sa_3 = p3 * (s[WIDTH] * depth);

    d_momentum_x += p_sa_0 * dx;
    d_momentum_y += p_sa_0 * dy;

    d_momentum_x -= p_sa_1 * dx;
    d_momentum_y -= p_sa_1 * dy;

    d_momentum_x += p_sa_2 * dy;
    d_momentum_y += p_sa_2 * dx;

    d_momentum_x -= p_sa_3 * dy;
    d_momentum_y -= p_sa_3 * dx;

    const m = units.AirMolecularMass * s[N_MOL];
    const inv_m = 1 / m;
    const v0_x = s[MOM_X] * inv_m;
    const v0_y = s[MOM_Y] * inv_m;

    s[MOM_X] -= d_momentum_x * dt * beta;
    s[MOM_Y] -= d_momentum_y * dt * beta;

    const v1_x = s[MOM_X] * inv_m;
    const v1_y = s[MOM_Y] * inv_m;

    s[E_K] -= 0.5 * m * (v1_x * v1_x - v0_x * v0_x);
    s[E_K] -= 0.5 * m * (v1_y * v1_y - v0_y * v0_y);

    if (s[E_K] < 0) s[E_K] = 0;
  }

  dissipateVelocity(dt: number, timeConstant: number): void {
    const s = this.s;
    if (s[N_MOL] === 0) return;

    const invMass = 1.0 / this.mass();
    const velocity_x = s[MOM_X] * invMass;
    const velocity_y = s[MOM_Y] * invMass;
    const velocity_squared = velocity_x * velocity_x + velocity_y * velocity_y;

    const f = dt / (dt + timeConstant);
    s[MOM_X] = s[MOM_X] * (1 - f);
    s[MOM_Y] = s[MOM_Y] * (1 - f);

    const newVelocity_x = s[MOM_X] * invMass;
    const newVelocity_y = s[MOM_Y] * invMass;
    const newVelocity_squared = newVelocity_x * newVelocity_x + newVelocity_y * newVelocity_y;

    s[E_K] += 0.5 * this.mass() * (velocity_squared - newVelocity_squared);
  }

  // ---- Flows --------------------------------------------------------------

  /** Flow between two systems; returns signed moles moved from system_0 to system_1. */
  static flow(params: FlowParameters): number {
    // A closed valve has a flow coefficient of exactly zero, which is most of
    // the cycle for the port flows. With no mass moving, the momentum and
    // energy stages below are all no-ops, so skip straight out.
    if (params.k_flow === 0) return 0;

    if (kernels !== null && params.system_0.slot >= 0 && params.system_1.slot >= 0) {
      return kernels.pairFlow(
        params.system_0.slot,
        params.system_1.slot,
        params.k_flow,
        params.dt,
        params.direction_x,
        params.direction_y,
        params.crossSectionArea_0,
        params.crossSectionArea_1,
      );
    }

    return GasSystem.flowJs(params);
  }

  static flowJs(params: FlowParameters): number {
    let source: GasSystem;
    let sink: GasSystem;
    let sourcePressure: number;
    let sinkPressure: number;
    let dx: number;
    let dy: number;
    let sourceCrossSection: number;
    let sinkCrossSection: number;
    let direction: number;

    const P_0 =
      params.system_0.pressure() +
      params.system_0.dynamicPressure(params.direction_x, params.direction_y);
    const P_1 =
      params.system_1.pressure() +
      params.system_1.dynamicPressure(-params.direction_x, -params.direction_y);

    if (P_0 > P_1) {
      dx = params.direction_x;
      dy = params.direction_y;
      source = params.system_0;
      sink = params.system_1;
      sourcePressure = P_0;
      sinkPressure = P_1;
      sourceCrossSection = params.crossSectionArea_0;
      sinkCrossSection = params.crossSectionArea_1;
      direction = 1.0;
    } else {
      dx = -params.direction_x;
      dy = -params.direction_y;
      source = params.system_1;
      sink = params.system_0;
      sourcePressure = P_1;
      sinkPressure = P_0;
      sourceCrossSection = params.crossSectionArea_1;
      sinkCrossSection = params.crossSectionArea_0;
      direction = -1.0;
    }

    const ss = source.s;
    const ks = sink.s;

    let flow =
      params.dt *
      GasSystem.flowRate(
        params.k_flow,
        sourcePressure,
        sinkPressure,
        source.temperature(),
        sink.temperature(),
        ss[HCR],
        ss[INV_HCR],
        ss[CHOKED_LIMIT],
        ss[CHOKED_RATE],
      );

    const source_n = ss[N_MOL];
    flow = clamp(flow, 0.0, 0.9 * source_n);

    const fraction = source_n !== 0 ? flow / source_n : 0;
    const fractionVolume = fraction * ss[VOL];
    const fractionMass = fraction * source.mass();

    if (flow !== 0) {
      // Stage 1: the fraction moves from source to sink, carrying its momentum.
      const E_k_bulk_src0 = source.bulkKineticEnergy();
      const E_k_bulk_sink0 = sink.bulkKineticEnergy();

      const E_k_per_mol = source.kineticEnergyPerMol();
      sink.gainNRaw(flow, E_k_per_mol, ss[P_FUEL], ss[P_INERT], ss[P_O2]);
      source.loseN(flow, E_k_per_mol);

      const dp_x = ss[MOM_X] * fraction;
      const dp_y = ss[MOM_Y] * fraction;
      ss[MOM_X] -= dp_x;
      ss[MOM_Y] -= dp_y;

      ks[MOM_X] += dp_x;
      ks[MOM_Y] += dp_y;

      const E_k_bulk_src1 = source.bulkKineticEnergy();
      const E_k_bulk_sink1 = sink.bulkKineticEnergy();

      ks[E_K] -= E_k_bulk_src1 + E_k_bulk_sink1 - (E_k_bulk_src0 + E_k_bulk_sink0);
    }

    const sourceMass = source.mass();
    const invSourceMass = 1 / sourceMass;
    const sinkMass = sink.mass();
    const invSinkMass = 1 / sinkMass;

    const c_source = source.c();
    const c_sink = sink.c();

    const sourceInitialMomentum_x = ss[MOM_X];
    const sourceInitialMomentum_y = ss[MOM_Y];
    const sinkInitialMomentum_x = ks[MOM_X];
    const sinkInitialMomentum_y = ks[MOM_Y];

    // Stage 2: the moving fraction imparts momentum through each port.
    if (sinkCrossSection !== 0) {
      const sinkFractionVelocity = clamp(
        fractionVolume / sinkCrossSection / params.dt,
        0.0,
        c_sink,
      );
      ks[MOM_X] += sinkFractionVelocity * dx * fractionMass;
      ks[MOM_Y] += sinkFractionVelocity * dy * fractionMass;
    }

    if (sourceCrossSection !== 0 && sourceMass !== 0) {
      const sourceFractionVelocity = clamp(
        fractionVolume / sourceCrossSection / params.dt,
        0.0,
        c_source,
      );
      ss[MOM_X] += sourceFractionVelocity * dx * fractionMass;
      ss[MOM_Y] += sourceFractionVelocity * dy * fractionMass;
    }

    if (sourceMass !== 0) {
      const sourceVelocity0_x = sourceInitialMomentum_x * invSourceMass;
      const sourceVelocity0_y = sourceInitialMomentum_y * invSourceMass;
      const sourceVelocity1_x = ss[MOM_X] * invSourceMass;
      const sourceVelocity1_y = ss[MOM_Y] * invSourceMass;

      ss[E_K] -=
        0.5 *
        sourceMass *
        (sourceVelocity1_x * sourceVelocity1_x - sourceVelocity0_x * sourceVelocity0_x);
      ss[E_K] -=
        0.5 *
        sourceMass *
        (sourceVelocity1_y * sourceVelocity1_y - sourceVelocity0_y * sourceVelocity0_y);
    }

    if (sinkMass > 0) {
      const sinkVelocity0_x = sinkInitialMomentum_x * invSinkMass;
      const sinkVelocity0_y = sinkInitialMomentum_y * invSinkMass;
      const sinkVelocity1_x = ks[MOM_X] * invSinkMass;
      const sinkVelocity1_y = ks[MOM_Y] * invSinkMass;

      ks[E_K] -=
        0.5 * sinkMass * (sinkVelocity1_x * sinkVelocity1_x - sinkVelocity0_x * sinkVelocity0_x);
      ks[E_K] -=
        0.5 * sinkMass * (sinkVelocity1_y * sinkVelocity1_y - sinkVelocity0_y * sinkVelocity0_y);
    }

    if (ks[E_K] < 0) ks[E_K] = 0;
    if (ss[E_K] < 0) ss[E_K] = 0;

    return flow * direction;
  }

  /** Flow to or from a fixed-pressure environment (blowby, atmosphere). */
  flowEnv(k_flow: number, dt: number, P_env: number, T_env: number, mix?: Mix): number {
    if (k_flow === 0) return 0;

    if (kernels !== null && this.slot >= 0) {
      return kernels.envFlow(
        this.slot,
        k_flow,
        dt,
        P_env,
        T_env,
        mix?.p_fuel ?? 0,
        mix?.p_inert ?? 1,
        mix?.p_o2 ?? 0,
      );
    }

    return this.flowEnvJs(k_flow, dt, P_env, T_env, mix);
  }

  flowEnvJs(k_flow: number, dt: number, P_env: number, T_env: number, mix?: Mix): number {
    const s = this.s;
    const maxFlow = this.pressureEquilibriumMaxFlowEnv(P_env, T_env);
    let flow =
      dt *
      GasSystem.flowRate(
        k_flow,
        this.pressure(),
        P_env,
        this.temperature(),
        T_env,
        s[HCR],
        s[INV_HCR],
        s[CHOKED_LIMIT],
        s[CHOKED_RATE],
      );

    if (Math.abs(flow) > Math.abs(maxFlow)) {
      flow = maxFlow;
    }

    if (flow < 0) {
      const bulk_E_k_0 = this.bulkKineticEnergy();
      this.gainNRaw(
        -flow,
        GasSystem.kineticEnergyPerMolAt(T_env, s[DOF]),
        mix?.p_fuel ?? 0,
        mix?.p_inert ?? 1,
        mix?.p_o2 ?? 0,
      );
      const bulk_E_k_1 = this.bulkKineticEnergy();
      s[E_K] += bulk_E_k_1 - bulk_E_k_0;
    } else {
      const starting_n = this.n();
      this.loseN(flow, this.kineticEnergyPerMol());

      if (starting_n !== 0) {
        s[MOM_X] -= (flow / starting_n) * s[MOM_X];
        s[MOM_Y] -= (flow / starting_n) * s[MOM_Y];
      }
    }

    return flow;
  }

  pressureEquilibriumMaxFlow(b: GasSystem): number {
    if (this.pressure() > b.pressure()) {
      const maxFlow =
        (b.volume() * this.kineticEnergy() - this.volume() * b.kineticEnergy()) /
        (b.volume() * this.kineticEnergyPerMol() + this.volume() * this.kineticEnergyPerMol());
      return Math.max(0.0, Math.min(maxFlow, this.n()));
    }

    const maxFlow =
      (b.volume() * this.kineticEnergy() - this.volume() * b.kineticEnergy()) /
      (b.volume() * b.kineticEnergyPerMol() + this.volume() * b.kineticEnergyPerMol());
    return Math.min(0.0, Math.max(maxFlow, -b.n()));
  }

  pressureEquilibriumMaxFlowEnv(P_env: number, T_env: number): number {
    const s = this.s;
    if (this.pressure() > P_env) {
      return -(P_env * (s[HALF_DOF] * s[VOL]) - s[E_K]) / this.kineticEnergyPerMol();
    }

    const E_k_per_mol_env = T_env * R * s[HALF_DOF];
    return -(P_env * (s[HALF_DOF] * s[VOL]) - s[E_K]) / E_k_per_mol_env;
  }

  // ---- Derived quantities -------------------------------------------------

  static kineticEnergyPerMolAt(T: number, degreesOfFreedom: number): number {
    return 0.5 * T * R * degreesOfFreedom;
  }

  static heatCapacityRatioOf(degreesOfFreedom: number): number {
    return 1.0 + 2.0 / degreesOfFreedom;
  }

  static chokedFlowLimit(degreesOfFreedom: number): number {
    const hcr = GasSystem.heatCapacityRatioOf(degreesOfFreedom);
    return Math.pow(2.0 / (hcr + 1), hcr / (hcr - 1));
  }

  static chokedFlowRate(degreesOfFreedom: number): number {
    const hcr = GasSystem.heatCapacityRatioOf(degreesOfFreedom);
    return Math.sqrt(hcr) * Math.pow(2 / (hcr + 1), (hcr + 1) / (2 * (hcr - 1)));
  }

  heatCapacityRatio(): number {
    return this.s[HCR];
  }

  approximateDensity(): number {
    return (units.AirMolecularMass * this.n()) / this.volume();
  }

  n(): number {
    return this.s[N_MOL];
  }

  kineticEnergy(): number {
    return this.s[E_K];
  }

  kineticEnergyOf(n: number): number {
    return (this.kineticEnergy() / this.n()) * n;
  }

  kineticEnergyPerMol(): number {
    return this.s[N_MOL] !== 0 ? this.s[E_K] / this.s[N_MOL] : 0;
  }

  /**
   * Local speed of sound.
   *
   * `pressure / density` reduces to `E_k / (halfDof * mass)`, so the volume
   * term cancels and this needs a single division.
   */
  c(): number {
    const s = this.s;
    if (s[N_MOL] === 0 || s[E_K] === 0) return 0;
    const mass = units.AirMolecularMass * s[N_MOL];
    return Math.sqrt((s[HCR] * s[E_K]) / (s[HALF_DOF] * mass));
  }

  totalEnergy(): number {
    if (this.n() === 0) return 0;

    const invMass = 1 / this.mass();
    const v_x = this.s[MOM_X] * invMass;
    const v_y = this.s[MOM_Y] * invMass;

    return this.kineticEnergy() + 0.5 * this.mass() * (v_x * v_x + v_y * v_y);
  }

  bulkKineticEnergy(): number {
    const s = this.s;
    const m = units.AirMolecularMass * s[N_MOL];
    if (m === 0) return 0;

    return (0.5 * (s[MOM_X] * s[MOM_X] + s[MOM_Y] * s[MOM_Y])) / m;
  }

  /** Compressible stagnation pressure rise along the (dx, dy) direction. */
  dynamicPressure(dx: number, dy: number): number {
    const s = this.s;
    const n_mol = s[N_MOL];
    const E_k = s[E_K];
    if (n_mol === 0 || E_k === 0) return 0;

    const mass = units.AirMolecularMass * n_mol;
    const v = (dx * s[MOM_X] + dy * s[MOM_Y]) / mass;

    if (v <= 0) return 0;

    const hcr = s[HCR];
    const halfDof = s[HALF_DOF];
    const staticPressure = E_k / (halfDof * s[VOL]);

    // c^2 = pressure * hcr / density, and density = mass / V.
    const c_squared = (hcr * E_k) / (halfDof * mass);
    const machNumber_squared = (v * v) / c_squared;

    const x = 1 + ((hcr - 1) / 2) * machNumber_squared;
    let x_d: number;
    switch (s[DOF]) {
      case 3:
        x_d = x * x * x * x * x;
        break;
      case 5: {
        const x_2 = x * x;
        const x_3 = x_2 * x;
        x_d = x_3 * x_3 * x;
        break;
      }
      default:
        x_d = x;
    }

    return staticPressure * (Math.sqrt(x_d) - 1);
  }

  mass(): number {
    return units.AirMolecularMass * this.s[N_MOL];
  }

  pressure(): number {
    const s = this.s;
    return s[VOL] !== 0 ? s[E_K] / (s[HALF_DOF] * s[VOL]) : 0;
  }

  temperature(): number {
    const s = this.s;
    if (s[N_MOL] === 0) return 0;
    return s[E_K] / (s[HALF_DOF] * s[N_MOL] * R);
  }

  velocity_x(): number {
    if (this.n() === 0) return 0;
    return this.s[MOM_X] / this.mass();
  }

  velocity_y(): number {
    if (this.n() === 0) return 0;
    return this.s[MOM_Y] / this.mass();
  }

  volume(): number {
    return this.s[VOL];
  }

  n_fuel(): number {
    return this.s[P_FUEL] * this.n();
  }

  n_inert(): number {
    return this.s[P_INERT] * this.n();
  }

  n_o2(): number {
    return this.s[P_O2] * this.n();
  }
}

/** Convenience re-export so engine definitions can write `k_carb(700)`. */
export const k_carb = GasSystem.k_carb;
export const k_28inH2O = GasSystem.k_28inH2O;
export const circleArea = (r: number) => PI * r * r;
