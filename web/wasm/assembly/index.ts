/**
 * WASM kernels for the gas system hot path.
 *
 * AssemblyScript port of the four operations that dominate the fluid
 * simulation: pair flow, environment flow, velocity update and excess-velocity
 * dissipation. Each mirrors its JavaScript counterpart in
 * `src/engine/gasSystem.ts` operation for operation - the JS versions are the
 * reference implementation and this file must be kept in sync with them.
 *
 * Gas state lives in linear memory as consecutive 18-double records; the slot
 * layout matches `GAS_STATE_STRIDE` and the offsets in gasSystem.ts.
 */

// Slot offsets, in doubles.
const N_MOL: i32 = 0;
const E_K: i32 = 1;
const VOL: i32 = 2;
const MOM_X: i32 = 3;
const MOM_Y: i32 = 4;
const P_FUEL: i32 = 5;
const P_INERT: i32 = 6;
const P_O2: i32 = 7;
const DOF: i32 = 8;
const HCR: i32 = 9;
const INV_HCR: i32 = 10;
const HALF_DOF: i32 = 11;
const CHOKED_LIMIT: i32 = 12;
const CHOKED_RATE: i32 = 13;
const WIDTH: i32 = 14;
const HEIGHT: i32 = 15;
const DIR_X: i32 = 16;
const DIR_Y: i32 = 17;

const STRIDE: i32 = 18;

/** Universal gas constant, as in `core/constants.ts`. */
const R: f64 = 8.31446261815324;

/** Molecular mass of air (kg/mol), as in `core/units.ts`. */
const AIR_MOLECULAR_MASS: f64 = 28.97 / 1000.0;

let statePtr: usize = 0;
let stateCapacity: i32 = 0;

/**
 * Reserve room for `count` gas systems and return the byte offset of the
 * state array. The host builds a Float64Array view over the module's memory
 * at this offset.
 *
 * Allocation goes through the stub runtime's heap so the block lands past
 * `__heap_base`. A fixed low pointer would sit inside the module's data
 * section and overwrite the lookup tables `Math.pow` reads from - gas-state
 * writes would silently corrupt every later `pow` call.
 */
export function reserve(count: i32): i32 {
  const bytes = <usize>count * STRIDE * 8;

  if (statePtr == 0) {
    statePtr = heap.alloc(bytes);
  } else {
    statePtr = heap.realloc(statePtr, bytes);
  }

  stateCapacity = count;
  return <i32>statePtr;
}

// ---- State access ---------------------------------------------------------

// @ts-ignore: decorator
@inline
function base(i: i32): usize {
  return statePtr + (<usize>i * STRIDE << 3);
}

// @ts-ignore: decorator
@inline
function get(p: usize, slot: i32): f64 {
  return load<f64>(p + (<usize>slot << 3));
}

// @ts-ignore: decorator
@inline
function set(p: usize, slot: i32, v: f64): void {
  store<f64>(p + (<usize>slot << 3), v);
}

// @ts-ignore: decorator
@inline
function clamp01(x: f64, lo: f64, hi: f64): f64 {
  if (x <= lo) return lo;
  if (x >= hi) return hi;
  return x;
}

// ---- Derived quantities ---------------------------------------------------

// @ts-ignore: decorator
@inline
function pressure(p: usize): f64 {
  const vol = get(p, VOL);
  return vol != 0 ? get(p, E_K) / (get(p, HALF_DOF) * vol) : 0;
}

// @ts-ignore: decorator
@inline
function temperature(p: usize): f64 {
  const n = get(p, N_MOL);
  if (n == 0) return 0;
  return get(p, E_K) / (get(p, HALF_DOF) * n * R);
}

// @ts-ignore: decorator
@inline
function mass(p: usize): f64 {
  return AIR_MOLECULAR_MASS * get(p, N_MOL);
}

// @ts-ignore: decorator
@inline
function speedOfSound(p: usize): f64 {
  const n = get(p, N_MOL);
  const ek = get(p, E_K);
  if (n == 0 || ek == 0) return 0;
  const m = AIR_MOLECULAR_MASS * n;
  return Math.sqrt((get(p, HCR) * ek) / (get(p, HALF_DOF) * m));
}

