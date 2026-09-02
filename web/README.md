# Engine Simulator — TypeScript / Web

A port of this repository's C++ engine simulator to TypeScript, running entirely
in the browser. The physics, thermodynamics and audio synthesis are ported from
the original source rather than reimplemented: the same constraint solver, the
same zero-dimensional gas model, the same flame propagation and the same filter
chain, driving Canvas 2D for the view and an AudioWorklet for sound.

```
npm install
npm run dev        # development server
npm run build      # production bundle into dist/
npm test           # simulation test suite
npm run benchmark  # headless performance probe (JS vs WASM)
npm run build:wasm # recompile the AssemblyScript gas kernels
```

Audio needs a user gesture, so the page opens behind a **Start** button. After
that, press <kbd>A</kbd> for ignition and hold <kbd>S</kbd> to crank.

## What maps to what

| Web app | Original |
| --- | --- |
| `src/physics/` | `dependencies/submodules/simple-2d-constraint-solver` |
| `src/engine/` | `include/` + `src/` (crankshaft, piston, gas system, chambers, …) |
| `src/sim/` | `simulator.cpp`, `piston_engine_simulator.cpp` |
| `src/audio/` | `synthesizer.cpp` and the `*_filter` files |
| `src/builder/`, `src/engines/` | the `.mr` scripting language and `assets/engines` |
| `src/ui/`, `src/main.ts` | `engine_sim_application.cpp` and the gauge clusters |
| `src/ui/themes.ts` | `assets/themes/*.mr` (all six themes, selectable in the header) |
| `src/wasm/`, `wasm/assembly/` | (new) WebAssembly kernels for the gas-system hot path |

## Architecture

The simulation runs on a **Web Worker**. It owns the engine, the rigid body
system and the synthesizer, and each frame it posts back two transferable
buffers: a packed `Float32Array` of state for the renderer, and a block of audio
samples. The page never touches simulation objects, so a heavy physics frame
cannot stall rendering or input.

Audio is played by an **AudioWorklet** that does nothing but buffer and emit the
samples the worker sends. It reports its buffer occupancy back, and the worker
folds that into the same latency feedback loop the original uses to decide how
many physics steps to run per frame (`Simulator::startFrame`).

```
 main thread                     worker                        audio thread
 ┌───────────────┐  control    ┌──────────────────┐  samples  ┌──────────────┐
 │ input, canvas │───────────▶ │ physics + fluid  │──────────▶│ AudioWorklet │
 │ gauges, HUD   │ ◀───────────│ + synthesizer    │◀──────────│ ring buffer  │
 └───────────────┘  state/audio└──────────────────┘  fill     └──────────────┘
```

## Engines

Engines are defined in `src/engines/` as plain TypeScript objects that mirror
the structure of the original `.mr` files — rod journals, ignition wires,
cylinder banks and heads are the same concepts with the same numbers, and
`src/builder/buildEngine.ts` assembles them in the same order as
`EngineNode::buildEngine`. Porting another `.mr` file is a mechanical
translation; no compiler for the scripting language is needed.

Bundled - twenty-one of them, covering every distinct definition in
`assets/engines/`:

GM LS V8 · Chevy 454 big block · Ferrari F136 (flat-plane V8) · Ferrari 412 T2
(75° F1 V12, 18 000 rpm) · Lexus LFA V10 · Merlin V-1650 aero V12 · Toyota 2JZ ·
BMW M52B28 · Audi inline five · Honda B18C5 VTEC (reverse rotation, cam
switchover) · 60°/odd-fire/even-fire generic V6s · Subaru EJ25 (equal and
unequal headers) · Suzuki Hayabusa · Harley Shovelhead · Kohler CH750 (governed)
· Honda TRX520 · Radial 5 · Radial 9 (articulated rods).

Big, high-compression engines behave like the real thing on the starter: the
radials crank slowly and the Merlin sits compression-locked for several seconds
until blowby bleeds the locked cylinders down, then catches. Some engines have
no idle bypass in their source data (the 2JZ, for one) and need throttle to run.

Not ported, as tunes of the above: `audi/i5.mr` (a 2.2 L tune),
`chevrolet/engine_03_for_e1.mr` (a carburettor tune of the 454),
`kohler/kohler_ch750.mr` (a pre-governor revision) and
`atg-video-1/06_subaru_ej25.mr` (an earlier EJ25 revision).

Shared parts from `es/part-library/` live in `src/engines/parts.ts`. The BMW
and 454 sources define no vehicle or transmission; the port supplies those,
marked as such in each file.

The impulse response library names files under `assets/sound-library/new/` and
`sharp/`, neither of which was ever committed upstream — only `smooth/` and
`archive/` exist, so just one of its nine responses resolves.
`src/audio/impulseResponses.ts` maps the missing names onto available `smooth/`
responses of roughly the right character, and says so.

## Deliberate deviations

