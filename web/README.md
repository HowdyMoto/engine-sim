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
npm run benchmark  # headless performance probe
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

Bundled: **GM LS V8**, **Toyota 2JZ** (inline six), **Subaru EJ25** (flat four),
**Suzuki Hayabusa** (inline four, 11 000 rpm), **Kohler CH750** (governed
90° V-twin), **Radial 9** (articulated rods — one master rod on the crank
journal, eight slaves on journals carried by the master's big end; it cranks
slowly against 2.4 kg·m² of flywheel, so hold the starter).

Shared parts from `es/part-library/` live in `src/engines/parts.ts`.

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

Measured with `npm run benchmark` on a desktop (Node 24, full fidelity — nominal
simulation rate, 8 fluid sub-steps):

| Engine | Rate | Cylinders | Realtime factor |
| --- | --- | --- | --- |
| GM LS V8 | 10 kHz | 8 | ~1.1x |
| Subaru EJ25 | 20 kHz | 4 | ~1.1x |
| Kohler CH750 | 30 kHz | 2 | ~1.2x |

That is enough on a desktop and marginal on slower hardware, which is what the
adaptive quality control is for. The remaining cost is roughly 45% fluid
simulation, 20% constraint solve, 35% everything else; moving the gas system and
the solver to WebAssembly is the obvious next step if more headroom is wanted.

## Controls

Same scheme as the original — press **Controls** in the header for the full
table.