// @ts-ignore: decorator
@inline
function bulkKineticEnergy(p: usize): f64 {
  const m = AIR_MOLECULAR_MASS * get(p, N_MOL);
  if (m == 0) return 0;
  const mx = get(p, MOM_X);
  const my = get(p, MOM_Y);
  return (0.5 * (mx * mx + my * my)) / m;
}

// @ts-ignore: decorator
@inline
function kineticEnergyPerMol(p: usize): f64 {
  const n = get(p, N_MOL);
  return n != 0 ? get(p, E_K) / n : 0;
}

function dynamicPressure(p: usize, dx: f64, dy: f64): f64 {
  const n = get(p, N_MOL);
  const ek = get(p, E_K);
  if (n == 0 || ek == 0) return 0;

  const m = AIR_MOLECULAR_MASS * n;
  const v = (dx * get(p, MOM_X) + dy * get(p, MOM_Y)) / m;

  if (v <= 0) return 0;

  const hcr = get(p, HCR);
  const halfDof = get(p, HALF_DOF);
  const staticPressure = ek / (halfDof * get(p, VOL));

  const cSquared = (hcr * ek) / (halfDof * m);
  const machSquared = (v * v) / cSquared;

  const x = 1 + ((hcr - 1) / 2) * machSquared;
  let xD: f64;
  const dof = get(p, DOF);
  if (dof == 3) {
    xD = x * x * x * x * x;
  } else if (dof == 5) {
    const x2 = x * x;
    const x3 = x2 * x;
    xD = x3 * x3 * x;
  } else {
    xD = x;
  }

  return staticPressure * (Math.sqrt(xD) - 1);
}

function flowRate(
  kFlow: f64,
  p0In: f64,
  p1In: f64,
  t0: f64,
  t1: f64,
  hcr: f64,
  invHcr: f64,
  chokedFlowLimit: f64,
  chokedFlowRateCached: f64,
): f64 {
  if (kFlow == 0) return 0;

  let direction: f64;
  let t: f64;
  let pHigh: f64;
  let pLow: f64;

  if (p0In > p1In) {
    direction = 1.0;
    t = t0;
    pHigh = p0In;
    pLow = p1In;
  } else {
    direction = -1.0;
    t = t1;
    pHigh = p1In;
    pLow = p0In;
  }

  const pRatio = pLow / pHigh;
  let rate: f64 = 0;
  if (pRatio <= chokedFlowLimit) {
    rate = chokedFlowRateCached;
    rate /= Math.sqrt(R * t);
  } else {
    const s = Math.pow(pRatio, invHcr);
    rate = (2 * hcr) / (hcr - 1);
    rate *= s * (s - pRatio);
    rate = Math.sqrt(Math.max(rate, 0.0) / (R * t));
  }

  rate *= direction * pHigh;

  return rate * kFlow;
}

// @ts-ignore: decorator
@inline
function loseN(p: usize, dn: f64, ekPerMol: f64): void {
  set(p, E_K, get(p, E_K) - ekPerMol * dn);
  const next = get(p, N_MOL) - dn;
  set(p, N_MOL, next < 0 ? 0 : next);
}

function gainN(p: usize, dn: f64, ekPerMol: f64, pFuel: f64, pInert: f64, pO2: f64): void {
  const currentN = get(p, N_MOL);
  const nextN = currentN + dn;

  set(p, E_K, get(p, E_K) + dn * ekPerMol);
  set(p, N_MOL, nextN);

  if (nextN != 0) {
    const inv = 1 / nextN;
    set(p, P_FUEL, (get(p, P_FUEL) * currentN + dn * pFuel) * inv);
    set(p, P_INERT, (get(p, P_INERT) * currentN + dn * pInert) * inv);
    set(p, P_O2, (get(p, P_O2) * currentN + dn * pO2) * inv);
  } else {
    set(p, P_FUEL, 0);
    set(p, P_INERT, 0);
    set(p, P_O2, 0);
  }
}

