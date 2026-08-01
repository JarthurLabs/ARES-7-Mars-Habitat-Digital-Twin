export const SNAPSHOT_VERSION = 1 as const;

export type ControllerState =
  | "NOMINAL"
  | "STORM_WARNING"
  | "POWER_CRITICAL"
  | "LIFE_SUPPORT_RISK"
  | "CONTAINMENT"
  | "RECOVERY"
  | "RESTORATION"
  | "RESOLVED";

export type OperatorDecision = "NONE" | "PENDING" | "APPROVED" | "HELD";

export interface SnapshotIdentity {
  scenarioRunId: string;
  tick: number;
  snapshotVersion: string;
}

export interface ControllerSnapshot extends SnapshotIdentity {
  currentState: ControllerState;
  operatorDecision: OperatorDecision;
  recoveryStableTicks: number;
  resolvedStableTicks: number;
  dustOpacityPct: number;
  solarOutputPct: number;
  batteryChargePct: number;
  oxygenGeneratorOutputPct: number;
  oxygenReservePct: number;
}

export interface ControllerCommands {
  isolateLab: boolean;
  isolateGreenhouse: boolean;
  sealAirlock: boolean;
  shedNonCriticalLoad: boolean;
  prioritizeLifeSupport: boolean;
  energizeEmergencyBus: boolean;
}

export interface ControllerDecision {
  nextState: ControllerState;
  transitioned: boolean;
  alarmLevel: "NONE" | "WATCH" | "CRITICAL" | "RECOVERING";
  action: string;
  operatorDecision: OperatorDecision;
  recoveryStableTicks: number;
  resolvedStableTicks: number;
  commands: ControllerCommands;
}
