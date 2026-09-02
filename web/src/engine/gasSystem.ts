/**
 * Zero-dimensional gas control volume with bulk momentum, ported from
 * `include/gas_system.h` / `src/gas_system.cpp`.
 *
 * This is the model that produces the pressure waves the exhaust audio is
 * derived from, so the arithmetic is kept identical to the original.
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

export class GasSystem {
  n_mol = 0.0;
  E_k = 0.0;
  V = 0.0;
  momentum_x = 0.0;
  momentum_y = 0.0;

  p_fuel = 0.0;
  p_inert = 1.0;
  p_o2 = 0.0;

  degreesOfFreedom = 5;

  private chokedFlowLimitCached = 0;
  private chokedFlowFactorCached = 0;

  // Cached from degreesOfFreedom; these appear in every flow evaluation.
  private hcr = GasSystem.heatCapacityRatioOf(5);
  private invHcr = 1 / GasSystem.heatCapacityRatioOf(5);
  private halfDof = 2.5;

  private width = 0.0;
  private height = 0.0;
  private dx = 0.0;
  private dy = 0.0;

  setGeometry(width: number, height: number, dx: number, dy: number): void {
    this.width = width;
    this.height = height;
    this.dx = dx;
    this.dy = dy;
  }

  initialize(P: number, V: number, T: number, mix?: Mix, degreesOfFreedom = 5): void {
    this.degreesOfFreedom = degreesOfFreedom;
    this.hcr = GasSystem.heatCapacityRatioOf(degreesOfFreedom);
    this.invHcr = 1 / this.hcr;
    this.halfDof = 0.5 * degreesOfFreedom;
    this.n_mol = (P * V) / (R * T);
    this.V = V;
    this.E_k = T * (0.5 * degreesOfFreedom * this.n_mol * R);
    this.setMix(mix);
    this.momentum_x = this.momentum_y = 0;

    this.chokedFlowLimitCached = GasSystem.chokedFlowLimit(degreesOfFreedom);
    this.chokedFlowFactorCached = GasSystem.chokedFlowRate(degreesOfFreedom);
  }

  reset(P: number, T: number, mix?: Mix): void {
    this.n_mol = (P * this.volume()) / (R * T);
    this.E_k = T * (0.5 * this.degreesOfFreedom * this.n_mol * R);
    this.setMix(mix);
    this.momentum_x = this.momentum_y = 0;
  }

  private setMix(mix?: Mix): void {
    if (mix === undefined) {
      this.p_fuel = 0.0;
      this.p_inert = 1.0;
      this.p_o2 = 0.0;
    } else {
      this.p_fuel = mix.p_fuel;
      this.p_inert = mix.p_inert;
      this.p_o2 = mix.p_o2;
    }
  }

  mix(): Mix {
    return { p_fuel: this.p_fuel, p_inert: this.p_inert, p_o2: this.p_o2 };
  }

  changeMix(mix: Mix): void {
    this.setMix(mix);
  }

  setVolume(V: number): void {
    this.changeVolume(V - this.V);
  }

  setN(n: number): void {
    this.E_k = this.kineticEnergyOf(n);
    this.n_mol = n;
  }

  changeVolume(dV: number): void {
    const V = this.volume();
    const L = Math.pow(V + dV, 1 / 3.0);
    const surfaceArea = L * L;
    const dL = -dV / surfaceArea;
    const W = dL * this.pressure() * surfaceArea;

    this.V += dV;
    this.E_k += W;
  }

  changePressure(dP: number): void {
    this.E_k += dP * this.volume() * this.degreesOfFreedom * 0.5;
  }

  changeTemperature(dT: number, n = this.n()): void {
    this.E_k += dT * 0.5 * this.degreesOfFreedom * n * R;
  }

  changeEnergy(dE: number): void {
    this.E_k += dE;
  }

  injectFuel(n: number): void {
    const n_fuel = this.n_fuel() + n;
    this.p_fuel = n_fuel / this.n();
  }

  /**
   * Burn `n` moles of the given mixture assuming 25[O2] + 2[C8H16] ->
   * 16[CO2] + 18[H2O]. Returns the moles of fuel actually consumed.
   */
  react(n: number, mix: Mix): number {
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

    this.n_mol += dn;

    const new_system_n_fuel = system_n_fuel - a_n_fuel;
    const new_system_n_o2 = system_n_o2 - a_n_o2;
    const new_system_n_inert = system_n_inert + products_n;
    const new_system_n = system_n + dn;

    if (new_system_n !== 0) {
      this.p_fuel = new_system_n_fuel / new_system_n;
      this.p_inert = new_system_n_inert / new_system_n;
      this.p_o2 = new_system_n_o2 / new_system_n;
    } else {
      this.p_fuel = this.p_inert = this.p_o2 = 0;
    }

    return a_n_fuel;
  }

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

  loseN(dn: number, E_k_per_mol: number): number {
    this.E_k -= E_k_per_mol * dn;
    this.n_mol -= dn;
    if (this.n_mol < 0) this.n_mol = 0;
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
    const current_n = this.n_mol;
    const next_n = current_n + dn;

    this.E_k += dn * E_k_per_mol;
    this.n_mol = next_n;

    if (next_n !== 0) {
      const inv = 1 / next_n;
      this.p_fuel = (this.p_fuel * current_n + dn * p_fuel) * inv;
      this.p_inert = (this.p_inert * current_n + dn * p_inert) * inv;
      this.p_o2 = (this.p_o2 * current_n + dn * p_o2) * inv;
    } else {
      this.p_fuel = this.p_inert = this.p_o2 = 0;
    }

    return -dn;
  }

  /** Clamp bulk velocity to the local speed of sound, returning the energy to heat. */
  dissipateExcessVelocity(): void {
    const n_mol = this.n_mol;
    if (n_mol === 0) return;

    const mass = units.AirMolecularMass * n_mol;
    const invMass = 1 / mass;
    const v_x = this.momentum_x * invMass;
    const v_y = this.momentum_y * invMass;
    const v_squared = v_x * v_x + v_y * v_y;

    if (v_squared === 0) return;

    const c_squared = this.E_k !== 0 ? (this.hcr * this.E_k) / (this.halfDof * mass) : 0;
    if (c_squared >= v_squared) return;

    const k = Math.sqrt(c_squared / v_squared);

    this.momentum_x *= k;
    this.momentum_y *= k;

    this.E_k += 0.5 * mass * (v_squared - c_squared);
    if (this.E_k < 0) this.E_k = 0;
  }

  /** Accelerate the bulk gas by its own dynamic pressure imbalance. */
  updateVelocity(dt: number, beta = 1.0): void {
    if (this.n_mol === 0) return;

    const depth = this.V / (this.width * this.height);

    let d_momentum_x = 0;
    let d_momentum_y = 0;

    const p0 = this.dynamicPressure(this.dx, this.dy);
    const p1 = this.dynamicPressure(-this.dx, -this.dy);
    const p2 = this.dynamicPressure(this.dy, this.dx);
    const p3 = this.dynamicPressure(-this.dy, -this.dx);

    const p_sa_0 = p0 * (this.height * depth);
    const p_sa_1 = p1 * (this.height * depth);
    const p_sa_2 = p2 * (this.width * depth);
    const p_sa_3 = p3 * (this.width * depth);

    d_momentum_x += p_sa_0 * this.dx;
    d_momentum_y += p_sa_0 * this.dy;

    d_momentum_x -= p_sa_1 * this.dx;
    d_momentum_y -= p_sa_1 * this.dy;

    d_momentum_x += p_sa_2 * this.dy;
    d_momentum_y += p_sa_2 * this.dx;

    d_momentum_x -= p_sa_3 * this.dy;
    d_momentum_y -= p_sa_3 * this.dx;

    const m = units.AirMolecularMass * this.n_mol;
    const inv_m = 1 / m;
    const v0_x = this.momentum_x * inv_m;
    const v0_y = this.momentum_y * inv_m;

    this.momentum_x -= d_momentum_x * dt * beta;
    this.momentum_y -= d_momentum_y * dt * beta;

    const v1_x = this.momentum_x * inv_m;
    const v1_y = this.momentum_y * inv_m;

    this.E_k -= 0.5 * m * (v1_x * v1_x - v0_x * v0_x);
    this.E_k -= 0.5 * m * (v1_y * v1_y - v0_y * v0_y);

    if (this.E_k < 0) this.E_k = 0;
  }

  dissipateVelocity(dt: number, timeConstant: number): void {
    if (this.n() === 0) return;

    const invMass = 1.0 / this.mass();
    const velocity_x = this.momentum_x * invMass;
    const velocity_y = this.momentum_y * invMass;
    const velocity_squared = velocity_x * velocity_x + velocity_y * velocity_y;

    const s = dt / (dt + timeConstant);
    this.momentum_x = this.momentum_x * (1 - s);
    this.momentum_y = this.momentum_y * (1 - s);

    const newVelocity_x = this.momentum_x * invMass;
    const newVelocity_y = this.momentum_y * invMass;
    const newVelocity_squared = newVelocity_x * newVelocity_x + newVelocity_y * newVelocity_y;

    this.E_k += 0.5 * this.mass() * (velocity_squared - newVelocity_squared);
  }

  /** Flow between two systems; returns signed moles moved from system_0 to system_1. */
  static flow(params: FlowParameters): number {
    // A closed valve has a flow coefficient of exactly zero, which is most of
    // the cycle for the port flows. With no mass moving, the momentum and
    // energy stages below are all no-ops, so skip straight out.
    if (params.k_flow === 0) return 0;

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

    let flow =
      params.dt *
      GasSystem.flowRate(
        params.k_flow,
        sourcePressure,
        sinkPressure,
        source.temperature(),
        sink.temperature(),
        source.hcr,
        source.invHcr,
        source.chokedFlowLimitCached,
        source.chokedFlowFactorCached,
      );

    const source_n = source.n_mol;
    flow = clamp(flow, 0.0, 0.9 * source_n);

    const fraction = source_n !== 0 ? flow / source_n : 0;
    const fractionVolume = fraction * source.V;
    const fractionMass = fraction * source.mass();

    if (flow !== 0) {
      // Stage 1: the fraction moves from source to sink, carrying its momentum.
      const E_k_bulk_src0 = source.bulkKineticEnergy();
      const E_k_bulk_sink0 = sink.bulkKineticEnergy();

      const E_k_per_mol = source.kineticEnergyPerMol();
      sink.gainNRaw(flow, E_k_per_mol, source.p_fuel, source.p_inert, source.p_o2);
      source.loseN(flow, E_k_per_mol);

      const dp_x = source.momentum_x * fraction;
      const dp_y = source.momentum_y * fraction;
      source.momentum_x -= dp_x;
      source.momentum_y -= dp_y;

      sink.momentum_x += dp_x;
      sink.momentum_y += dp_y;

      const E_k_bulk_src1 = source.bulkKineticEnergy();
      const E_k_bulk_sink1 = sink.bulkKineticEnergy();

      sink.E_k -= E_k_bulk_src1 + E_k_bulk_sink1 - (E_k_bulk_src0 + E_k_bulk_sink0);
    }

    const sourceMass = source.mass();
    const invSourceMass = 1 / sourceMass;
    const sinkMass = sink.mass();
    const invSinkMass = 1 / sinkMass;

    const c_source = source.c();
    const c_sink = sink.c();

    const sourceInitialMomentum_x = source.momentum_x;
    const sourceInitialMomentum_y = source.momentum_y;
    const sinkInitialMomentum_x = sink.momentum_x;
    const sinkInitialMomentum_y = sink.momentum_y;

    // Stage 2: the moving fraction imparts momentum through each port.
    if (sinkCrossSection !== 0) {
      const sinkFractionVelocity = clamp(
        fractionVolume / sinkCrossSection / params.dt,
        0.0,
        c_sink,
      );
      sink.momentum_x += sinkFractionVelocity * dx * fractionMass;
      sink.momentum_y += sinkFractionVelocity * dy * fractionMass;
    }

    if (sourceCrossSection !== 0 && sourceMass !== 0) {
      const sourceFractionVelocity = clamp(
        fractionVolume / sourceCrossSection / params.dt,
        0.0,
        c_source,
      );
      source.momentum_x += sourceFractionVelocity * dx * fractionMass;
      source.momentum_y += sourceFractionVelocity * dy * fractionMass;
    }

    if (sourceMass !== 0) {
      const sourceVelocity0_x = sourceInitialMomentum_x * invSourceMass;
      const sourceVelocity0_y = sourceInitialMomentum_y * invSourceMass;
      const sourceVelocity1_x = source.momentum_x * invSourceMass;
      const sourceVelocity1_y = source.momentum_y * invSourceMass;

      source.E_k -=
        0.5 * sourceMass * (sourceVelocity1_x * sourceVelocity1_x - sourceVelocity0_x * sourceVelocity0_x);
      source.E_k -=
        0.5 * sourceMass * (sourceVelocity1_y * sourceVelocity1_y - sourceVelocity0_y * sourceVelocity0_y);
    }

    if (sinkMass > 0) {
      const sinkVelocity0_x = sinkInitialMomentum_x * invSinkMass;
      const sinkVelocity0_y = sinkInitialMomentum_y * invSinkMass;
      const sinkVelocity1_x = sink.momentum_x * invSinkMass;
      const sinkVelocity1_y = sink.momentum_y * invSinkMass;

      sink.E_k -=
        0.5 * sinkMass * (sinkVelocity1_x * sinkVelocity1_x - sinkVelocity0_x * sinkVelocity0_x);
      sink.E_k -=
        0.5 * sinkMass * (sinkVelocity1_y * sinkVelocity1_y - sinkVelocity0_y * sinkVelocity0_y);
    }

    if (sink.E_k < 0) sink.E_k = 0;
    if (source.E_k < 0) source.E_k = 0;

    return flow * direction;
  }

  /** Flow to or from a fixed-pressure environment (blowby, atmosphere). */
  flowEnv(k_flow: number, dt: number, P_env: number, T_env: number, mix?: Mix): number {
    if (k_flow === 0) return 0;

    const maxFlow = this.pressureEquilibriumMaxFlowEnv(P_env, T_env);
    let flow =
      dt *
      GasSystem.flowRate(
        k_flow,
        this.pressure(),
        P_env,
        this.temperature(),
        T_env,
        this.hcr,
        this.invHcr,
        this.chokedFlowLimitCached,
        this.chokedFlowFactorCached,
      );

    if (Math.abs(flow) > Math.abs(maxFlow)) {
      flow = maxFlow;
    }

    if (flow < 0) {
      const bulk_E_k_0 = this.bulkKineticEnergy();
      this.gainN(-flow, GasSystem.kineticEnergyPerMolAt(T_env, this.degreesOfFreedom), mix);
      const bulk_E_k_1 = this.bulkKineticEnergy();
      this.E_k += bulk_E_k_1 - bulk_E_k_0;
    } else {
      const starting_n = this.n();
      this.loseN(flow, this.kineticEnergyPerMol());

      if (starting_n !== 0) {
        this.momentum_x -= (flow / starting_n) * this.momentum_x;
        this.momentum_y -= (flow / starting_n) * this.momentum_y;
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
    if (this.pressure() > P_env) {
      return (
        -(P_env * (0.5 * this.degreesOfFreedom * this.volume()) - this.kineticEnergy()) /
        this.kineticEnergyPerMol()
      );
    }

    const E_k_per_mol_env = 0.5 * T_env * R * this.degreesOfFreedom;
    return (
      -(P_env * (0.5 * this.degreesOfFreedom * this.volume()) - this.kineticEnergy()) /
      E_k_per_mol_env
    );
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
    return this.hcr;
  }

  approximateDensity(): number {
    return (units.AirMolecularMass * this.n()) / this.volume();
  }

  n(): number {
    return this.n_mol;
  }

  kineticEnergy(): number {
    return this.E_k;
  }

  kineticEnergyOf(n: number): number {
    return (this.kineticEnergy() / this.n()) * n;
  }

  kineticEnergyPerMol(): number {
    return this.n_mol !== 0 ? this.E_k / this.n_mol : 0;
  }

  /**
   * Local speed of sound.
   *
   * `pressure / density` reduces to `E_k / (halfDof * mass)`, so the volume
   * term cancels and this needs a single division.
   */
  c(): number {
    if (this.n_mol === 0 || this.E_k === 0) return 0;
    const mass = units.AirMolecularMass * this.n_mol;
    return Math.sqrt((this.hcr * this.E_k) / (this.halfDof * mass));
  }

  totalEnergy(): number {
    if (this.n() === 0) return 0;

    const invMass = 1 / this.mass();
    const v_x = this.momentum_x * invMass;
    const v_y = this.momentum_y * invMass;

    return this.kineticEnergy() + 0.5 * this.mass() * (v_x * v_x + v_y * v_y);
  }

  bulkKineticEnergy(): number {
    const m = units.AirMolecularMass * this.n_mol;
    if (m === 0) return 0;

    return (0.5 * (this.momentum_x * this.momentum_x + this.momentum_y * this.momentum_y)) / m;
  }

  /** Compressible stagnation pressure rise along the (dx, dy) direction. */
  dynamicPressure(dx: number, dy: number): number {
    const n_mol = this.n_mol;
    const E_k = this.E_k;
    if (n_mol === 0 || E_k === 0) return 0;

    const mass = units.AirMolecularMass * n_mol;
    const v = (dx * this.momentum_x + dy * this.momentum_y) / mass;

    if (v <= 0) return 0;

    const hcr = this.hcr;
    const halfDof = this.halfDof;
    const staticPressure = E_k / (halfDof * this.V);

    // c^2 = pressure * hcr / density, and density = mass / V.
    const c_squared = (hcr * E_k) / (halfDof * mass);
    const machNumber_squared = (v * v) / c_squared;

    const x = 1 + ((hcr - 1) / 2) * machNumber_squared;
    let x_d: number;
    switch (this.degreesOfFreedom) {
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
    return units.AirMolecularMass * this.n_mol;
  }

  pressure(): number {
    return this.V !== 0 ? this.E_k / (this.halfDof * this.V) : 0;
  }

  temperature(): number {
    if (this.n_mol === 0) return 0;
    return this.E_k / (this.halfDof * this.n_mol * R);
  }

  velocity_x(): number {
    if (this.n() === 0) return 0;
    return this.momentum_x / this.mass();
  }

  velocity_y(): number {
    if (this.n() === 0) return 0;
    return this.momentum_y / this.mass();
  }

  volume(): number {
    return this.V;
  }

  n_fuel(): number {
    return this.p_fuel * this.n();
  }

  n_inert(): number {
    return this.p_inert * this.n();
  }

  n_o2(): number {
    return this.p_o2 * this.n();
  }
}

/** Convenience re-export so engine definitions can write `k_carb(700)`. */
export const k_carb = GasSystem.k_carb;
export const k_28inH2O = GasSystem.k_28inH2O;
export const circleArea = (r: number) => PI * r * r;
