/**
 * Valvetrains, ported from `valvetrain.h`, `standard_valvetrain.cpp` and
 * `vtec_valvetrain.cpp`.
 */
import type { Camshaft } from './camshaft';
import type { Engine } from './engine';

export interface Valvetrain {
  intakeValveLift(cylinder: number): number;
  exhaustValveLift(cylinder: number): number;
  getActiveIntakeCamshaft(): Camshaft;
  getActiveExhaustCamshaft(): Camshaft;
}

export class StandardValvetrain implements Valvetrain {
  constructor(
    private intakeCamshaft: Camshaft,
    private exhaustCamshaft: Camshaft,
  ) {}

  intakeValveLift(cylinder: number): number {
    return this.intakeCamshaft.valveLift(cylinder);
  }

  exhaustValveLift(cylinder: number): number {
    return this.exhaustCamshaft.valveLift(cylinder);
  }

  getActiveIntakeCamshaft(): Camshaft {
    return this.intakeCamshaft;
  }

  getActiveExhaustCamshaft(): Camshaft {
    return this.exhaustCamshaft;
  }
}

export interface VtecValvetrainParameters {
  minRpm: number;
  minSpeed: number;
  manifoldVacuum: number;
  minThrottlePosition: number;
  intakeCamshaft: Camshaft;
  exhaustCamshaft: Camshaft;
  vtecIntakeCamshaft: Camshaft;
  vtecExhaustCamshaft: Camshaft;
}

export class VtecValvetrain implements Valvetrain {
  private engine: Engine | null = null;

  constructor(private params: VtecValvetrainParameters) {}

  /** The engine reference is only available once the engine has been built. */
  setEngine(engine: Engine): void {
    this.engine = engine;
  }

  private isVtecEnabled(): boolean {
    const engine = this.engine;
    if (engine === null) return false;

    return (
      engine.getManifoldPressure() > this.params.manifoldVacuum &&
      engine.getSpeed() > this.params.minRpm &&
      1 - engine.getThrottle() > this.params.minThrottlePosition
    );
  }

  intakeValveLift(cylinder: number): number {
    return this.getActiveIntakeCamshaft().valveLift(cylinder);
  }

  exhaustValveLift(cylinder: number): number {
    return this.getActiveExhaustCamshaft().valveLift(cylinder);
  }

  getActiveIntakeCamshaft(): Camshaft {
    return this.isVtecEnabled() ? this.params.vtecIntakeCamshaft : this.params.intakeCamshaft;
  }

  getActiveExhaustCamshaft(): Camshaft {
    return this.isVtecEnabled() ? this.params.vtecExhaustCamshaft : this.params.exhaustCamshaft;
  }
}
