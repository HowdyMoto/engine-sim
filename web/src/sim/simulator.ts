/**
 * Simulation driver, ported from `include/simulator.h` / `src/simulator.cpp`.
 *
 * `startFrame` decides how many fixed-size physics steps to run this frame,
 * adjusting the count so the synthesizer's queued audio converges on the
 * target latency. In the browser the queue continues past the synthesizer into
 * the AudioWorklet, so `externalAudioLatency` folds that backlog into the same
 * feedback loop.
 */
import { PI } from '../core/constants';
import { RigidBodySystem } from '../physics/rigidBodySystem';
import { Synthesizer, type AudioParameters } from '../audio/synthesizer';
import { Dynamometer } from '../engine/dynamometer';
import { StarterMotor } from '../engine/starterMotor';
import type { Engine } from '../engine/engine';
import type { Vehicle } from '../engine/vehicle';
import type { Transmission } from '../engine/transmission';

const DYNO_TORQUE_SAMPLES = 512;

export abstract class Simulator {
  readonly dyno = new Dynamometer();
  readonly starterMotor = new StarterMotor();

  protected system = new RigidBodySystem();
  protected synthesizer = new Synthesizer();

  protected engine: Engine | null = null;
  protected transmission: Transmission | null = null;
  protected vehicle: Vehicle | null = null;

  private simulationFrequency = 10000;
  private audioSampleRate = 44100;
  private targetSynthesizerLatency = 0.1;
  private simulationSpeed = 1.0;

  /** Audio buffered downstream of the synthesizer, in seconds. */
  externalAudioLatency = 0;

  private currentIteration = 0;
  private steps = 0;

  private dynoTorqueSamples = new Float64Array(DYNO_TORQUE_SAMPLES);
  private lastDynoTorqueSample = 0;

  private filteredEngineSpeedValue = 0.0;

  private frameStartTime = 0;
  private physicsProcessingTime = 0;

  initialize(): void {
    this.dynoTorqueSamples.fill(0);
  }

  loadSimulation(engine: Engine, vehicle: Vehicle, transmission: Transmission): void {
    this.engine = engine;
    this.vehicle = vehicle;
    this.transmission = transmission;
  }

  getSystem(): RigidBodySystem {
    return this.system;
  }

  getEngine(): Engine | null {
    return this.engine;
  }

  getTransmission(): Transmission | null {
    return this.transmission;
  }

  getVehicle(): Vehicle | null {
    return this.vehicle;
  }

  getSynthesizer(): Synthesizer {
    return this.synthesizer;
  }

  setSimulationFrequency(frequency: number): void {
    this.simulationFrequency = frequency;
  }

  getSimulationFrequency(): number {
    return this.simulationFrequency;
  }

  /** Must match the AudioContext's rate; the filter chain is designed around it. */
  setAudioSampleRate(rate: number): void {
    this.audioSampleRate = rate;
  }

  getAudioSampleRate(): number {
    return this.audioSampleRate;
  }

  getTimestep(): number {
    return 1.0 / this.simulationFrequency;
  }

  setTargetSynthesizerLatency(latency: number): void {
    this.targetSynthesizerLatency = latency;
  }

  getTargetSynthesizerLatency(): number {
    return this.targetSynthesizerLatency;
  }

  getSynthesizerInputLatency(): number {
    return this.synthesizer.getLatency();
  }

  setSimulationSpeed(simSpeed: number): void {
    this.simulationSpeed = simSpeed;
  }

  getSimulationSpeed(): number {
    return this.simulationSpeed;
  }

  getCurrentIteration(): number {
    return this.currentIteration;
  }

  simulationSteps(): number {
    return this.steps;
  }

  getAverageProcessingTime(): number {
    return this.physicsProcessingTime;
  }

  filteredEngineSpeed(): number {
    return this.filteredEngineSpeedValue;
  }

  setAudioParameters(params: AudioParameters): void {
    this.synthesizer.audioParameters = params;
  }

