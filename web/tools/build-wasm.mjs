/**
 * Compiles the AssemblyScript kernels and embeds the binary as base64 in a
 * generated TypeScript module, so bundling and worker loading need no asset
 * handling. Run via `npm run build:wasm`; the generated file is committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'gas-wasm-'));
const wasmPath = join(outDir, 'gas.wasm');

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['asc', 'wasm/assembly/index.ts', '-o', wasmPath, '--runtime', 'stub', '-O3', '--noAssert'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

const wasm = readFileSync(wasmPath);
const base64 = wasm.toString('base64');

const generated = `/**
 * GENERATED FILE - do not edit. Rebuild with \`npm run build:wasm\`.
 *
 * The compiled gas-kernel WebAssembly module from \`wasm/assembly/index.ts\`,
 * embedded as base64 (${wasm.length} bytes).
 */
export const GAS_WASM_BASE64 =
  '${base64.replace(/(.{100})/g, "$1' +\n  '")}';

export function gasWasmBytes(): Uint8Array<ArrayBuffer> {
  const binary = atob(GAS_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
`;

writeFileSync('src/wasm/gasWasm.generated.ts', generated);
console.log(`embedded ${wasm.length} bytes into src/wasm/gasWasm.generated.ts`);
