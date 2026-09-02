import type { EngineDefinition } from '../builder/spec';
import { gmLs } from './gmLs';
import { subaruEj25 } from './subaruEj25';
import { kohlerCh750 } from './kohlerCh750';
import { radial9 } from './radial9';
import { toyota2jz } from './toyota2jz';
import { hayabusa } from './hayabusa';

export const ENGINES: EngineDefinition[] = [gmLs, toyota2jz, subaruEj25, hayabusa, kohlerCh750, radial9];

export const DEFAULT_ENGINE_ID = gmLs.id;

export function getEngineDefinition(id: string): EngineDefinition {
  return ENGINES.find((e) => e.id === id) ?? gmLs;
}

export { gmLs, toyota2jz, subaruEj25, hayabusa, kohlerCh750, radial9 };
