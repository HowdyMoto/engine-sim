/**
 * Vehicle inertia and road load, ported from `vehicle.cpp` and
 * `vehicle_drag_constraint.cpp`.
 *
 * The vehicle is modelled as a single rotating mass whose rotational energy
 * equals the car's translational kinetic energy.
 */
import { R } from '../core/constants';
import * as units from '../core/units';
import { Constraint, type ConstraintOutput } from '../physics/constraint';
import type { RigidBody } from '../physics/rigidBody';
import type { SystemState } from '../physics/systemState';

export interface VehicleParameters {
  mass: number;
  dragCoefficient: number;
  crossSectionArea: number;
  diffRatio: number;
  tireRadius: number;
  rollingResistance: number;
}

export class Vehicle {
  private rotatingMass: RigidBody | null = null;

  private mass = 0;
  private dragCoefficient = 0;
  private crossSectionArea = 0;
  private diffRatio = 0;
  private tireRadius = 0;
  private travelledDistance = 0;
  private rollingResistance = 0;

  initialize(params: VehicleParameters): void {
    this.mass = params.mass;
    this.dragCoefficient = params.dragCoefficient;
    this.crossSectionArea = params.crossSectionArea;
    this.diffRatio = params.diffRatio;
    this.tireRadius = params.tireRadius;
    this.rollingResistance = params.rollingResistance;
  }

  update(dt: number): void {
    this.travelledDistance += this.getSpeed() * dt;
  }

  setRotatingMass(rotatingMass: RigidBody): void {
    this.rotatingMass = rotatingMass;
  }

  getMass(): number {
    return this.mass;
  }

  getRollingResistance(): number {
    return this.rollingResistance;
  }

  getDragCoefficient(): number {
    return this.dragCoefficient;
  }

  getCrossSectionArea(): number {
    return this.crossSectionArea;
  }

  getDiffRatio(): number {
    return this.diffRatio;
  }

  getTireRadius(): number {
    return this.tireRadius;
  }

  getTravelledDistance(): number {
    return this.travelledDistance;
  }

  resetTravelledDistance(): void {
    this.travelledDistance = 0;
  }

  /** Road speed derived from the rotating mass's kinetic energy. */
  getSpeed(): number {
    const body = this.rotatingMass;
    if (body === null) return 0;

    const E_r = 0.5 * body.I * body.v_theta * body.v_theta;
    return Math.sqrt((2 * E_r) / this.mass);
  }

  linearForceToVirtualTorque(force: number): number {
    const body = this.rotatingMass!;
    const rotationToKineticRatio = Math.sqrt(body.I / this.mass);
    return rotationToKineticRatio * force;
  }
}

const AIR_DENSITY =
  (units.AirMolecularMass * units.pressure(1.0, units.atm)) / (R * units.celcius(25.0));

/** Aerodynamic drag plus rolling resistance applied to the rotating mass. */
export class VehicleDragConstraint extends Constraint {
  ks = 10.0;
  kd = 1.0;

  private vehicle: Vehicle | null = null;

  constructor() {
    super(1, 1);
  }

  initialize(rotatingMass: RigidBody, vehicle: Vehicle): void {
    this.bodies[0] = rotatingMass;
    this.vehicle = vehicle;
  }

  override calculate(output: ConstraintOutput, _state: SystemState): void {
    output.C[0] = 0;

    output.J[0] = 0.0;
    output.J[1] = 0.0;
    output.J[2] = -1.0;
    output.J[3] = 0.0;
    output.J[4] = 0.0;
    output.J[5] = 1.0;

    output.J_dot[0] = 0;
    output.J_dot[1] = 0;
    output.J_dot[2] = 0;
    output.J_dot[3] = 0;
    output.J_dot[4] = 0;
    output.J_dot[5] = 0;

    output.kd[0] = this.kd;
    output.ks[0] = this.ks;
    output.v_bias[0] = 0;

    const vehicle = this.vehicle!;
    const v = vehicle.getSpeed();
    const v_squared = v * v;
    const c_d = vehicle.getDragCoefficient();
    const A = vehicle.getCrossSectionArea();
    const rollingResistance = vehicle.getRollingResistance();

    output.limits[0] = -vehicle.linearForceToVirtualTorque(
      rollingResistance + 0.5 * AIR_DENSITY * v_squared * c_d * A,
    );
    output.limits[1] = 0;
  }
}
