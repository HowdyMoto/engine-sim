import { describe, expect, it } from 'vitest';

import { PartitionedConvolver } from './convolver';
import { ConvolutionFilter } from './filters';

/** Reference: the direct-form FIR the original uses, sample by sample. */
function directConvolve(impulseResponse: Float32Array, input: Float32Array): Float32Array {
  const filter = new ConvolutionFilter();
  filter.initialize(impulseResponse.length);
  filter.getImpulseResponse().set(impulseResponse);

  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; ++i) output[i] = filter.f(input[i]);
  return output;
}

function makeImpulseResponse(length: number): Float32Array {
  const ir = new Float32Array(length);
  for (let i = 0; i < length; ++i) {
    // Decaying noise burst, roughly the shape of a real exhaust response.
    ir[i] = Math.sin(i * 0.37) * Math.exp(-i / (length / 4));
  }
  return ir;
}

function makeInput(length: number): Float32Array {
  const input = new Float32Array(length);
  for (let i = 0; i < length; ++i) {
    input[i] = Math.sin(i * 0.031) + 0.4 * Math.sin(i * 0.21);
  }
  return input;
}

/**
 * Compare the partitioned convolver against the direct FIR, feeding the input
 * in blocks of `blockSize`. The partitioned form delays by one internal block,
 * so the comparison is made against a shifted reference.
 */
function compare(irLength: number, totalSamples: number, blockSize: number): number {
  const ir = makeImpulseResponse(irLength);
  const input = makeInput(totalSamples);
  const reference = directConvolve(ir, input);

  const convolver = new PartitionedConvolver();
  convolver.initialize(ir);
  const latency = convolver.latencySamples;

  const actual = new Float32Array(totalSamples);
  const scratch = new Float32Array(blockSize);

  for (let offset = 0; offset < totalSamples; offset += blockSize) {
    const count = Math.min(blockSize, totalSamples - offset);
    convolver.process(input.subarray(offset, offset + count) as Float32Array, scratch, count);
    actual.set(scratch.subarray(0, count), offset);
  }

  let worst = 0;
  for (let i = latency; i < totalSamples; ++i) {
    worst = Math.max(worst, Math.abs(actual[i] - reference[i - latency]));
  }
  return worst;
}

describe('PartitionedConvolver', () => {
  it('passes the signal through unchanged with no impulse response', () => {
    const convolver = new PartitionedConvolver();
    convolver.initialize(new Float32Array(0));

    const input = makeInput(64);
    const output = new Float32Array(64);
    convolver.process(input, output, 64);

    expect(convolver.isReady).toBe(false);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it.each([64, 128, 256, 512, 735, 1024, 1500, 2000])(
    'matches direct convolution when fed in blocks of %i',
    (blockSize) => {
      // 735 is one frame of audio at 60 fps, and 2000 is the synthesizer's
      // per-block cap - both are sizes the engine actually produces.
      expect(compare(2048, 8192, blockSize)).toBeLessThan(1e-3);
    },
  );

  it('matches direct convolution for a long impulse response', () => {
    expect(compare(10000, 12000, 1024)).toBeLessThan(1e-2);
  });

  it('is unaffected by how the input is split into blocks', () => {
    const ir = makeImpulseResponse(1024);
    const input = makeInput(4096);

    const runWith = (blockSize: number): Float32Array => {
      const convolver = new PartitionedConvolver();
      convolver.initialize(ir);

      const out = new Float32Array(input.length);
      const scratch = new Float32Array(blockSize);
      for (let offset = 0; offset < input.length; offset += blockSize) {
        const count = Math.min(blockSize, input.length - offset);
        convolver.process(input.subarray(offset, offset + count) as Float32Array, scratch, count);
        out.set(scratch.subarray(0, count), offset);
      }
      return out;
    };

    const small = runWith(128);
    const large = runWith(1900);

    let worst = 0;
    for (let i = 0; i < input.length; ++i) worst = Math.max(worst, Math.abs(small[i] - large[i]));
    expect(worst).toBeLessThan(1e-4);
  });
});
