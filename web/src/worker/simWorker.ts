/**
 * Simulation worker: owns the engine, physics and synthesizer, and drives them
 * on a fixed cadence.
 *
 * Everything the page needs per frame is packed into a transferable
 * Float32Array, so the render thread never touches simulation objects.
 */
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { buildEngine } from '../builder/buildEngine';
import { PistonEngineSimulator } from '../sim/pistonEngineSimulator';
import { getEngineDefinition } from '../engines';
import {
  C,
  S,
  crankshaftOffset,
  cylinderOffset,
  defaultControlState,
  frameStateSize,
  type ControlState,
  type EngineInfo,
  type MainToWorker,
  type WorkerToMain,
} from './protocol';
import type { Engine } from '../engine/engine';

const TARGET_FRAME_SECONDS = 1 / 60;
// The original targets 0.1 s of queued audio. A browser frame is jitterier
// than a native one - a sharp load change can starve the queue before the
// quality controller reacts - so this carries a little more cushion.
const TARGET_AUDIO_BUFFER_SECONDS = 0.13;

let engine: Engine | null = null;
let simulator: PistonEngineSimulator | null = null;
let vehicle: Vehicle | null = null;
let transmission: Transmission | null = null;
let info: EngineInfo | null = null;

let control: ControlState = defaultControlState();
let audioSampleRate = 44100;
let paused = false;
let running = false;

let audioBufferedSamples = 0;
const impulseResponses = new Map<number, { samples: Int16Array; volume: number }>();
let audioScratch = new Int16Array(8192);

let autoQuality = true;
let qualityCooldown = 0;
let frameLoadAverage = 0;
let lastStarvedSamples = 0;
let audioDropped = false;

