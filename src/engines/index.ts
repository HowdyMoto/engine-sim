import type { EngineDefinition } from '../builder/spec';
import { gmLs } from './gmLs';
import { toyota2jz } from './toyota2jz';
import { subaruEj25, subaruEj25Uh } from './subaruEj25';
import { hayabusa } from './hayabusa';
import { kohlerCh750 } from './kohlerCh750';
import { radial9 } from './radial9';
import { hondaTrx520 } from './hondaTrx520';
import { harleyShovelhead } from './harleyShovelhead';
import { radial5 } from './radial5';
import { hondaVtec } from './hondaVtec';
import { audiI5 } from './audiI5';
import { bmwM52 } from './bmwM52';
import { v6Sixty, v6OddFire, v6EvenFire } from './v6Family';
import { merlinV12 } from './merlinV12';
import { lfaV10 } from './lfaV10';
import { ferrariF136 } from './ferrariF136';
import { ferrari412T2 } from './ferrari412T2';
import { chevy454 } from './chevy454';
import { flatPlaneV8 } from './flatPlaneV8';
import { smallBoreV8, bigBoreV8 } from './boreStrokeV8';
import { hondaVfr750 } from './hondaVfr750';
import { ducati999 } from './ducati999';
import { w8, w12, w16, w9 } from './wFamily';
import { v3Sixty, v5SeventyTwo } from './oddCylinderV';

export const ENGINES: EngineDefinition[] = [
  // V8s
  gmLs,
  chevy454,
  smallBoreV8,
  bigBoreV8,
  ferrariF136,
  flatPlaneV8,
  ferrari412T2,
  // Larger vees
  lfaV10,
  merlinV12,
  // Inlines
  toyota2jz,
  bmwM52,
  audiI5,
  hondaVtec,
  // V6s
  v6Sixty,
  v6EvenFire,
  v6OddFire,
  // Flats and twins
  subaruEj25,
  subaruEj25Uh,
  hayabusa,
  harleyShovelhead,
  ducati999,
  hondaVfr750,
  kohlerCh750,
  hondaTrx520,
  // W engines
  w8,
  w9,
  w12,
  w16,
  // Oddballs
  v3Sixty,
  v5SeventyTwo,
  radial5,
  radial9,
];

export const DEFAULT_ENGINE_ID = gmLs.id;

export function getEngineDefinition(id: string): EngineDefinition {
  return ENGINES.find((e) => e.id === id) ?? gmLs;
}

export {
  gmLs,
  chevy454,
  subaruEj25Uh,
  ferrariF136,
  ferrari412T2,
  flatPlaneV8,
  smallBoreV8,
  bigBoreV8,
  lfaV10,
  merlinV12,
  bmwM52,
  v6Sixty,
  v6OddFire,
  v6EvenFire,
  audiI5,
  hondaVtec,
  toyota2jz,
  subaruEj25,
  hayabusa,
  harleyShovelhead,
  ducati999,
  hondaVfr750,
  kohlerCh750,
  hondaTrx520,
  w8,
  w9,
  w12,
  w16,
  v3Sixty,
  v5SeventyTwo,
  radial5,
  radial9,
};
