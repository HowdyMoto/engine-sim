/** Ported from `include/cylinder_head.h` / `src/cylinder_head.cpp`. */
import type { Func } from '../core/function';
import type { CylinderBank } from './cylinderBank';
import type { Valvetrain } from './valvetrain';
import type { Camshaft } from './camshaft';
import type { ExhaustSystem } from './exhaustSystem';
import type { Intake } from './intake';

export interface CylinderHeadParameters {
  bank: CylinderBank;
  exhaustPortFlow: Func;
  intakePortFlow: Func;
  valvetrain: Valvetrain;
  combustionChamberVolume: number;
  intakeRunnerVolume: number;
  intakeRunnerCrossSectionArea: number;
  exhaustRunnerVolume: number;
  exhaustRunnerCrossSectionArea: number;
  flipDisplay?: boolean;
}

interface CylinderPorts {
  exhaustSystem: ExhaustSystem | null;
  intake: Intake | null;
  soundAttenuation: number;
  headerPrimaryLength: number;
}

export class CylinderHead {
  private cylinders: CylinderPorts[] = [];

  private bank: CylinderBank | null = null;
  private valvetrain: Valvetrain | null = null;

  private exhaustPortFlow: Func | null = null;
  private intakePortFlow: Func | null = null;

  private intakeRunnerVolume = 0;
  private intakeRunnerCrossSectionArea = 0;
  private exhaustRunnerVolume = 0;
  private exhaustRunnerCrossSectionArea = 0;

  private combustionChamberVolume = 0;
  private flipDisplay = false;

  initialize(params: CylinderHeadParameters): void {
    this.cylinders = [];
    for (let i = 0; i < params.bank.getCylinderCount(); ++i) {
      this.cylinders.push({
        exhaustSystem: null,
        intake: null,
        soundAttenuation: 1.0,
        headerPrimaryLength: 0.0,
      });
    }

    this.bank = params.bank;
    this.valvetrain = params.valvetrain;
    this.exhaustPortFlow = params.exhaustPortFlow;
    this.intakePortFlow = params.intakePortFlow;
    this.combustionChamberVolume = params.combustionChamberVolume;
    this.flipDisplay = params.flipDisplay ?? false;

    this.intakeRunnerVolume = params.intakeRunnerVolume;
    this.intakeRunnerCrossSectionArea = params.intakeRunnerCrossSectionArea;
    this.exhaustRunnerVolume = params.exhaustRunnerVolume;
    this.exhaustRunnerCrossSectionArea = params.exhaustRunnerCrossSectionArea;
  }

  intakeFlowRate(cylinder: number): number {
    return this.intakePortFlow!.sampleTriangle(this.intakeValveLift(cylinder));
  }

  exhaustFlowRate(cylinder: number): number {
    return this.exhaustPortFlow!.sampleTriangle(this.exhaustValveLift(cylinder));
  }

  intakeValveLift(cylinder: number): number {
    return this.valvetrain!.intakeValveLift(cylinder);
  }

  exhaustValveLift(cylinder: number): number {
    return this.valvetrain!.exhaustValveLift(cylinder);
  }

  getExhaustSystem(cylinderIndex: number): ExhaustSystem {
    return this.cylinders[cylinderIndex].exhaustSystem!;
  }

  setExhaustSystem(i: number, system: ExhaustSystem): void {
    this.cylinders[i].exhaustSystem = system;
  }

  setAllExhaustSystems(system: ExhaustSystem): void {
    for (const cylinder of this.cylinders) cylinder.exhaustSystem = system;
  }

  getSoundAttenuation(cylinderIndex: number): number {
    return this.cylinders[cylinderIndex].soundAttenuation;
  }

  setSoundAttenuation(i: number, soundAttenuation: number): void {
    this.cylinders[i].soundAttenuation = soundAttenuation;
  }

  getIntake(cylinderIndex: number): Intake {
    return this.cylinders[cylinderIndex].intake!;
  }

  setIntake(i: number, intake: Intake): void {
    this.cylinders[i].intake = intake;
  }

  setAllIntakes(intake: Intake): void {
    for (const cylinder of this.cylinders) cylinder.intake = intake;
  }

  getHeaderPrimaryLength(cylinderIndex: number): number {
    return this.cylinders[cylinderIndex].headerPrimaryLength;
  }

  setHeaderPrimaryLength(i: number, length: number): void {
    this.cylinders[i].headerPrimaryLength = length;
  }

  setAllHeaderPrimaryLengths(length: number): void {
    for (const cylinder of this.cylinders) cylinder.headerPrimaryLength = length;
  }

  getFlipDisplay(): boolean {
    return this.flipDisplay;
  }

  getCombustionChamberVolume(): number {
    return this.combustionChamberVolume;
  }

  getCylinderBank(): CylinderBank {
    return this.bank!;
  }

  getIntakeRunnerVolume(): number {
    return this.intakeRunnerVolume;
  }

  getIntakeRunnerCrossSectionArea(): number {
    return this.intakeRunnerCrossSectionArea;
  }

  getExhaustRunnerVolume(): number {
    return this.exhaustRunnerVolume;
  }

  getExhaustRunnerCrossSectionArea(): number {
    return this.exhaustRunnerCrossSectionArea;
  }

  getExhaustCamshaft(): Camshaft {
    return this.valvetrain!.getActiveExhaustCamshaft();
  }

  getIntakeCamshaft(): Camshaft {
    return this.valvetrain!.getActiveIntakeCamshaft();
  }

  getValvetrain(): Valvetrain {
    return this.valvetrain!;
  }
}
