import { describe, expect, it } from 'vitest';

import * as units from '../core/units';
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { PistonEngineSimulator } from '../sim/pistonEngineSimulator';
import { buildEngine } from './buildEngine';
import { seededRandom, setRandomSource } from '../core/random';
import { CustomEngineError, compileCustomEngine, customEngineTemplate } from './customEngine';
import type { CustomEngineJson } from './customEngine';

function runToIdle(json: CustomEngineJson, seconds = 4): number {
  setRandomSource(seededRandom(0xcafe));

  const definition = compileCustomEngine(json);
  const engine = buildEngine(definition.engine());
  const vehicle = new Vehicle();
  vehicle.initialize(definition.vehicle());
  const transmission = new Transmission();
  transmission.initialize(definition.transmission());

  const simulator = new PistonEngineSimulator();
  simulator.initialize();
  simulator.setSimulationFrequency(engine.getSimulationFrequency());
  simulator.loadSimulation(engine, vehicle, transmission);

  engine.setSpeedControl(0.0);
  engine.getIgnitionModule().enabled = true;
  simulator.starterMotor.enabled = true;

  const frame = 1 / 60;
  const frames = Math.round(seconds / frame);
  for (let i = 0; i < frames; ++i) {
    if (i === Math.round(frames / 3)) simulator.starterMotor.enabled = false;
    simulator.externalAudioLatency = simulator.getTargetSynthesizerLatency();
    simulator.startFrame(frame);
    while (simulator.simulateStep()) {
      /* run frame */
    }
    simulator.endFrame();
  }

  return engine.getRpm();
}

describe('custom engine compiler', () => {
  it('builds and starts the template inline four', () => {
    const rpm = runToIdle(customEngineTemplate());
    expect(rpm).toBeGreaterThan(500);
    expect(rpm).toBeLessThan(9000);
  }, 60_000);

  it('builds and starts a crossplane 90-degree V8', () => {
    const rpm = runToIdle({
      name: 'Custom V8',
      layout: 'v',
      cylinders: 8,
      vAngleDeg: 90,
      boreMm: 96,
      strokeMm: 92,
      rodLengthMm: 160,
      compressionRatio: 10.0,
      firingOrder: [1, 8, 7, 2, 6, 5, 4, 3],
      redlineRpm: 6500,
      intake: { flowCfm: 700 },
      exhaust: { outletFlowCfm: 900 },
    });
    expect(rpm).toBeGreaterThan(500);
    expect(rpm).toBeLessThan(8500);
  }, 60_000);

  it('builds and starts a flat twin', () => {
    const rpm = runToIdle({
      name: 'Custom Boxer Twin',
      layout: 'flat',
      cylinders: 2,
      boreMm: 84,
      strokeMm: 71,
      intake: { flowCfm: 150 },
      exhaust: { outletFlowCfm: 180 },
      ports: 'smallEngine',
    });
    expect(rpm).toBeGreaterThan(400);
  }, 60_000);

  it('reproduces the even-fire V8 crank from the firing order', () => {
    const definition = compileCustomEngine({
      layout: 'v',
      cylinders: 8,
      vAngleDeg: 90,
      firingOrder: [1, 8, 7, 2, 6, 5, 4, 3],
    });
    const journals = definition.engine().crankshafts[0].rodJournals;
    const degrees = journals.map((j) => Math.round(j.angle / units.deg) % 360);
    // The LS crossplane crank: 0, 270, 90, 180.
    expect(degrees).toEqual([0, 270, 90, 180]);
  });

  it('rejects a bad firing order with a readable message', () => {
    expect(() => compileCustomEngine({ cylinders: 4, firingOrder: [1, 2, 3, 3] })).toThrowError(
      CustomEngineError,
    );
    expect(() => compileCustomEngine({ cylinders: 4, firingOrder: [1, 2, 3, 3] })).toThrowError(
      /permutation/,
    );
  });

  it('rejects nonsense geometry', () => {
    expect(() => compileCustomEngine({ boreMm: -5 })).toThrowError(CustomEngineError);
    expect(() => compileCustomEngine({ layout: 'w' })).toThrowError(/layout/);
    expect(() => compileCustomEngine({ layout: 'v', cylinders: 5 })).toThrowError(/even/);
  });
});