Everything else follows the C++ closely; these five places do not, and each is
commented at the site.

1. **Sparse constraint solve.** The original forms `J W Jᵀ` densely and sweeps
   all of it. Constraint rows only couple when they share a body, so the matrix
   is mostly zeros. `gaussSeidelSleSolver.ts` builds the product directly in
   compressed sparse row form and sweeps only the non-zeros — same arithmetic,
   roughly five times faster, and the difference between a V8 running in real
   time in a browser and not.

2. **FFT convolution.** The exhaust impulse response is up to 10 000 taps. As a
   direct FIR on two exhaust channels that is close to a billion multiplies a
   second — fine in optimised C++, hopeless in JavaScript. `convolver.ts` does
   the same convolution with uniform partitioning in the frequency domain, at
   about one twentieth of the arithmetic and one block (256 samples) of extra
   latency.

3. **Synchronous synthesis.** The C++ synthesizer renders on its own thread
   behind a condition variable. Here the simulation already has a worker to
   itself, so the render pass runs at the end of each input block. The 2000
   queued-sample cap is kept, because the latency feedback loop depends on it.

4. **Adaptive quality and a bounded catch-up.** The original exposes simulation
   frequency as a manual control and keeps up natively. A browser has to cope
   with whatever hardware it lands on, so the worker trades fluid sub-steps and
   simulation rate against measured frame load and against actual audio
   dropouts, which arrive sooner than the load average does. The per-frame step
   count is also capped at two frames' worth: it derives from elapsed time, so
   an unbounded catch-up spirals - a long frame asks for more steps, which
   takes longer still, until the audio queue starves. Under load the simulation
   falls slightly behind wall clock instead. Pin the Quality menu to disable
   the adaptation.

5. **A persistent throttle.** Q/W/E/R are momentary in the original and the
   throttle returns to zero on release. The on-screen slider sets a base
   position that the momentary keys still override - identical behaviour when
   the slider is left at zero.

6. **Injectable RNG.** Combustion efficiency is randomised per ignition event.
   That randomness now goes through `core/random.ts` so tests can seed it; the
   default is `Math.random`, as before.

## A bug found along the way

The C++ `Fuel` class defaults its turbulence-to-flame-speed curve to null, and
`max_dilution_effect` to 50. Every engine is actually built through the script
library, whose `fuel()` node supplies a real curve and a dilution effect of 10.
Engines that specify their own fuel (the LS, the EJ25) never notice; the Kohler
uses the default, and with a null curve its flame speed collapses to the laminar
burning velocity. It fires but cannot sustain itself. `builder/defaults.ts`
applies the script library's defaults, which is the layer they belong to, and
there is a regression test for it.

## Performance

The gas-system hot path — pair flow, environment flow, velocity update,
excess-velocity dissipation — also exists as AssemblyScript-compiled
WebAssembly kernels (`wasm/assembly/index.ts`, ~11 KB, embedded as base64 so
there is nothing extra to serve). Gas state lives in a `Float64Array` shared
with wasm linear memory; `GasSystem.bindTo` points a system at a slot and the
same code path serves both runtimes. The TypeScript implementations remain the
reference: a lockstep test drives both through hundreds of states and holds
them to 1e-9, and if instantiation fails the app silently keeps the JS path.
The diagnostics row shows which one is live.

Measured with `npm run benchmark` on a desktop (Node 24, full fidelity —
nominal simulation rate, 8 fluid sub-steps):

| Engine | Rate | Cylinders | JS | WASM |
| --- | --- | --- | --- | --- |
| GM LS V8 | 10 kHz | 8 | 1.5x | 2.2x |
| Ferrari 412 T2 | 5 kHz | 12 | 1.4x | 2.1x |
| Toyota 2JZ | 10 kHz | 6 | 1.8x | 2.5x |
| Honda B18C5 VTEC | 20 kHz | 4 | 1.0x | 1.4x |
| Subaru EJ25 | 20 kHz | 4 | 1.2x | 1.9x |
| Kohler CH750 | 30 kHz | 2 | 1.5x | 2.1x |
| Radial 9 | 8 kHz | 9 | 1.6x | 2.2x |

(realtime factors; the full sweep is `npm run benchmark`, one engine is
`npm run benchmark <id> [fluidSteps] [js|wasm|both]`). The kernels take
roughly 40% off the frame and put every engine in the roster above realtime
at full fidelity; the adaptive quality control covers slower hardware from
there.

One lesson learned the hard way: the first version of the wasm module parked
its state buffer at a fixed low address, which happened to sit on top of the
lookup tables AssemblyScript's `Math.pow` reads from — gas-state writes
corrupted `pow` for whichever inputs landed on the clobbered entries. State is
allocated through the runtime heap now, and the lockstep test would catch any
recurrence.

## Controls

Same scheme as the original — press **Controls** in the header for the full
table.
