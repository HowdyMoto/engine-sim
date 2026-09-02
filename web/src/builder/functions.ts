/**
 * Helpers for the sampled functions engine definitions need, mirroring the
 * `.mr` helpers `function()`, `add_flow_sample()` and `harmonic_cam_lobe()`.
 */
import { PI } from '../core/constants';
import * as units from '../core/units';
import { Func } from '../core/function';
import { GasSystem } from '../engine/gasSystem';

/** `function(filter_radius)` followed by `.add_sample(x, y)` calls. */
export function makeFunction(filterRadius: number, samples: [number, number][]): Func {
  const fn = new Func();
  fn.initialize(samples.length, filterRadius);
  for (const [x, y] of samples) fn.addSample(x, y);
  return fn;
}

/**
 * `add_flow_sample(lift, flow)`: lift in thou, flow as a 28 inH2O bench figure
 * in CFM.
 */
export function flowFunction(
  samples: [number, number][],
  liftScale = 1.0,
  flowAttenuation = 1.0,
): Func {
  const fn = new Func();
  fn.initialize(samples.length, units.distance(50, units.thou));
  for (const [lift, flow] of samples) {
    fn.addSample(
      units.distance(lift * liftScale, units.thou),
      GasSystem.k_28inH2O(flow * flowAttenuation),
    );
  }
  return fn;
}

export interface HarmonicCamLobeParameters {
  /** Duration measured at 50 thou of lift, in radians of crank angle. */
  durationAt50Thou: number;
  gamma?: number;
  lift?: number;
  steps?: number;
}

/**
 * Raised-cosine cam lobe profile, ported from `GenerateHarmonicCamLobeNode`
 * in `scripting/include/actions.h`. Returns lift as a function of camshaft
 * angle relative to the lobe centreline.
 */
export function harmonicCamLobe(params: HarmonicCamLobeParameters): Func {
  const durationAt50Thou = params.durationAt50Thou;
  const gamma = params.gamma ?? 1.0;
  const lift = params.lift ?? units.distance(300, units.thou);
  const steps = params.steps ?? 100;

  const fn = new Func();
  fn.initialize(steps * 2, 1.0);

  const angle = durationAt50Thou / 4;
  const s = Math.pow((2 * units.distance(50, units.thou)) / lift, 1 / gamma) - 1;
  const k = Math.acos(s) / angle;
  const extents = PI / k;

  const step = extents / (steps - 5.0);
  for (let i = 0; i < steps; ++i) {
    if (i === 0) {
      fn.addSample(0.0, lift);
    } else {
      const x = i * step;
      const l = x >= extents ? 0.0 : lift * Math.pow(0.5 + 0.5 * Math.cos(k * x), gamma);
      fn.addSample(x, l);
      fn.addSample(-x, l);
    }
  }

  fn.setFilterRadius(step);
  return fn;
}

/**
 * Timing curve helper: samples given as [rpm, degrees advance].
 */
export function timingCurve(samples: [number, number][], filterRadius = units.rpm(1000)): Func {
  return makeFunction(
    filterRadius,
    samples.map(([rpm, deg]) => [units.rpm(rpm), units.angle(deg, units.deg)] as [number, number]),
  );
}
