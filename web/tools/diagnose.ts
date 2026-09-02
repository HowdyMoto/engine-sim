/* Scratch diagnostic; not part of the app. */
import * as units from '../src/core/units';
import { Vehicle } from '../src/engine/vehicle';
import { Transmission } from '../src/engine/transmission';
import { buildEngine } from '../src/builder/buildEngine';
import { PistonEngineSimulator } from '../src/sim/pistonEngineSimulator';
import { getEngineDefinition } from '../src/engines';

const id = process.argv[2] ?? 'kohler-ch750';
const definition = getEngineDefinition(id);
const engine = buildEngine(definition.engine());

const vehicle = new Vehicle();
vehicle.initialize(definition.vehicle());
const transmission = new Transmission();
transmission.initialize(definition.transmission());

const simulator = new PistonEngineSimulator();
simulator.initialize();
simulator.setSimulationFrequency(engine.getSimulationFrequency());
simulator.setFluidSimulationSteps(8);
simulator.loadSimulation(engine, vehicle, transmission);

engine.setSpeedControl(1.0);
engine.getIgnitionModule().enabled = true;
simulator.starterMotor.enabled = true;

const starterRpm = Number(process.argv[3] ?? 0);
if (starterRpm > 0) simulator.starterMotor.rotationSpeed = -units.rpm(starterRpm);

const starterOff = Number(process.argv[4] ?? 3);
const total = Number(process.argv[5] ?? 8);

const frame = 1 / 60;
let lit = 0;
for (let i = 0; i < 60 * total; ++i) {
  if (i === Math.round(60 * starterOff)) simulator.starterMotor.enabled = false;

  simulator.externalAudioLatency = simulator.getTargetSynthesizerLatency();
  simulator.startFrame(frame);
  while (simulator.simulateStep()) {
    for (let c = 0; c < engine.getCylinderCount(); ++c) {
      if (engine.getChamber(c).popLitLastFrame()) ++lit;
    }
  }
  simulator.endFrame();

  if (i % 30 === 0) {
    const chamber = engine.getChamber(0);
    console.log(
      `t=${(i * frame).toFixed(2)}s rpm=${engine.getRpm().toFixed(0)}` +
        ` throttlePlate=${(1 - engine.getThrottle()).toFixed(3)}` +
        ` map=${(engine.getManifoldPressure() / units.atm).toFixed(3)}atm` +
        ` cylP=${(chamber.system.pressure() / units.atm).toFixed(2)}atm` +
        ` mix(f/o2)=${chamber.system.p_fuel.toFixed(4)}/${chamber.system.p_o2.toFixed(3)}` +
        ` lit=${lit}` +
        ` starter=${simulator.starterMotor.enabled}`,
    );
  }
}
