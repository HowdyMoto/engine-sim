/**
 * Loader for the gas-kernel WebAssembly module.
 *
 * `createGasKernels(count)` instantiates the module, reserves state for
 * `count` gas systems, and returns the kernel functions plus the Float64Array
 * every `GasSystem.bindTo` call shares with them. Instantiation is synchronous
 * (the module is 11 KB) so the worker can set it up during engine load.
 *
 * Failure to instantiate - an old runtime, a blocked wasm policy - is not an
 * error: the caller keeps the JavaScript path, which is the reference
 * implementation anyway.
 */
import { GAS_STATE_STRIDE, type GasKernels } from '../engine/gasSystem';
import { gasWasmBytes } from './gasWasm.generated';

interface GasWasmExports {
  memory: WebAssembly.Memory;
  reserve(count: number): number;
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

export interface GasKernelContext {
  kernels: GasKernels;
  /** Shared state buffer; pass to `GasSystem.bindTo(state, slot)`. */
  state: Float64Array;
  capacity: number;
}

export function createGasKernels(count: number): GasKernelContext | null {
  try {
    const module = new WebAssembly.Module(gasWasmBytes());
    const instance = new WebAssembly.Instance(module, {
      env: {
        abort: () => {
          throw new Error('gas kernel abort');
        },
      },
    });

    const exports = instance.exports as unknown as GasWasmExports;
    const byteOffset = exports.reserve(count);
    const state = new Float64Array(
      exports.memory.buffer,
      byteOffset,
      count * GAS_STATE_STRIDE,
    );
    state.fill(0);

    return {
      kernels: {
        pairFlow: exports.pairFlow,
        envFlow: exports.envFlow,
        updateVelocity: exports.updateVelocity,
        dissipateExcessVelocity: exports.dissipateExcessVelocity,
      },
      state,
      capacity: count,
    };
  } catch {
    return null;
  }
}