// ---- Kernels --------------------------------------------------------------

export function dissipateExcessVelocity(i: i32): void {
  const p = base(i);
  const n = get(p, N_MOL);
  if (n == 0) return;

  const m = AIR_MOLECULAR_MASS * n;
  const invMass = 1 / m;
  const vx = get(p, MOM_X) * invMass;
  const vy = get(p, MOM_Y) * invMass;
  const vSquared = vx * vx + vy * vy;

  if (vSquared == 0) return;

  const ek = get(p, E_K);
  const cSquared = ek != 0 ? (get(p, HCR) * ek) / (get(p, HALF_DOF) * m) : 0;
  if (cSquared >= vSquared) return;

  const k = Math.sqrt(cSquared / vSquared);

  set(p, MOM_X, get(p, MOM_X) * k);
  set(p, MOM_Y, get(p, MOM_Y) * k);

  let nextEk = get(p, E_K) + 0.5 * m * (vSquared - cSquared);
  if (nextEk < 0) nextEk = 0;
  set(p, E_K, nextEk);
}

export function updateVelocity(i: i32, dt: f64, beta: f64): void {
  const p = base(i);
  if (get(p, N_MOL) == 0) return;

  const width = get(p, WIDTH);
  const height = get(p, HEIGHT);
  const depth = get(p, VOL) / (width * height);
  const dx = get(p, DIR_X);
  const dy = get(p, DIR_Y);

  let dMomX: f64 = 0;
  let dMomY: f64 = 0;

  const p0 = dynamicPressure(p, dx, dy);
  const p1 = dynamicPressure(p, -dx, -dy);
  const p2 = dynamicPressure(p, dy, dx);
  const p3 = dynamicPressure(p, -dy, -dx);

  const pSa0 = p0 * (height * depth);
  const pSa1 = p1 * (height * depth);
  const pSa2 = p2 * (width * depth);
  const pSa3 = p3 * (width * depth);

  dMomX += pSa0 * dx;
  dMomY += pSa0 * dy;

  dMomX -= pSa1 * dx;
  dMomY -= pSa1 * dy;

  dMomX += pSa2 * dy;
  dMomY += pSa2 * dx;

  dMomX -= pSa3 * dy;
  dMomY -= pSa3 * dx;

  const m = AIR_MOLECULAR_MASS * get(p, N_MOL);
  const invM = 1 / m;
  const v0x = get(p, MOM_X) * invM;
  const v0y = get(p, MOM_Y) * invM;

  set(p, MOM_X, get(p, MOM_X) - dMomX * dt * beta);
  set(p, MOM_Y, get(p, MOM_Y) - dMomY * dt * beta);

  const v1x = get(p, MOM_X) * invM;
  const v1y = get(p, MOM_Y) * invM;

  let ek = get(p, E_K);
  ek -= 0.5 * m * (v1x * v1x - v0x * v0x);
  ek -= 0.5 * m * (v1y * v1y - v0y * v0y);

  if (ek < 0) ek = 0;
  set(p, E_K, ek);
}

