import { beforeEach, describe, expect, it } from 'vitest';

import * as units from '../core/units';
import { seededRandom, setRandomSource } from '../core/random';
import { R } from '../core/constants';
import { GasSystem } from '../engine/gasSystem';
import { Vehicle } from '../engine/vehicle';
import { Transmission } from '../engine/transmission';
import { buildEngine } from '../builder/buildEngine';
import { PistonEngineSimulator } from './pistonEngineSimulator';
import { gmLs, subaruEj25, kohlerCh750 } from '../engines';
import type { EngineDefinition } from '../builder/spec';

// Combustion efficiency is randomised per ignition event; pin it so runs are
// reproducible.
beforeEach(() => {
  setRandomSource(seededRandom(0x5eed));
});

function makeSimulator(definition: EngineDefinition) {
  const engine = buildEngine(definition.engine());

  const vehicle = new Vehicle();
  vehicle.initialize(definition.vehicle());

  const transmission = new Transmission();
  transmission.initialize(definition.transmission());

  const simulator = new PistonEngineSimulator();
  simulator.initialize();
  simulator.setSimulationFrequency(engine.getSimulationFrequency());
  simulator.loadSimulation(engine, vehicle, transmission);
  simulator.setFluidSimulationSteps(8);

  return { engine, simulator, vehicle, transmission };
}

/** Run `seconds` of simulated time with a fixed frame size. */
function run(simulator: PistonEngineSimulator, seconds: number, frame = 1 / 60): void {
  const frames = Math.round(seconds / frame);
  for (let i = 0; i < frames; ++i) {
    // Keep the audio latency feedback loop neutral so step counts stay stable.
    simulator.externalAudioLatency = simulator.getTargetSynthesizerLatency();
    simulator.startFrame(frame);
    while (simulator.simulateStep()) {
      /* run the frame to completion */
    }
    simulator.endFrame();
  }
}

describe('GasSystem', () => {
  it('recovers the ideal gas law from its state', () => {
    const system = new GasSystem();
    const V = units.volume(1.0, units.L);
    const T = units.celcius(25.0);
    const P = units.pressure(1.0, units.atm);

    system.initialize(P, V, T);

    expect(system.n()).toBeCloseTo((P * V) / (R * T), 12);
    expect(system.pressure()).toBeCloseTo(P, 6);
    expect(system.temperature()).toBeCloseTo(T, 9);
    expect(system.volume()).toBeCloseTo(V, 12);
  });

  it('moves gas from high to low pressure and conserves moles', () => {
    const a = new GasSystem();
    const b = new GasSystem();

    a.initialize(units.pressure(5.0, units.atm), units.volume(1.0, units.L), units.celcius(25));
    a.setGeometry(0.1, 0.1, 1, 0);
    b.initialize(units.pressure(1.0, units.atm), units.volume(1.0, units.L), units.celcius(25));
    b.setGeometry(0.1, 0.1, 1, 0);

    const totalBefore = a.n() + b.n();

    for (let i = 0; i < 2000; ++i) {
      GasSystem.flow({
        k_flow: GasSystem.k_carb(200),
        dt: 1e-4,
        direction_x: 1,
        direction_y: 0,
        crossSectionArea_0: units.area(10, units.cm2),
        crossSectionArea_1: units.area(10, units.cm2),
        system_0: a,
        system_1: b,
      });
      a.dissipateExcessVelocity();
      b.dissipateExcessVelocity();
    }

    expect(a.n() + b.n()).toBeCloseTo(totalBefore, 9);
    expect(b.pressure()).toBeGreaterThan(units.pressure(1.5, units.atm));
    expect(a.pressure()).toBeGreaterThan(b.pressure() - units.pressure(0.5, units.atm));
  });

  it('derives carburettor flow constants that scale with rating', () => {
    expect(GasSystem.k_carb(700)).toBeGreaterThan(GasSystem.k_carb(100));
    expect(GasSystem.k_carb(0)).toBe(0);
  });
});

describe('engine geometry', () => {
  it('computes a plausible displacement for the LS V8', () => {
    const engine = buildEngine(gmLs.engine());
    const litres = engine.getDisplacement() / units.L;

    // 3.78 in bore x 3.622 in stroke x 8 = 5.7 L.
    expect(litres).toBeGreaterThan(5.2);
    expect(litres).toBeLessThan(6.2);
  });

  it('computes a plausible displacement for the EJ25', () => {
    const engine = buildEngine(subaruEj25.engine());
    const litres = engine.getDisplacement() / units.L;

    expect(litres).toBeGreaterThan(2.2);
    expect(litres).toBeLessThan(2.8);
  });

  it('assigns every cylinder a firing angle', () => {
    const engine = buildEngine(gmLs.engine());
    const angles = new Set<number>();
    for (let i = 0; i < engine.getCylinderCount(); ++i) {
      angles.add(Math.round(engine.getIgnitionModule().getFiringAngle(i) * 1e6));
    }

    expect(angles.size).toBe(8);
  });
});

