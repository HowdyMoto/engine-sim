import type { EngineDefinition } from '../builder/spec';
import { gmLs } from './gmLs';
import { toyota2jz } from './toyota2jz';
import { subaruEj25 } from './subaruEj25';
import { hayabusa } from './hayabusa';
import { kohlerCh750 } from './kohlerCh750';
import { radial9 } from './radial9';
import { hondaTrx520 } from './hondaTrx520';
import { harleyShovelhead } from './harleyShovelhead';
import { radial5 } from './radial5';
import { hondaVtec } from './hondaVtec';
import { audiI5 } from './audiI5';
import { bmwM52 } from './bmwM52';

export const ENGINES: EngineDefinition[] = [
  gmLs,
  toyota2jz,
  bmwM52,
  audiI5,
  hondaVtec,
  subaruEj25,
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
  bmwM52,
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
