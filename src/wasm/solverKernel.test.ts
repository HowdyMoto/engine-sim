import { afterEach, describe, expect, it } from 'vitest';

import { Matrix } from '../physics/matrix';
import { SparseMatrix } from '../physics/sparseMatrix';
import { GaussSeidelSleSolver, setSleKernel } from '../physics/gaussSeidelSleSolver';
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { buildEngine } from '../builder/buildEngine';
import { PistonEngineSimulator } from '../sim/pistonEngineSimulator';
import { seededRandom, setRandomSource } from '../core/random';
import { setGasKernels } from '../engine/gasSystem';
import { gmLs } from '../engines';
import { bindEngineToKernels } from './bindEngine';
import { bindSolverKernel } from './solverKernel';

afterEach(() => {
  setSleKernel(null);
  setGasKernels(null);
});

const E = SparseMatrix.ENTRIES;
const S = SparseMatrix.STRIDE;

/** Build a random constraint system resembling an engine's: chains of bodies. */
function randomSystem(
  rng: () => number,
  n: number,
  bodyCount: number,
): { J: SparseMatrix; W: Matrix; right: Matrix; limits: Matrix } {
  const J = new SparseMatrix();
  J.initialize(bodyCount * S, n);

  for (let i = 0; i < n; ++i) {
    const b0 = Math.floor(rng() * bodyCount);
    let b1 = Math.floor(rng() * bodyCount);
    if (b1 === b0) b1 = (b1 + 1) % bodyCount;

    J.setBlock(i, 0, b0);
    J.setBlock(i, 1, b1);
    for (let entry = 0; entry < E; ++entry) {
      for (let slice = 0; slice < S; ++slice) {
        J.set(i, entry, slice, rng() * 2 - 1);
      }
    }
  }

  const W = new Matrix();
  W.initialize(1, bodyCount * S);
  for (let i = 0; i < bodyCount * S; ++i) W.data[i] = 0.05 + rng();

  const right = new Matrix();
  right.initialize(1, n);
  for (let i = 0; i < n; ++i) right.data[i] = rng() * 200 - 100;

  const limits = new Matrix();
  limits.initialize(2, n);
  for (let i = 0; i < n; ++i) {
    const wide = rng() > 0.3;
    limits.data[i * 2 + 0] = wide ? -1e12 : -Math.abs(rng() * 50);
    limits.data[i * 2 + 1] = wide ? 1e12 : Math.abs(rng() * 50);
  }

  return { J, W, right, limits };
}

describe('wasm constraint solver', () => {
  it('matches the JS solver over randomized systems', () => {
    expect(bindSolverKernel()).toBe(true);

    const rng = (() => {
      let state = 0x1234abcd;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    })();

    const wasmSolver = new GaussSeidelSleSolver();
    const jsSolver = new GaussSeidelSleSolver();

    for (let trial = 0; trial < 60; ++trial) {
      const n = 1 + Math.floor(rng() * 60);
      const bodyCount = 2 + Math.floor(rng() * 24);
      const { J, W, right, limits } = randomSystem(rng, n, bodyCount);

      const wasmResult = new Matrix();
      const jsResult = new Matrix();

      // Same warm start on both sides.
      const warm = new Matrix();
      warm.initialize(1, n);
      for (let i = 0; i < n; ++i) warm.data[i] = rng() * 2 - 1;

      const viaWasm = wasmSolver.solveWithLimits(J, W, right, limits, wasmResult, warm);

      setSleKernel(null);
      const viaJs = jsSolver.solveWithLimits(J, W, right, limits, jsResult, warm);
      expect(bindSolverKernel()).toBe(true);

      expect(viaWasm, `trial ${trial}: convergence flag`).toBe(viaJs);
      for (let i = 0; i < n; ++i) {
        const scale = Math.max(Math.abs(jsResult.data[i]), 1e-9);
        expect(
          Math.abs(wasmResult.data[i] - jsResult.data[i]) / scale,
          `trial ${trial}, row ${i}`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  it('falls back to JS for systems beyond the arena', () => {
    expect(bindSolverKernel(8, 4)).toBe(true);

    const rng = () => 0.37;
    const { J, W, right, limits } = randomSystem(
      (() => {
        let x = 1;
        return () => {
          x = (x * 48271) % 2147483647;
          return x / 2147483647;
        };
      })(),
      24,
      12,
    );
    void rng;

    const solver = new GaussSeidelSleSolver();
    const result = new Matrix();
    // Must not throw and must produce a finite answer via the JS path.
    solver.solveWithLimits(J, W, right, limits, result, null);
    for (let i = 0; i < 24; ++i) {
      expect(Number.isFinite(result.data[i])).toBe(true);
    }
  });

  it('runs the LS V8 with both kernels active and it still starts', () => {
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
  }, 120_000);
});
