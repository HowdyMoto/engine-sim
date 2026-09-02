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

export const ENGINES: EngineDefinition[] = [
  gmLs,
  chevy454,
  ferrariF136,
  ferrari412T2,
  lfaV10,
  merlinV12,
  toyota2jz,
  bmwM52,
  audiI5,
  hondaVtec,
  v6Sixty,
  v6EvenFire,
  v6OddFire,
  subaruEj25,
  subaruEj25Uh,
  hayabusa,
  harleyShovelhead,
  kohlerCh750,
  hondaTrx520,
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
  kohlerCh750,
  hondaTrx520,
  radial5,
  radial9,
};
