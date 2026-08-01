import {
  evaluateController,
  formatSnapshotVersion,
  type ControllerCommands,
  type ControllerDecision,
  type ControllerSnapshot,
  type ControllerState,
  type OperatorDecision,
} from "@ares7/controller-core";
import type { SensorTelemetry, Telemetry } from "./types";

export interface LocalControllerState {
  scenarioRunId: string;
  lastTick: number;
  currentState: ControllerState;
  operatorDecision: OperatorDecision;
  recoveryStableTicks: number;
  resolvedStableTicks: number;
  decision: ControllerDecision;
}

const NO_COMMANDS: ControllerCommands = Object.freeze({
  isolateLab: false,
  isolateGreenhouse: false,
  sealAirlock: false,
  shedNonCriticalLoad: false,
  prioritizeLifeSupport: false,
  energizeEmergencyBus: false,
});

const idleDecision: ControllerDecision = {
  nextState: "NOMINAL",
  transitioned: false,
  alarmLevel: "NONE",
  action: "MONITOR",
  operatorDecision: "NONE",
  recoveryStableTicks: 0,
  resolvedStableTicks: 0,
  commands: NO_COMMANDS,
};

export function createLocalController(scenarioRunId: string): LocalControllerState {
  if (!scenarioRunId.trim()) throw new Error("scenarioRunId is required");
  return {
    scenarioRunId,
    lastTick: -1,
    currentState: "NOMINAL",
    operatorDecision: "NONE",
    recoveryStableTicks: 0,
    resolvedStableTicks: 0,
    decision: idleDecision,
  };
}

function controllerSnapshot(
  state: LocalControllerState,
  readings: SensorTelemetry,
  tick: number,
  operatorDecision: OperatorDecision,
): ControllerSnapshot {
  return {
    scenarioRunId: state.scenarioRunId,
    tick,
    snapshotVersion: formatSnapshotVersion(state.scenarioRunId, tick),
    currentState: state.currentState,
    operatorDecision,
    recoveryStableTicks: state.recoveryStableTicks,
    resolvedStableTicks: state.resolvedStableTicks,
    dustOpacityPct: readings.dustOpacityPercent,
    solarOutputPct: readings.solarOutputPercent,
    batteryChargePct: readings.batteryPercent,
    oxygenGeneratorOutputPct: readings.oxygenGeneratorOutputPercent,
    oxygenReservePct: readings.oxygenReservePercent,
  };
}

function reduce(
  state: LocalControllerState,
  readings: SensorTelemetry,
  tick: number,
  operatorDecision: OperatorDecision,
): LocalControllerState {
  const decision = evaluateController(controllerSnapshot(state, readings, tick, operatorDecision));
  return {
    ...state,
    lastTick: tick,
    currentState: decision.nextState,
    operatorDecision: decision.operatorDecision,
    recoveryStableTicks: decision.recoveryStableTicks,
    resolvedStableTicks: decision.resolvedStableTicks,
    decision,
  };
}

export function ingestLocalReading(
  state: LocalControllerState,
  readings: SensorTelemetry,
  tick = Math.floor(readings.missionSecond),
): LocalControllerState {
  if (tick <= state.lastTick) return state;
  return reduce(state, readings, tick, state.operatorDecision);
}

export function applyLocalOperatorDecision(
  state: LocalControllerState,
  readings: SensorTelemetry,
  operatorDecision: Extract<OperatorDecision, "APPROVED" | "HELD">,
): LocalControllerState {
  const tick = Math.max(0, state.lastTick);
  return reduce(state, readings, tick, operatorDecision);
}

export function telemetryWithControllerCommands(
  readings: SensorTelemetry,
  commands: ControllerCommands,
): Telemetry {
  return {
    ...readings,
    nonessentialLoadKw: commands.shedNonCriticalLoad ? 0 : readings.nonessentialLoadKw,
    airlockSealed: commands.sealAirlock,
    greenhouseIsolated: commands.isolateGreenhouse,
    loadSheddingActive: commands.shedNonCriticalLoad,
    emergencyBusActive: commands.energizeEmergencyBus,
  };
}
