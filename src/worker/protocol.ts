/**
 * Message and buffer layouts shared between the page and the simulation worker.
 *
 * Per-frame state is packed into a flat Float32Array and transferred rather
 * than structured-cloned, so a running engine costs one allocation and no deep
 * copy per frame.
 */

export interface BankInfo {
  angle: number;
  bore: number;
  deckHeight: number;
  x: number;
  y: number;
  displayDepth: number;
  cylinderCount: number;
  flipDisplay: boolean;
  /** Peak cam lobe lift, for scaling the drawn valve travel. */
  maxIntakeLift: number;
  maxExhaustLift: number;
}

export interface CylinderInfo {
  bankIndex: number;
  indexInBank: number;
  rodLength: number;
  bigEndLocal: number;
  littleEndLocal: number;
  compressionHeight: number;
  wristPinLocation: number;
  layer: number;
}

export interface EngineInfo {
  id: string;
  name: string;
  description: string;
  cylinderCount: number;
  crankshaftCount: number;
  bankCount: number;
  crankThrow: number;
  displacement: number;
  redline: number;
  dynoMinSpeed: number;
  dynoMaxSpeed: number;
  dynoHoldStep: number;
  gearCount: number;
  simulationFrequency: number;
  banks: BankInfo[];
  cylinders: CylinderInfo[];
  exhaustSystemCount: number;
  /** Impulse response file name and gain per exhaust system. */
  impulseResponses: { name: string; volume: number }[];
}

export interface ControlState {
  /** 0 (closed) to 1 (wide open). */
  speedControl: number;
  ignition: boolean;
  starter: boolean;
  dynoEnabled: boolean;
  dynoHold: boolean;
  dynoSpeed: number;
  gear: number;
  clutchPressure: number;
  simulationSpeed: number;
  volume: number;
  convolution: number;
  highFrequencyGain: number;
  lowFrequencyNoise: number;
  highFrequencyNoise: number;
  simulationFrequency: number;
  fluidSimulationSteps: number;
}

export function defaultControlState(): ControlState {
  return {
    speedControl: 0,
    ignition: false,
    starter: false,
    dynoEnabled: false,
    dynoHold: false,
    dynoSpeed: 0,
    gear: -1,
    clutchPressure: 1,
    simulationSpeed: 1,
    volume: 1,
    convolution: 1,
    highFrequencyGain: 0.01,
    lowFrequencyNoise: 1.0,
    highFrequencyNoise: 0.5,
    simulationFrequency: 10000,
    fluidSimulationSteps: 8,
  };
}

export type MainToWorker =
  | { type: 'load'; engineId: string; audioSampleRate: number; customJson?: string }
  | { type: 'control'; control: Partial<ControlState> }
  | { type: 'impulseResponse'; channel: number; samples: Int16Array; volume: number }
  | { type: 'audioStatus'; bufferedSamples: number; starvedSamples: number }
  | { type: 'setQuality'; simulationFrequency: number; fluidSimulationSteps: number }
  | { type: 'autoQuality'; enabled: boolean }
  | { type: 'pause'; paused: boolean };

export type WorkerToMain =
  | { type: 'loaded'; info: EngineInfo }
  | { type: 'frame'; state: Float32Array; audio: Float32Array; scope: Float32Array }
  | { type: 'error'; message: string };

// ---- Frame state layout ---------------------------------------------------

export const enum S {
  Rpm = 0,
  Speed,
  Throttle,
  ManifoldPressure,
  IntakeAfr,
  ExhaustO2,
  DynoTorque,
  DynoPower,
  Gear,
  ClutchPressure,
  VehicleSpeed,
  IgnitionEnabled,
  StarterEnabled,
  DynoEnabled,
  DynoHold,
  DynoSpeed,
  SimulationFrequency,
  FluidSteps,
  StepsThisFrame,
  FrameLoad,
  SynthLatency,
  AudioLatency,
  LevelerGain,
  CycleAngle,
  TimingAdvance,
  FuelConsumed,
  TravelledDistance,
  FilteredEngineSpeed,
  SimulationSpeed,
  RevLimiterActive,
  WasmActive,
  HeaderSize,
}

/** Floats per cylinder in the frame state block. */
export const CYLINDER_STRIDE = 13;

export const enum C {
  PistonX = 0,
  PistonY,
  PistonTheta,
  RodX,
  RodY,
  RodTheta,
  Pressure,
  Temperature,
  IntakeLift,
  ExhaustLift,
  /** 1 when this cylinder ignited during the frame. */
  Lit,
  /** Cam-local lobe angle, 0 = max lift; drives the drawn cam rotation. */
  IntakeCamAngle,
  ExhaustCamAngle,
}

export function frameStateSize(cylinderCount: number, crankshaftCount: number): number {
  return S.HeaderSize + cylinderCount * CYLINDER_STRIDE + crankshaftCount;
}

export function crankshaftOffset(cylinderCount: number): number {
  return S.HeaderSize + cylinderCount * CYLINDER_STRIDE;
}

export function cylinderOffset(index: number): number {
  return S.HeaderSize + index * CYLINDER_STRIDE;
}

// ---- Scope buffer layout --------------------------------------------------
//
// One sample per simulation step (decimated to fit), recorded for cylinder 1
// as the original's oscilloscope cluster does. Layout: [count, then count
// samples of SCOPE_STRIDE floats].

export const SCOPE_STRIDE = 5;
export const SCOPE_MAX_SAMPLES = 2048;

export const enum Sc {
  CycleAngle = 0,
  CylinderPressure,
  IntakeLift,
  ExhaustLift,
  ExhaustFlow,
}