export function envFlow(
  i: i32,
  kFlow: f64,
  dt: f64,
  pEnv: f64,
  tEnv: f64,
  pFuel: f64,
  pInert: f64,
  pO2: f64,
): f64 {
  const p = base(i);

  // pressureEquilibriumMaxFlowEnv
  const halfDof = get(p, HALF_DOF);
  const vol = get(p, VOL);
  const ek = get(p, E_K);

  let maxFlow: f64;
  if (pressure(p) > pEnv) {
    maxFlow = -(pEnv * (halfDof * vol) - ek) / kineticEnergyPerMol(p);
  } else {
    const ekPerMolEnv = tEnv * R * halfDof;
    maxFlow = -(pEnv * (halfDof * vol) - ek) / ekPerMolEnv;
  }

  let flow =
    dt *
    flowRate(
      kFlow,
      pressure(p),
      pEnv,
      temperature(p),
      tEnv,
      get(p, HCR),
      get(p, INV_HCR),
      get(p, CHOKED_LIMIT),
      get(p, CHOKED_RATE),
    );

  if (Math.abs(flow) > Math.abs(maxFlow)) {
    flow = maxFlow;
  }

  if (flow < 0) {
    const bulk0 = bulkKineticEnergy(p);
    gainN(p, -flow, 0.5 * tEnv * R * get(p, DOF), pFuel, pInert, pO2);
    const bulk1 = bulkKineticEnergy(p);
    set(p, E_K, get(p, E_K) + (bulk1 - bulk0));
  } else {
    const startingN = get(p, N_MOL);
    loseN(p, flow, kineticEnergyPerMol(p));

    if (startingN != 0) {
      set(p, MOM_X, get(p, MOM_X) - (flow / startingN) * get(p, MOM_X));
      set(p, MOM_Y, get(p, MOM_Y) - (flow / startingN) * get(p, MOM_Y));
    }
  }

  return flow;
}

export function pairFlow(
  i0: i32,
  i1: i32,
  kFlow: f64,
  dt: f64,
  directionX: f64,
  directionY: f64,
  crossSectionArea0: f64,
  crossSectionArea1: f64,
): f64 {
  if (kFlow == 0) return 0;

  const pa = base(i0);
  const pb = base(i1);

  const P0 = pressure(pa) + dynamicPressure(pa, directionX, directionY);
  const P1 = pressure(pb) + dynamicPressure(pb, -directionX, -directionY);

  let src: usize;
  let snk: usize;
  let srcPressure: f64;
  let snkPressure: f64;
  let dx: f64;
  let dy: f64;
  let srcCrossSection: f64;
  let snkCrossSection: f64;
  let direction: f64;

  if (P0 > P1) {
    dx = directionX;
    dy = directionY;
    src = pa;
    snk = pb;
    srcPressure = P0;
    snkPressure = P1;
    srcCrossSection = crossSectionArea0;
    snkCrossSection = crossSectionArea1;
    direction = 1.0;
  } else {
    dx = -directionX;
    dy = -directionY;
    src = pb;
    snk = pa;
    srcPressure = P1;
    snkPressure = P0;
    srcCrossSection = crossSectionArea1;
    snkCrossSection = crossSectionArea0;
    direction = -1.0;
  }

  let flow =
    dt *
    flowRate(
      kFlow,
      srcPressure,
      snkPressure,
      temperature(src),
      temperature(snk),
      get(src, HCR),
      get(src, INV_HCR),
      get(src, CHOKED_LIMIT),
      get(src, CHOKED_RATE),
    );

  const sourceN = get(src, N_MOL);
  flow = clamp01(flow, 0.0, 0.9 * sourceN);

  const fraction = sourceN != 0 ? flow / sourceN : 0;
  const fractionVolume = fraction * get(src, VOL);
  const fractionMass = fraction * mass(src);

  if (flow != 0) {
    // Stage 1: the fraction moves from source to sink, carrying its momentum.
    const bulkSrc0 = bulkKineticEnergy(src);
    const bulkSnk0 = bulkKineticEnergy(snk);

    const ekPerMol = kineticEnergyPerMol(src);
    gainN(snk, flow, ekPerMol, get(src, P_FUEL), get(src, P_INERT), get(src, P_O2));
    loseN(src, flow, ekPerMol);

    const dpX = get(src, MOM_X) * fraction;
    const dpY = get(src, MOM_Y) * fraction;
    set(src, MOM_X, get(src, MOM_X) - dpX);
    set(src, MOM_Y, get(src, MOM_Y) - dpY);

    set(snk, MOM_X, get(snk, MOM_X) + dpX);
    set(snk, MOM_Y, get(snk, MOM_Y) + dpY);

    const bulkSrc1 = bulkKineticEnergy(src);
    const bulkSnk1 = bulkKineticEnergy(snk);

    set(snk, E_K, get(snk, E_K) - (bulkSrc1 + bulkSnk1 - (bulkSrc0 + bulkSnk0)));
  }

  const sourceMass = mass(src);
  const invSourceMass = 1 / sourceMass;
  const sinkMass = mass(snk);
  const invSinkMass = 1 / sinkMass;

  const cSource = speedOfSound(src);
  const cSink = speedOfSound(snk);

  const srcMom0X = get(src, MOM_X);
  const srcMom0Y = get(src, MOM_Y);
  const snkMom0X = get(snk, MOM_X);
  const snkMom0Y = get(snk, MOM_Y);

  // Stage 2: the moving fraction imparts momentum through each port.
  if (snkCrossSection != 0) {
    const v = clamp01(fractionVolume / snkCrossSection / dt, 0.0, cSink);
    set(snk, MOM_X, get(snk, MOM_X) + v * dx * fractionMass);
    set(snk, MOM_Y, get(snk, MOM_Y) + v * dy * fractionMass);
  }

  if (srcCrossSection != 0 && sourceMass != 0) {
    const v = clamp01(fractionVolume / srcCrossSection / dt, 0.0, cSource);
    set(src, MOM_X, get(src, MOM_X) + v * dx * fractionMass);
    set(src, MOM_Y, get(src, MOM_Y) + v * dy * fractionMass);
  }

  if (sourceMass != 0) {
    const v0x = srcMom0X * invSourceMass;
    const v0y = srcMom0Y * invSourceMass;
    const v1x = get(src, MOM_X) * invSourceMass;
    const v1y = get(src, MOM_Y) * invSourceMass;

    let ek = get(src, E_K);
    ek -= 0.5 * sourceMass * (v1x * v1x - v0x * v0x);
    ek -= 0.5 * sourceMass * (v1y * v1y - v0y * v0y);
    set(src, E_K, ek);
  }

  if (sinkMass > 0) {
    const v0x = snkMom0X * invSinkMass;
    const v0y = snkMom0Y * invSinkMass;
    const v1x = get(snk, MOM_X) * invSinkMass;
    const v1y = get(snk, MOM_Y) * invSinkMass;

    let ek = get(snk, E_K);
    ek -= 0.5 * sinkMass * (v1x * v1x - v0x * v0x);
    ek -= 0.5 * sinkMass * (v1y * v1y - v0y * v0y);
    set(snk, E_K, ek);
  }

  if (get(snk, E_K) < 0) set(snk, E_K, 0);
  if (get(src, E_K) < 0) set(src, E_K, 0);

  return flow * direction;
}


