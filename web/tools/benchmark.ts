/* Entry point for `npm run benchmark`. */
import { benchmark, formatResult } from '../src/sim/benchmark';
import { ENGINES, getEngineDefinition } from '../src/engines';

const id = process.argv[2];
const fluidSteps = Number(process.argv[3] ?? 8);
const definitions = id ? [getEngineDefinition(id)] : ENGINES;

for (const definition of definitions) {
  console.log(formatResult(benchmark(definition, 4.0, fluidSteps)));
}
