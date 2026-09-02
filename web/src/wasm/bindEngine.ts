/**
 * Binds every gas system in a built engine to the WASM kernel state buffer.
 *
 * Call after `loadSimulation`, once the chambers have been initialised, so the
 * copied values are the live ones. Returns whether the kernels are active.
 */
import { setGasKernels, type GasSystem } from '../engine/gasSystem';
import { createGasKernels } from './kernels';
import { bindSolverKernel } from './solverKernel';
import type { Engine } from '../engine/engine';

export function collectGasSystems(engine: Engine): GasSystem[] {
  const systems: GasSystem[] = [];

  for (let i = 0; i < engine.getIntakeCount(); ++i) {
    const intake = engine.getIntake(i);
    systems.push(intake.system, intake.getAtmosphere());
  }

  for (let i = 0; i < engine.getExhaustSystemCount(); ++i) {
    const exhaust = engine.getExhaustSystem(i);
    systems.push(exhaust.getSystem(), exhaust.getAtmosphere());
  }

  for (let i = 0; i < engine.getCylinderCount(); ++i) {
    const chamber = engine.getChamber(i);
    systems.push(chamber.system, chamber.intakeRunnerAndManifold, chamber.exhaustRunnerAndPrimary);
  }

  return systems;
}

export function bindEngineToKernels(engine: Engine): boolean {
  const systems = collectGasSystems(engine);
  const context = createGasKernels(systems.length);

  // The constraint solve gets its own kernel instance; fall back silently.
  bindSolverKernel();

  if (context === null) {
    setGasKernels(null);
    return false;
  }

  for (let i = 0; i < systems.length; ++i) {
    systems[i].bindTo(context.state, i);
  }

  setGasKernels(context.kernels);
  return true;
}
