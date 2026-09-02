/**
 * Headless performance probe: measures how much simulated time one second of
 * wall clock buys, so the cost of a change is visible without a browser.
 *
 * Run it with `npm run benchmark`.
 */
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { buildEngine } from '../builder/buildEngine';
import { PistonEngineSimulator } from './pistonEngineSimulator';
import type { EngineDefinition } from '../builder/spec';

export interface BenchmarkResult {
  label: string;
  simulationFrequency: number;
  cylinderCount: number;
  fluidSteps: number;
  rpm: number;
  millisecondsPerFrame: number;
  realtimeFactor: number;
}

export function benchmark(
  definition: EngineDefinition,
  seconds = 4.0,
  fluidSteps = 8,
): BenchmarkResult {
  const engine = buildEngine(definition.engine());

  const vehicle = new Vehicle();
  vehicle.initialize(definition.vehicle());

  const transmission = new Transmission();
  transmission.initialize(definition.transmission());

  const simulator = new PistonEngineSimulator();
  simulator.initialize();
  simulator.setSimulationFrequency(engine.getSimulationFrequency());
  simulator.setFluidSimulationSteps(fluidSteps);
  simulator.loadSimulation(engine, vehicle, transmission);

  engine.setSpeedControl(0.0);
  engine.getIgnitionModule().enabled = true;
  simulator.starterMotor.enabled = true;

  const frame = 1 / 60;
  const frames = Math.round(seconds / frame);
  const warmupFrames = Math.round(frames / 3);
  const audioBuffer = new Int16Array(4096);

  let elapsed = 0;
  for (let i = 0; i < frames; ++i) {
    if (i === warmupFrames) {
      // Discard the warm-up: the engine is still cranking and the JIT is still
      // settling, neither of which represents steady-state cost.
      simulator.starterMotor.enabled = false;
      elapsed = 0;
    }

    // Neutralise the latency feedback so the step count stays at the nominal
    // rate rather than adapting to how fast this machine happens to be.
    simulator.externalAudioLatency = simulator.getTargetSynthesizerLatency();

    const start = performance.now();
    simulator.startFrame(frame);
    while (simulator.simulateStep()) {
      /* run the frame to completion */
    }
    simulator.endFrame();
    simulator.readAudioOutput(audioBuffer.length, audioBuffer);
    elapsed += performance.now() - start;
  }

  const measuredFrames = frames - warmupFrames;
  const simulatedSeconds = measuredFrames * frame;

  return {
    label: definition.label,
    simulationFrequency: engine.getSimulationFrequency(),
    cylinderCount: engine.getCylinderCount(),
    fluidSteps,
    rpm: engine.getRpm(),
    millisecondsPerFrame: elapsed / measuredFrames,
    realtimeFactor: simulatedSeconds / (elapsed / 1000),
  };
}

export function formatResult(result: BenchmarkResult): string {
  return (
    `${result.label.padEnd(16)} ` +
    `${(result.simulationFrequency / 1000).toFixed(0)} kHz  ` +
    `cyl=${result.cylinderCount}  ` +
    `fluid=${result.fluidSteps}  ` +
    `rpm=${result.rpm.toFixed(0).padStart(5)}  ` +
    `${result.millisecondsPerFrame.toFixed(2).padStart(6)} ms/frame  ` +
    `${result.realtimeFactor.toFixed(2)}x realtime`
  );
}
