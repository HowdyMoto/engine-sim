/** Ported from `include/transmission.h` / `src/transmission.cpp`. */
import * as units from '../core/units';
import { ClutchConstraint } from '../physics/constraints/clutchConstraint';
import type { RigidBodySystem } from '../physics/rigidBodySystem';
import type { RigidBody } from '../physics/rigidBody';
import type { Vehicle } from './vehicle';
import type { Engine } from './engine';

export interface TransmissionParameters {
  gearRatios: number[];
  maxClutchTorque?: number;
}

export class Transmission {
  private clutchConstraint = new ClutchConstraint();
  private rotatingMass: RigidBody | null = null;
  private vehicle: Vehicle | null = null;

  /** -1 is neutral. */
  private gear = -1;
  private gearRatios: number[] = [];
  private maxClutchTorque = units.torque(1000.0, units.ft_lb);
  private clutchPressure = 0.0;

  initialize(params: TransmissionParameters): void {
    this.gearRatios = [...params.gearRatios];
    this.maxClutchTorque = params.maxClutchTorque ?? this.maxClutchTorque;
  }

  update(_dt: number): void {
    if (this.gear === -1) {
      this.clutchConstraint.minTorque = 0;
      this.clutchConstraint.maxTorque = 0;
    } else {
      this.clutchConstraint.minTorque = -this.maxClutchTorque * this.clutchPressure;
      this.clutchConstraint.maxTorque = this.maxClutchTorque * this.clutchPressure;
    }
  }

  addToSystem(
    system: RigidBodySystem,
    rotatingMass: RigidBody,
    vehicle: Vehicle,
    engine: Engine,
  ): void {
    this.rotatingMass = rotatingMass;
    this.vehicle = vehicle;

    this.clutchConstraint.setBody1(engine.getOutputCrankshaft().body);
    this.clutchConstraint.setBody2(rotatingMass);

    system.addConstraint(this.clutchConstraint);
  }

  /**
   * Change gear, re-deriving the rotating mass's inertia so that the vehicle's
   * road speed is preserved across the shift.
   */
  changeGear(newGear: number): void {
    if (newGear < -1 || newGear >= this.gearRatios.length) return;

    if (newGear !== -1) {
      const body = this.rotatingMass!;
      const m_car = this.vehicle!.getMass();
      const gear_ratio = this.gearRatios[newGear];
      const diff_ratio = this.vehicle!.getDiffRatio();
      const tire_radius = this.vehicle!.getTireRadius();
      const f = tire_radius / (diff_ratio * gear_ratio);

      const new_I = m_car * f * f;
      const E_r = 0.5 * body.I * body.v_theta * body.v_theta;
      const new_v_theta =
        body.v_theta < 0 ? -Math.sqrt((E_r * 2) / new_I) : Math.sqrt((E_r * 2) / new_I);

      body.I = new_I;
      body.p_x = body.p_y = 0;
      body.m = m_car;
      body.v_theta = new_v_theta;
    }

    this.gear = newGear;
  }

  getGear(): number {
    return this.gear;
  }

  getGearCount(): number {
    return this.gearRatios.length;
  }

  setClutchPressure(pressure: number): void {
    this.clutchPressure = pressure;
  }

  getClutchPressure(): number {
    return this.clutchPressure;
  }
}