// ---- Constraint solver kernel ---------------------------------------------
//
// Projected Gauss-Seidel solve of (J W J^T) lambda = right with per-row
// limits, mirroring src/physics/gaussSeidelSleSolver.ts operation for
// operation. The host copies J, W, right, limits and the warm-start x into
// the arena, calls solverSolve, and reads x back.

const SLE_E: i32 = 2; // entries (bodies) per constraint row
const SLE_S: i32 = 3; // values per block (x, y, theta)
const SLE_EMPTY: i32 = 0xff;

let sleArena: usize = 0;
let sleMaxRows: i32 = 0;
let sleMaxBodies: i32 = 0;

// Host-visible arena regions.
let sleJ: usize = 0;
let sleW: usize = 0;
let sleRight: usize = 0;
let sleLimits: usize = 0;
let sleX: usize = 0;
let sleBlocks: usize = 0;

// Internal scratch.
let sleBucketStart: usize = 0;
let sleBucketFill: usize = 0;
let sleBucketRow: usize = 0;
let sleBucketEntry: usize = 0;
let sleAcc: usize = 0;
let sleTouched: usize = 0;
let sleInTouched: usize = 0;
let sleRowStart: usize = 0;
let sleDiagonal: usize = 0;
let sleColIndex: usize = 0;
let sleValues: usize = 0;
let sleCapacity: i32 = 0;

