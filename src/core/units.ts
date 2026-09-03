/**
 * Unit system, ported from `include/units.h`.
 *
 * Every quantity in the simulation is stored in SI base units; these constants
 * convert to and from them (`5 * units.inch` is five inches expressed in metres).
 */
import { PI } from './constants';

// Force
export const N = 1.0;
export const lbf = N * 4.44822;

// Mass
export const kg = 1.0;
export const g = kg / 1000.0;
export const lb = 0.45359237 * kg;

// Distance
export const m = 1.0;
export const cm = m / 100.0;
export const mm = m / 1000.0;
export const km = m * 1000.0;
export const inch = cm * 2.54;
export const foot = inch * 12.0;
export const thou = inch / 1000.0;
export const mile = m * 1609.344;

// Time
export const sec = 1.0;
export const minute = 60 * sec;
export const hour = 60 * minute;

// Torque
export const Nm = N * m;
export const ft_lb = foot * lbf;

// Power
export const W = Nm / sec;
export const kW = W * 1000.0;
export const hp = 745.699872 * W;

// Volume
export const m3 = 1.0;
export const cc = cm * cm * cm;
export const mL = cc;
export const L = mL * 1000.0;
export const cubic_feet = foot * foot * foot;
export const cubic_inches = inch * inch * inch;
export const gal = 3.785411784 * L;

// Molecular
export const mol = 1.0;
export const kmol = mol / 1000.0;
export const mmol = mol / 1000000.0;
export const lbmol = mol * 453.59237;

// Flow-rate (moles)
export const mol_per_sec = mol / sec;
export const scfm = 0.002641 * lbmol / minute;

// Area
export const m2 = 1.0;
export const cm2 = cm * cm;

// Pressure
export const Pa = 1.0;
export const kPa = Pa * 1000.0;
export const MPa = Pa * 1000000.0;
export const atm = 101.325 * kPa;
export const mbar = Pa * 100.0;
export const bar = mbar * 1000.0;
export const psi = lbf / (inch * inch);
export const psig = psi;
export const inHg = Pa * 3386.3886666666713;
export const inH2O = inHg * 0.0734824;

// Temperature
export const K = 1.0;
export const K0 = 273.15;
export const C = K;
export const F = (5.0 / 9.0) * K;
export const F0 = -459.67;

// Energy
export const J = 1.0;
export const kJ = J * 1000;
export const MJ = J * 1000000;

// Angles
export const rad = 1.0;
export const deg = rad * (PI / 180);

// Speed
export const mph = mile / hour;
export const kph = km / hour;

// Conversions
export const distance = (v: number, unit: number) => v * unit;
export const area = (v: number, unit: number) => v * unit;
export const torque = (v: number, unit: number) => v * unit;
export const pressure = (v: number, unit: number) => v * unit;
export const mass = (v: number, unit: number) => v * unit;
export const force = (v: number, unit: number) => v * unit;
export const volume = (v: number, unit: number) => v * unit;
export const flow = (v: number, unit: number) => v * unit;
export const angle = (v: number, unit: number) => v * unit;
export const energy = (v: number, unit: number) => v * unit;

/** Revolutions per minute to rad/s. */
export const rpm = (v: number) => v * 0.104719755;
/** rad/s to revolutions per minute. */
export const toRpm = (rad_s: number) => rad_s / 0.104719755;

export const psia = (p: number) => pressure(p, psig) - pressure(1.0, atm);
export const toPsia = (p: number) => (p + pressure(1.0, atm)) / psig;

export const convert = (v: number, unit0: number, unit1 = 1.0) => v * (unit0 / unit1);
export const convertTo = (v: number, unit: number) => v / unit;

export const celcius = (T_C: number) => T_C * C + K0;
export const kelvin = (T: number) => T * K;
export const fahrenheit = (T_F: number) => F * (T_F - F0);
export const toAbsoluteFahrenheit = (T: number) => T / F;

/** Molecular mass of air (kg / mol). */
export const AirMolecularMass = mass(28.97, g) / mol;