let lastFrameTime = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function post(message: WorkerToMain, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function describeEngine(id: string, built: Engine): EngineInfo {
  const definition = getEngineDefinition(id);

  const banks = [];
  for (let i = 0; i < built.getCylinderBankCount(); ++i) {
    const bank = built.getCylinderBank(i);
    banks.push({
      angle: bank.getAngle(),
      bore: bank.getBore(),
      deckHeight: bank.getDeckHeight(),
      x: bank.getX(),
      y: bank.getY(),
      displayDepth: bank.getDisplayDepth(),
      cylinderCount: bank.getCylinderCount(),
      flipDisplay: built.getHead(i).getFlipDisplay(),
    });
  }

  const cylinders = [];
  for (let i = 0; i < built.getCylinderCount(); ++i) {
    const piston = built.getPiston(i);
    const rod = built.getConnectingRod(i);
    cylinders.push({
      bankIndex: piston.getCylinderBank().getIndex(),
      indexInBank: piston.getCylinderIndex(),
      rodLength: rod.getLength(),
      bigEndLocal: rod.getBigEndLocal(),
      littleEndLocal: rod.getLittleEndLocal(),
      compressionHeight: piston.getCompressionHeight(),
      wristPinLocation: piston.getWristPinLocation(),
      layer: rod.getLayer(),
    });
  }

  const impulseResponses = [];
  for (let i = 0; i < built.getExhaustSystemCount(); ++i) {
    const exhaust = built.getExhaustSystem(i);
    impulseResponses.push({
      name: exhaust.getImpulseResponse(),
      volume: exhaust.getImpulseResponseVolume(),
    });
  }

  return {
    id,
    name: built.getName(),
    description: definition.description,
    cylinderCount: built.getCylinderCount(),
    crankshaftCount: built.getCrankshaftCount(),
    bankCount: built.getCylinderBankCount(),
    crankThrow: built.getCrankshaft(0).getThrow(),
    displacement: built.getDisplacement(),
    redline: built.getRedline(),
    dynoMinSpeed: built.getDynoMinSpeed(),
    dynoMaxSpeed: built.getDynoMaxSpeed(),
    dynoHoldStep: built.getDynoHoldStep(),
    gearCount: definition.transmission().gearRatios.length,
    simulationFrequency: built.getSimulationFrequency(),
    banks,
    cylinders,
    exhaustSystemCount: built.getExhaustSystemCount(),
    impulseResponses,
  };
}

function load(engineId: string): void {
  const definition = getEngineDefinition(engineId);

  engine = buildEngine(definition.engine());

  vehicle = new Vehicle();
  vehicle.initialize(definition.vehicle());

  transmission = new Transmission();
  transmission.initialize(definition.transmission());

  simulator = new PistonEngineSimulator();
  simulator.initialize();
  simulator.setAudioSampleRate(audioSampleRate);
  simulator.setSimulationFrequency(engine.getSimulationFrequency());
  simulator.setFluidSimulationSteps(8);
  simulator.setTargetSynthesizerLatency(TARGET_AUDIO_BUFFER_SECONDS);
  simulator.loadSimulation(engine, vehicle, transmission);

  control = {
    ...defaultControlState(),
    simulationFrequency: engine.getSimulationFrequency(),
    highFrequencyGain: engine.getInitialHighFrequencyGain(),
    lowFrequencyNoise: engine.getInitialNoise(),
    highFrequencyNoise: engine.getInitialJitter(),
  };

  applyAudioParameters();
  applyImpulseResponses();

  info = describeEngine(engineId, engine);
  audioBufferedSamples = 0;
  frameLoadAverage = 0;
  // Ignore the first second: the JIT is still warming up and would otherwise
  // trigger a quality drop the machine does not actually need.
  qualityCooldown = 60;

  post({ type: 'loaded', info });

  if (!running) {
    running = true;
    lastFrameTime = now();
    schedule(0);
  }
}

function applyImpulseResponses(): void {
  if (simulator === null || engine === null) return;

  const synthesizer = simulator.getSynthesizer();
  for (const [channel, response] of impulseResponses) {
    if (channel >= engine.getExhaustSystemCount()) continue;
    synthesizer.initializeImpulseResponse(response.samples, response.volume, channel);
  }
}

function applyAudioParameters(): void {
  if (simulator === null) return;

  const synthesizer = simulator.getSynthesizer();
  const params = synthesizer.audioParameters;
  params.volume = control.volume;
  params.convolution = control.convolution;
  params.dF_F_mix = control.highFrequencyGain;
  params.airNoise = control.lowFrequencyNoise;
  params.inputSampleNoise = control.highFrequencyNoise;
}

function applyControl(update: Partial<ControlState>): void {
  const previousFrequency = control.simulationFrequency;
  const previousFluid = control.fluidSimulationSteps;
  const previousGear = control.gear;

  control = { ...control, ...update };

  if (simulator === null || engine === null || transmission === null) return;

  engine.setSpeedControl(control.speedControl);
  engine.getIgnitionModule().enabled = control.ignition;

  simulator.starterMotor.enabled = control.starter;
  simulator.dyno.enabled = control.dynoEnabled;
  simulator.dyno.hold = control.dynoHold;
  simulator.dyno.rotationSpeed = control.dynoSpeed;
  simulator.setSimulationSpeed(control.simulationSpeed);

  transmission.setClutchPressure(control.clutchPressure);
  if (control.gear !== previousGear) transmission.changeGear(control.gear);

  if (control.simulationFrequency !== previousFrequency) {
    simulator.setSimulationFrequency(control.simulationFrequency);
  }

  if (control.fluidSimulationSteps !== previousFluid) {
    simulator.setFluidSimulationSteps(control.fluidSimulationSteps);
  }

  applyAudioParameters();
}

/**
 * Keep the simulation inside its frame budget by trading fluid sub-steps and
 * simulation rate for speed. The original exposes both as manual controls; a
 * browser has to cope with whatever hardware it lands on, so this adjusts them
 * automatically unless the user has pinned a quality level.
 */
function updateQuality(frameLoad: number): void {
  if (!autoQuality || engine === null || simulator === null) return;

  frameLoadAverage = frameLoadAverage * 0.95 + frameLoad * 0.05;

  // An actual dropout is a stronger signal than averaged frame load, and it
  // arrives sooner: a sharp load change (opening the throttle) can starve the
  // audio well before the average crosses its threshold.
  const dropped = audioDropped;
  audioDropped = false;

  if (dropped) {
    frameLoadAverage = Math.max(frameLoadAverage, 1.0);
    qualityCooldown = Math.min(qualityCooldown, 15);
  }

  if (qualityCooldown > 0) {
    --qualityCooldown;
    return;
  }

  const nominalFrequency = engine.getSimulationFrequency();

  if (frameLoadAverage > 0.85) {
    if (control.fluidSimulationSteps > 2) {
      applyControl({ fluidSimulationSteps: control.fluidSimulationSteps - 1 });
      qualityCooldown = 90;
    } else if (control.simulationFrequency > nominalFrequency * 0.5) {
      applyControl({
        simulationFrequency: Math.max(
          Math.round(nominalFrequency * 0.5),
          Math.round(control.simulationFrequency * 0.85),
        ),
      });
      qualityCooldown = 90;
    }
  } else if (frameLoadAverage < 0.55) {
    if (control.simulationFrequency < nominalFrequency) {
      applyControl({
        simulationFrequency: Math.min(
          nominalFrequency,
          Math.round(control.simulationFrequency * 1.1),
        ),
      });
      qualityCooldown = 90;
    } else if (control.fluidSimulationSteps < 8) {
      applyControl({ fluidSimulationSteps: control.fluidSimulationSteps + 1 });
      qualityCooldown = 90;
    }
  }
}

function writeState(state: Float32Array, frameLoad: number): void {
  const sim = simulator!;
  const eng = engine!;
  const trans = transmission!;
  const veh = vehicle!;

  state[S.Rpm] = eng.getRpm();
  state[S.Speed] = eng.getSpeed();
  state[S.Throttle] = 1 - eng.getThrottle();
  state[S.ManifoldPressure] = eng.getManifoldPressure();
  state[S.IntakeAfr] = eng.getIntakeAfr();
  state[S.ExhaustO2] = eng.getExhaustO2();
  state[S.DynoTorque] = sim.getFilteredDynoTorque();
  state[S.DynoPower] = sim.getDynoPower();
  state[S.Gear] = trans.getGear();
  state[S.ClutchPressure] = trans.getClutchPressure();
  state[S.VehicleSpeed] = veh.getSpeed();
  state[S.IgnitionEnabled] = control.ignition ? 1 : 0;
  state[S.StarterEnabled] = control.starter ? 1 : 0;
  state[S.DynoEnabled] = control.dynoEnabled ? 1 : 0;
  state[S.DynoHold] = control.dynoHold ? 1 : 0;
  state[S.DynoSpeed] = control.dynoSpeed;
  state[S.SimulationFrequency] = sim.getSimulationFrequency();
  state[S.FluidSteps] = sim.getFluidSimulationSteps();
  state[S.StepsThisFrame] = sim.simulationSteps();
  state[S.FrameLoad] = frameLoad;
  state[S.SynthLatency] = sim.getSynthesizerInputLatency();
  state[S.AudioLatency] = audioBufferedSamples / audioSampleRate;
  state[S.LevelerGain] = sim.getSynthesizer().getLevelerGain();
  state[S.CycleAngle] = eng.getOutputCrankshaft().getCycleAngle();
  state[S.TimingAdvance] = eng.getIgnitionModule().getTimingAdvance();
  state[S.FuelConsumed] = eng.getTotalVolumeFuelConsumed();
  state[S.TravelledDistance] = veh.getTravelledDistance();
  state[S.FilteredEngineSpeed] = sim.filteredEngineSpeed();
  state[S.SimulationSpeed] = sim.getSimulationSpeed();
  state[S.RevLimiterActive] = eng.getIgnitionModule().isRevLimiterActive() ? 1 : 0;

  const cylinderCount = eng.getCylinderCount();
  for (let i = 0; i < cylinderCount; ++i) {
    const base = cylinderOffset(i);
    const piston = eng.getPiston(i);
    const rod = eng.getConnectingRod(i);
    const chamber = eng.getChamber(i);
    const head = eng.getHead(piston.getCylinderBank().getIndex());

    state[base + C.PistonX] = piston.body.p_x;
    state[base + C.PistonY] = piston.body.p_y;
    state[base + C.PistonTheta] = piston.body.theta;
    state[base + C.RodX] = rod.body.p_x;
    state[base + C.RodY] = rod.body.p_y;
    state[base + C.RodTheta] = rod.body.theta;
    state[base + C.Pressure] = chamber.system.pressure();
    state[base + C.Temperature] = chamber.system.temperature();
    state[base + C.IntakeLift] = head.intakeValveLift(piston.getCylinderIndex());
    state[base + C.ExhaustLift] = head.exhaustValveLift(piston.getCylinderIndex());
  }

  const crankBase = crankshaftOffset(cylinderCount);
  for (let i = 0; i < eng.getCrankshaftCount(); ++i) {
    state[crankBase + i] = eng.getCrankshaft(i).body.theta;
  }
}

function drainAudio(): Float32Array<ArrayBuffer> {
  const sim = simulator!;

  const target = TARGET_AUDIO_BUFFER_SECONDS * audioSampleRate;
  const want = Math.max(0, Math.round(target * 1.6 - audioBufferedSamples));
  const available = sim.getSynthesizer().queuedOutputSamples();
  const n = Math.min(want, available);

  if (n === 0) return new Float32Array(0);

  if (audioScratch.length < n) audioScratch = new Int16Array(n);
  sim.readAudioOutput(n, audioScratch);

  const out = new Float32Array(n);
  for (let i = 0; i < n; ++i) out[i] = audioScratch[i] / 32768;

  audioBufferedSamples += n;
  return out;
}

function tick(): void {
  if (!running || simulator === null || engine === null) return;

  const frameStart = now();
  let dt = (frameStart - lastFrameTime) / 1000;
  lastFrameTime = frameStart;

  // A slow frame must not ask for a proportionally bigger one next time. The
  // step count comes straight from dt, so an unbounded catch-up spirals: one
  // long frame requests more steps, which takes longer still, and the audio
  // queue starves. Capping the catch-up at two frames means the simulation
  // falls slightly behind wall clock under load - which the quality controller
  // then works off - instead of collapsing.
  if (!Number.isFinite(dt) || dt <= 0) dt = TARGET_FRAME_SECONDS;
  dt = Math.min(dt, TARGET_FRAME_SECONDS * 2);

  let audio: Float32Array<ArrayBuffer> = new Float32Array(0);

  if (!paused) {
    simulator.externalAudioLatency = audioBufferedSamples / audioSampleRate;

    simulator.startFrame(dt);
    while (simulator.simulateStep()) {
      /* run the frame to completion */
    }
    simulator.endFrame();

    audio = drainAudio();
  }

  const elapsed = (now() - frameStart) / 1000;
  const frameLoad = elapsed / TARGET_FRAME_SECONDS;

  if (!paused) updateQuality(frameLoad);

  const state = new Float32Array(
    frameStateSize(engine.getCylinderCount(), engine.getCrankshaftCount()),
  );
  writeState(state, frameLoad);

  post({ type: 'frame', state, audio }, [state.buffer, audio.buffer]);

  schedule(Math.max(0, TARGET_FRAME_SECONDS * 1000 - elapsed * 1000));
}

function schedule(delayMs: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(tick, delayMs);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'load':
        audioSampleRate = message.audioSampleRate;
        load(message.engineId);
        break;

      case 'control':
        applyControl(message.control);
        break;

      case 'impulseResponse':
        impulseResponses.set(message.channel, {
          samples: message.samples,
          volume: message.volume,
        });
        applyImpulseResponses();
        break;

      case 'audioStatus':
        audioBufferedSamples = message.bufferedSamples;
        if (message.starvedSamples > lastStarvedSamples) audioDropped = true;
        lastStarvedSamples = message.starvedSamples;
        break;

      case 'setQuality':
        autoQuality = false;
        applyControl({
          simulationFrequency: message.simulationFrequency,
          fluidSimulationSteps: message.fluidSimulationSteps,
        });
        break;

      case 'autoQuality':
        autoQuality = message.enabled;
        qualityCooldown = 0;
        break;

      case 'pause':
        paused = message.paused;
        break;
    }
  } catch (error) {
    post({ type: 'error', message: String(error) });
  }
};