export function solverReserve(maxRows: i32, maxBodies: i32): i32 {
  const jBytes = <usize>maxRows * SLE_E * SLE_S * 8;
  const wBytes = <usize>maxBodies * SLE_S * 8;
  const rowBytes = <usize>maxRows * 8;
  const blockBytes = (<usize>maxRows * SLE_E + 7) & ~<usize>7;

  const arenaBytes = jBytes + wBytes + rowBytes * 4 + blockBytes;
  sleArena = heap.alloc(arenaBytes);
  sleMaxRows = maxRows;
  sleMaxBodies = maxBodies;

  let p = sleArena;
  sleJ = p;
  p += jBytes;
  sleW = p;
  p += wBytes;
  sleRight = p;
  p += rowBytes;
  sleLimits = p;
  p += rowBytes * 2;
  sleX = p;
  p += rowBytes;
  sleBlocks = p;

  sleBucketStart = heap.alloc(<usize>(maxBodies + 1) * 4);
  sleBucketFill = heap.alloc(<usize>(maxBodies + 1) * 4);
  sleBucketRow = heap.alloc(<usize>maxRows * SLE_E * 4);
  sleBucketEntry = heap.alloc(<usize>maxRows * SLE_E * 4);
  sleAcc = heap.alloc(<usize>maxRows * 8);
  sleTouched = heap.alloc(<usize>maxRows * 4);
  sleInTouched = heap.alloc(<usize>maxRows);
  memory.fill(sleInTouched, 0, <usize>maxRows);
  sleRowStart = heap.alloc(<usize>(maxRows + 1) * 4);
  sleDiagonal = heap.alloc(<usize>maxRows * 8);
  sleCapacity = 0;

  return <i32>sleArena;
}

// @ts-ignore: decorator
@inline
function f64At(p: usize, i: i32): f64 {
  return load<f64>(p + (<usize>i << 3));
}

// @ts-ignore: decorator
@inline
function setF64(p: usize, i: i32, v: f64): void {
  store<f64>(p + (<usize>i << 3), v);
}

// @ts-ignore: decorator
@inline
function i32At(p: usize, i: i32): i32 {
  return load<i32>(p + (<usize>i << 2));
}

// @ts-ignore: decorator
@inline
function setI32(p: usize, i: i32, v: i32): void {
  store<i32>(p + (<usize>i << 2), v);
}

