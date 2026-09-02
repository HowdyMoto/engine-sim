/* Entry point for `npm run benchmark`. Args: [engineId] [fluidSteps] [js|wasm|both] */
import { benchmark, formatResult } from '../src/sim/benchmark';
import { ENGINES, getEngineDefinition } from '../src/engines';

const id = process.argv[2];
const fluidSteps = Number(process.argv[3] ?? 8);
const mode = process.argv[4] ?? 'both';
const definitions = id ? [getEngineDefinition(id)] : ENGINES;

for (const definition of definitions) {
  if (mode !== 'wasm') console.log(formatResult(benchmark(definition, 4.0, fluidSteps, false)));
  if (mode !== 'js') console.log(formatResult(benchmark(definition, 4.0, fluidSteps, true)));
}
