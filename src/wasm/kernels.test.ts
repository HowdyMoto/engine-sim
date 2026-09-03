import { afterEach, describe, expect, it } from 'vitest';

import * as units from '../core/units';
import { GAS_STATE_STRIDE, GasSystem, setGasKernels } from '../engine/gasSystem';
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { buildEngine } from '../builder/buildEngine';
import { PistonEngineSimulator } from '../sim/pistonEngineSimulator';
import { seededRandom, setRandomSource } from '../core/random';
import { gmLs } from '../engines';
import { createGasKernels } from './kernels';
import { bindEngineToKernels, collectGasSystems } from './bindEngine';

afterEach(() => {
  setGasKernels(null);
});

/** Two identically-prepared systems: one bound to wasm state, one plain JS. */
function preparePair(state: Float64Array, slot: number): [GasSystem, GasSystem] {
  const bound = new GasSystem();
  const plain = new GasSystem();

  for (const system of [bound, plain]) {
    system.initialize(
      units.pressure(2.4, units.atm),
      units.volume(1.7, units.L),
      units.celcius(140),
      { p_fuel: 0.02, p_inert: 0.75, p_o2: 0.23 },
    );
    system.setGeometry(0.08, 0.21, 1, 0);
    system.momentum_x = 0.004;
    system.momentum_y = -0.0013;
  }

  bound.bindTo(state, slot);
  return [bound, plain];
}

function expectClose(a: number, b: number, what: string): void {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  expect(Math.abs(a - b) / scale, what).toBeLessThan(1e-9);
}

function expectSameState(bound: GasSystem, plain: GasSystem, what: string): void {
  expectClose(bound.n_mol, plain.n_mol, `${what}: n_mol`);
  expectClose(bound.E_k, plain.E_k, `${what}: E_k`);
  expectClose(bound.momentum_x, plain.momentum_x, `${what}: momentum_x`);
  expectClose(bound.momentum_y, plain.momentum_y, `${what}: momentum_y`);
  expectClose(bound.p_fuel, plain.p_fuel, `${what}: p_fuel`);
  expectClose(bound.p_o2, plain.p_o2, `${what}: p_o2`);
}