describe('piston engine simulation', () => {
  it('cranks and then idles under its own power', () => {
    const { engine, simulator } = makeSimulator(gmLs);

    engine.setSpeedControl(0.0);
    engine.getIgnitionModule().enabled = true;
    simulator.starterMotor.enabled = true;

    run(simulator, 1.0);
    const crankingRpm = engine.getRpm();
    expect(crankingRpm).toBeGreaterThan(50);

    simulator.starterMotor.enabled = false;
    run(simulator, 2.0);

    // The engine should be running on its own, not coasting to a stop.
    expect(engine.getRpm()).toBeGreaterThan(300);
    expect(engine.getRpm()).toBeLessThan(units.toRpm(engine.getRedline()) * 1.2);
  }, 120_000);

  it('produces manifold vacuum at closed throttle', () => {
    const { engine, simulator } = makeSimulator(gmLs);

    engine.setSpeedControl(0.0);
    engine.getIgnitionModule().enabled = true;
    simulator.starterMotor.enabled = true;
    run(simulator, 1.0);
    simulator.starterMotor.enabled = false;
    run(simulator, 2.0);

    expect(engine.getManifoldPressure()).toBeLessThan(units.pressure(1.0, units.atm));
    expect(engine.getManifoldPressure()).toBeGreaterThan(0);
  }, 120_000);

  it('generates a non-silent audio signal while running', () => {
    const { engine, simulator } = makeSimulator(gmLs);

    engine.setSpeedControl(0.5);
    engine.getIgnitionModule().enabled = true;
    simulator.starterMotor.enabled = true;
    run(simulator, 1.0);
    simulator.starterMotor.enabled = false;
    run(simulator, 1.0);

    const buffer = new Int16Array(4096);
    const read = simulator.readAudioOutput(buffer.length, buffer);
    expect(read).toBeGreaterThan(0);

    let peak = 0;
    for (let i = 0; i < read; ++i) peak = Math.max(peak, Math.abs(buffer[i]));
    expect(peak).toBeGreaterThan(0);
  }, 120_000);

  it('builds every bundled engine without error', () => {
    for (const definition of [gmLs, subaruEj25, kohlerCh750]) {
      const { engine } = makeSimulator(definition);
      expect(engine.getCylinderCount()).toBeGreaterThan(0);
      expect(Number.isFinite(engine.getDisplacement())).toBe(true);
    }
  }, 120_000);

  it('starts the governed Kohler and holds it near its governed speed', () => {
    // Regression test: this engine relies on the script library's default fuel.
    // Without the default turbulence-to-flame-speed curve, combustion is far
    // too slow to sustain it and the engine dies as soon as the starter stops.
    const { engine, simulator } = makeSimulator(kohlerCh750);

    engine.setSpeedControl(0.0);
    engine.getIgnitionModule().enabled = true;
    simulator.starterMotor.enabled = true;
    run(simulator, 2.0);

    simulator.starterMotor.enabled = false;
    run(simulator, 3.0);

    // The governor's idle target is 1600 rpm.
    expect(engine.getRpm()).toBeGreaterThan(900);
    expect(engine.getRpm()).toBeLessThan(2600);
  }, 180_000);
});

describe('script library defaults', () => {
  it('gives an unspecified fuel the default flame speed curve', () => {
    const fuel = buildEngine(kohlerCh750.engine()).getFuel();

    // Turbulence raises the flame speed well above the laminar velocity.
    const laminar = fuel.laminarBurningVelocity(
      fuel.getMolecularAfr(),
      units.celcius(400),
      units.pressure(10, units.atm),
    );
    const turbulent = fuel.flameSpeed(
      2.0,
      fuel.getMolecularAfr(),
      units.celcius(400),
      units.pressure(10, units.atm),
      units.pressure(40, units.atm),
      units.pressure(160, units.psi),
    );

    expect(laminar).toBeGreaterThan(0);
    expect(turbulent).toBeGreaterThan(laminar * 2);
  });

  it('defaults the dyno range to the engine redline', () => {
    const engine = buildEngine(kohlerCh750.engine());
    expect(engine.getDynoMaxSpeed()).toBeCloseTo(engine.getRedline(), 9);
    expect(engine.getDynoMinSpeed()).toBeCloseTo(units.rpm(1000), 9);
  });
});