  startFrame(dt: number): void {
    if (this.engine === null) {
      this.steps = 0;
      return;
    }

    this.frameStartTime = performanceNow();
    this.currentIteration = 0;
    this.synthesizer.setInputSampleRate(this.simulationFrequency * this.simulationSpeed);

    const timestep = this.getTimestep();
    let steps = Math.round((dt * this.simulationSpeed) / timestep);

    const totalLatency = this.synthesizer.getLatency() + this.externalAudioLatency;
    const targetLatency = this.targetSynthesizerLatency;
    if (totalLatency < targetLatency) {
      steps = Math.trunc((steps + 1) * 1.1);
    } else if (totalLatency > targetLatency) {
      steps = Math.trunc((steps - 1) * 0.9);
      if (steps < 0) steps = 0;
    }

    this.steps = steps;

    if (this.steps > 0) {
      for (let i = 0; i < this.engine.getIntakeCount(); ++i) {
        this.engine.getIntake(i).flowRate = 0;
      }
    }
  }

  simulateStep(): boolean {
    if (this.currentIteration >= this.steps) {
      const lastFrame = (performanceNow() - this.frameStartTime) * 1000;
      this.physicsProcessingTime = this.physicsProcessingTime * 0.98 + 0.02 * lastFrame;
      return false;
    }

    const engine = this.engine!;
    const timestep = this.getTimestep();

    this.system.process(timestep, 1);

    engine.update(timestep);
    this.vehicle!.update(timestep);
    this.transmission!.update(timestep);

    this.updateFilteredEngineSpeed(timestep);

    const outputShaft = engine.getOutputCrankshaft();
    outputShaft.resetAngle();

    // Temporary hack carried over from the original: keep extra crankshafts
    // locked to the output shaft's angle to stop them drifting apart.
    for (let i = 0; i < engine.getCrankshaftCount(); ++i) {
      engine.getCrankshaft(i).body.theta = outputShaft.body.theta;
    }

    let index = Math.floor((DYNO_TORQUE_SAMPLES * outputShaft.getCycleAngle()) / (4 * PI));
    if (index < 0) index = 0;
    else if (index >= DYNO_TORQUE_SAMPLES) index = DYNO_TORQUE_SAMPLES - 1;

    const step = engine.isSpinningCw() ? 1 : -1;
    this.dynoTorqueSamples[index] = this.dyno.getTorque();

    if (this.lastDynoTorqueSample !== index) {
      for (let i = this.lastDynoTorqueSample + step; i !== index; i += step) {
        if (i >= DYNO_TORQUE_SAMPLES) {
          i = -1;
          continue;
        } else if (i < 0) {
          i = DYNO_TORQUE_SAMPLES;
          continue;
        }

        this.dynoTorqueSamples[i] = this.dyno.getTorque();
      }

      this.lastDynoTorqueSample = index;
    }

    this.simulateStepInternal();
    this.writeToSynthesizer();

    ++this.currentIteration;
    return true;
  }

  endFrame(): void {
    this.synthesizer.endInputBlock();
  }

  readAudioOutput(samples: number, target: Int16Array): number {
    return this.synthesizer.readAudioOutput(samples, target);
  }

  /** Cycle-averaged dyno torque, the figure the dyno display reports. */
  getFilteredDynoTorque(): number {
    let averageTorque = 0;
    for (let i = 0; i < DYNO_TORQUE_SAMPLES; ++i) averageTorque += this.dynoTorqueSamples[i];
    return averageTorque / DYNO_TORQUE_SAMPLES;
  }

  getDynoPower(): number {
    return this.engine !== null ? this.getFilteredDynoTorque() * this.engine.getSpeed() : 0;
  }

  getTotalExhaustFlow(): number {
    return 0.0;
  }

  getAverageOutputSignal(): number {
    return 0.0;
  }

  protected initializeSynthesizer(): void {
    this.synthesizer.initialize({
      audioBufferSize: Math.round(this.audioSampleRate),
      audioSampleRate: this.audioSampleRate,
      inputBufferSize: Math.round(this.audioSampleRate),
      inputChannelCount: this.engine!.getExhaustSystemCount(),
      inputSampleRate: this.getSimulationFrequency(),
    });
  }

  protected simulateStepInternal(): void {
    /* extension point for engine-type-specific work */
  }

  protected abstract writeToSynthesizer(): void;

  private updateFilteredEngineSpeed(dt: number): void {
    const alpha = dt / (100 + dt);
    this.filteredEngineSpeedValue =
      alpha * this.filteredEngineSpeedValue + (1 - alpha) * this.engine!.getRpm();
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