describe('gas kernels', () => {
  it('instantiates in this runtime', () => {
    const context = createGasKernels(8);
    expect(context).not.toBeNull();
    expect(context!.state.length).toBeGreaterThan(0);
  });

  it('matches the JS pair flow step for step from synced states', () => {
    const context = createGasKernels(4)!;

    const [boundA] = preparePair(context.state, 0);
    const [boundB] = preparePair(context.state, 1);

    // Make B colder and emptier so gas moves A -> B.
    boundB.reset(units.pressure(0.6, units.atm), units.celcius(30), {
      p_fuel: 0,
      p_inert: 1,
      p_o2: 0,
    });

    // JS twins live in a mirror buffer that is re-synced from the WASM state
    // before every step, so each comparison tests one step from identical
    // inputs. Letting two chaotic trajectories evolve separately would demand
    // bit-identical Math.pow between V8 and the WASM module, which is not a
    // property either guarantees.
    const mirror = new Float64Array(GAS_STATE_STRIDE * 2);
    const plainA = new GasSystem();
    const plainB = new GasSystem();
    plainA.bindTo(mirror, 0);
    plainB.bindTo(mirror, 1);

    const kFlow = GasSystem.k_carb(250);
    for (let i = 0; i < 400; ++i) {
      mirror.set(context.state.subarray(0, GAS_STATE_STRIDE * 2));

      const viaKernel = context.kernels.pairFlow(0, 1, kFlow, 1e-4, 1, 0, 8e-4, 6e-4);
      const viaJs = GasSystem.flowJs({
        k_flow: kFlow,
        dt: 1e-4,
        direction_x: 1,
        direction_y: 0,
        crossSectionArea_0: 8e-4,
        crossSectionArea_1: 6e-4,
        system_0: plainA,
        system_1: plainB,
      });

      expectClose(viaKernel, viaJs, `flow at step ${i}`);
      expectSameState(boundA, plainA, `system A at step ${i}`);
      expectSameState(boundB, plainB, `system B at step ${i}`);

      // Advance the WASM side so the swept states cover a varied range.
      context.kernels.dissipateExcessVelocity(0);
      context.kernels.dissipateExcessVelocity(1);
      context.kernels.updateVelocity(0, 1e-4, 0.5);
      context.kernels.updateVelocity(1, 1e-4, 0.5);
    }
  });

  it('matches the JS velocity kernels from synced states', () => {
    const context = createGasKernels(2)!;
    const [bound] = preparePair(context.state, 0);
    bound.momentum_x = 0.4;
    bound.momentum_y = -0.2;

    const mirror = new Float64Array(GAS_STATE_STRIDE);
    const plain = new GasSystem();
    plain.bindTo(mirror, 0);

    for (let i = 0; i < 200; ++i) {
      mirror.set(context.state.subarray(0, GAS_STATE_STRIDE));

      context.kernels.updateVelocity(0, 1e-4, 0.7);
      plain.updateVelocityJs(1e-4, 0.7);
      expectSameState(bound, plain, `updateVelocity step ${i}`);

      mirror.set(context.state.subarray(0, GAS_STATE_STRIDE));
      context.kernels.dissipateExcessVelocity(0);
      plain.dissipateExcessVelocityJs();
      expectSameState(bound, plain, `dissipate step ${i}`);
    }
  });

  it('matches the JS environment flow in both directions', () => {
    const context = createGasKernels(2)!;
    const [bound] = preparePair(context.state, 0);

    const mirror = new Float64Array(GAS_STATE_STRIDE);
    const plain = new GasSystem();
    plain.bindTo(mirror, 0);

    const kFlow = GasSystem.k_28inH2O(2.0);
    const mix = { p_fuel: 0.01, p_inert: 0.74, p_o2: 0.25 };

    // Blow down toward a low-pressure environment, then draw back in.
    for (const pEnv of [units.pressure(0.5, units.atm), units.pressure(4.0, units.atm)]) {
      for (let i = 0; i < 200; ++i) {
        mirror.set(context.state.subarray(0, GAS_STATE_STRIDE));

        const viaKernel = context.kernels.envFlow(
          0,
          kFlow,
          1e-4,
          pEnv,
          units.celcius(25),
          mix.p_fuel,
          mix.p_inert,
          mix.p_o2,
        );
        const viaJs = plain.flowEnvJs(kFlow, 1e-4, pEnv, units.celcius(25), mix);
        expectClose(viaKernel, viaJs, `env flow toward ${pEnv.toFixed(0)} Pa, step ${i}`);
        expectSameState(bound, plain, `env-flow state, step ${i}`);
      }
    }
  });

  it('routes GasSystem calls through the kernels once bound', () => {
    const context = createGasKernels(2)!;
    const [bound] = preparePair(context.state, 0);

    let calls = 0;
    setGasKernels({
      pairFlow: () => {
        ++calls;
        return 0;
      },
      envFlow: () => {
        ++calls;
        return 0;
      },
      updateVelocity: () => {
        ++calls;
      },
      dissipateExcessVelocity: () => {
        ++calls;
      },
    });

    const other = new GasSystem();
    other.initialize(units.pressure(1, units.atm), units.volume(1, units.L), units.celcius(25));
    other.bindTo(context.state, 1);

    GasSystem.flow({
      k_flow: 1e-6,
      dt: 1e-4,
      direction_x: 1,
      direction_y: 0,
      crossSectionArea_0: 1e-3,
      crossSectionArea_1: 1e-3,
      system_0: bound,
      system_1: other,
    });
    bound.flowEnv(1e-6, 1e-4, units.pressure(1, units.atm), units.celcius(25));
    bound.updateVelocity(1e-4);
    bound.dissipateExcessVelocity();

    expect(calls).toBe(4);

    // An unbound system must stay on the JS path.
    const unbound = new GasSystem();
    unbound.initialize(units.pressure(1, units.atm), units.volume(1, units.L), units.celcius(25));
    unbound.updateVelocity(1e-4);
    expect(calls).toBe(4);
  });

  it('runs the LS V8 with kernels active and it still starts', () => {
    setRandomSource(seededRandom(0x5eed));

    const engine = buildEngine(gmLs.engine());
    const vehicle = new Vehicle();
    vehicle.initialize(gmLs.vehicle());
    const transmission = new Transmission();
    transmission.initialize(gmLs.transmission());

    const simulator = new PistonEngineSimulator();
    simulator.initialize();
    simulator.setSimulationFrequency(engine.getSimulationFrequency());
    simulator.loadSimulation(engine, vehicle, transmission);

    expect(bindEngineToKernels(engine)).toBe(true);
    expect(collectGasSystems(engine).every((system) => system.slot >= 0)).toBe(true);

    engine.setSpeedControl(0.0);
    engine.getIgnitionModule().enabled = true;
    simulator.starterMotor.enabled = true;

    const frame = 1 / 60;
    for (let i = 0; i < 180; ++i) {
      if (i === 60) simulator.starterMotor.enabled = false;
      simulator.externalAudioLatency = simulator.getTargetSynthesizerLatency();
      simulator.startFrame(frame);
      while (simulator.simulateStep()) {
        /* run frame */
      }
      simulator.endFrame();
    }

    expect(engine.getRpm()).toBeGreaterThan(300);
    expect(engine.getRpm()).toBeLessThan(units.toRpm(engine.getRedline()) * 1.2);
  }, 120_000);
});