function buildSystemMatrix(n: i32, bodyCount: i32): void {
  const rowStride = SLE_E * SLE_S;

  for (let b = 0; b <= bodyCount; ++b) setI32(sleBucketStart, b, 0);

  for (let i = 0; i < n; ++i) {
    for (let k = 0; k < SLE_E; ++k) {
      const b = <i32>load<u8>(sleBlocks + <usize>(i * SLE_E + k));
      if (b != SLE_EMPTY) setI32(sleBucketStart, b + 1, i32At(sleBucketStart, b + 1) + 1);
    }
  }

  for (let b = 0; b < bodyCount; ++b) {
    setI32(sleBucketStart, b + 1, i32At(sleBucketStart, b + 1) + i32At(sleBucketStart, b));
    setI32(sleBucketFill, b, i32At(sleBucketStart, b));
  }

  for (let i = 0; i < n; ++i) {
    for (let k = 0; k < SLE_E; ++k) {
      const b = <i32>load<u8>(sleBlocks + <usize>(i * SLE_E + k));
      if (b == SLE_EMPTY) continue;
      const slot = i32At(sleBucketFill, b);
      setI32(sleBucketFill, b, slot + 1);
      setI32(sleBucketRow, slot, i);
      setI32(sleBucketEntry, slot, k);
    }
  }

  // Worst case one entry per (row, body-sharing row) pair.
  let capacity = 0;
  for (let i = 0; i < n; ++i) {
    for (let k = 0; k < SLE_E; ++k) {
      const b = <i32>load<u8>(sleBlocks + <usize>(i * SLE_E + k));
      if (b == SLE_EMPTY) continue;
      capacity += i32At(sleBucketStart, b + 1) - i32At(sleBucketStart, b);
    }
  }

  if (capacity > sleCapacity) {
    if (sleColIndex != 0) {
      sleColIndex = heap.realloc(sleColIndex, <usize>capacity * 4);
      sleValues = heap.realloc(sleValues, <usize>capacity * 8);
    } else {
      sleColIndex = heap.alloc(<usize>capacity * 4);
      sleValues = heap.alloc(<usize>capacity * 8);
    }
    sleCapacity = capacity;
  }

  let nnz = 0;
  for (let i = 0; i < n; ++i) {
    setI32(sleRowStart, i, nnz);
    let touchedCount = 0;
    setF64(sleDiagonal, i, 0);

    for (let k = 0; k < SLE_E; ++k) {
      const b = <i32>load<u8>(sleBlocks + <usize>(i * SLE_E + k));
      if (b == SLE_EMPTY) continue;

      const iBase = i * rowStride + k * SLE_S;
      const a0 = f64At(sleW, b * SLE_S + 0) * f64At(sleJ, iBase + 0);
      const a1 = f64At(sleW, b * SLE_S + 1) * f64At(sleJ, iBase + 1);
      const a2 = f64At(sleW, b * SLE_S + 2) * f64At(sleJ, iBase + 2);

      const end = i32At(sleBucketStart, b + 1);
      for (let p = i32At(sleBucketStart, b); p < end; ++p) {
        const j = i32At(sleBucketRow, p);
        const jBase = j * rowStride + i32At(sleBucketEntry, p) * SLE_S;

        const dot =
          a0 * f64At(sleJ, jBase + 0) + a1 * f64At(sleJ, jBase + 1) + a2 * f64At(sleJ, jBase + 2);

        if (j == i) {
          setF64(sleDiagonal, i, f64At(sleDiagonal, i) + dot);
        } else if (load<u8>(sleInTouched + <usize>j) == 0) {
          store<u8>(sleInTouched + <usize>j, 1);
          setI32(sleTouched, touchedCount++, j);
          setF64(sleAcc, j, dot);
        } else {
          setF64(sleAcc, j, f64At(sleAcc, j) + dot);
        }
      }
    }

    for (let t = 0; t < touchedCount; ++t) {
      const j = i32At(sleTouched, t);
      store<u8>(sleInTouched + <usize>j, 0);
      setI32(sleColIndex, nnz, j);
      setF64(sleValues, nnz, f64At(sleAcc, j));
      ++nnz;
    }
  }

  setI32(sleRowStart, n, nnz);
}

function sleSweep(n: i32, hasLimits: i32): f64 {
  let maxDifference: f64 = 0.0;

  for (let i = 0; i < n; ++i) {
    let sum: f64 = 0.0;
    const end = i32At(sleRowStart, i + 1);
    for (let p = i32At(sleRowStart, i); p < end; ++p) {
      sum += f64At(sleValues, p) * f64At(sleX, i32At(sleColIndex, p));
    }

    let next = (f64At(sleRight, i) - sum) / f64At(sleDiagonal, i);

    const prev = f64At(sleX, i);
    let delta: f64;

    if (hasLimits == 0) {
      const minK = prev > 1e-3 ? prev : 1e-3;
      delta = (Math.abs(next) - minK) / minK;
    } else {
      const limitMin = f64At(sleLimits, i * 2 + 0);
      const limitMax = f64At(sleLimits, i * 2 + 1);
      next = next < limitMin ? limitMin : next > limitMax ? limitMax : next;

      const absPrev = Math.abs(prev);
      const minK = absPrev > 1e-3 ? absPrev : 1e-3;
      delta = Math.abs(next - prev) / minK;
    }

    if (delta > maxDifference) maxDifference = delta;
    setF64(sleX, i, next);
  }

  return maxDifference;
}

export function solverSolve(
  n: i32,
  bodyCount: i32,
  hasLimits: i32,
  maxIterations: i32,
  minDelta: f64,
): i32 {
  if (n == 0) return 1;

  buildSystemMatrix(n, bodyCount);

  for (let i = 0; i < maxIterations; ++i) {
    if (sleSweep(n, hasLimits) < minDelta) return 1;
  }

  return 0;
}
