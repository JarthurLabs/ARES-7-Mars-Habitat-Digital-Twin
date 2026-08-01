import type {
  ControllerDecision,
  ControllerSnapshot,
  ControllerState,
} from "./contracts.js";

export const CONTROLLER_THRESHOLDS = Object.freeze({
  stormDustOpacityPct: 35,
  stormSolarOutputPct: 65,
  criticalSolarOutputPct: 15,
  criticalBatteryChargePct: 60,
  lifeSupportGeneratorOutputPct: 50,
  lifeSupportReservePct: 86,
  recoverySolarOutputPct: 35,
  recoveryGeneratorOutputPct: 85,
  restorationBatteryChargePct: 60,
  restorationOxygenReservePct: 90,
  resolvedBatteryChargePct: 70,
  resolvedOxygenReservePct: 95,
  resolvedSolarOutputPct: 75,
  stableReadingsRequired: 2,
});

export const CONTROLLER_ACTIONS: Readonly<Record<ControllerState, string>> = Object.freeze({
  NOMINAL: "MONITOR",
  STORM_WARNING: "TRACK_STORM_AND_PRESERVE_RESERVE",
  POWER_CRITICAL: "PREPARE_NONCRITICAL_LOAD_SHED",
  LIFE_SUPPORT_RISK: "PROPOSE_SHED_NONCRITICAL_AND_PRIORITIZE_OXYGEN",
  CONTAINMENT: "SHED_NONCRITICAL_AND_PRIORITIZE_OXYGEN",
  RECOVERY: "HOLD_CONTAINMENT_AND_VERIFY_RECOVERY",
  RESTORATION: "RESTORE_LAB_THEN_GREENHOUSE",
  RESOLVED: "MONITOR_POST_INCIDENT",
});

function alarmForState(state: ControllerState): ControllerDecision["alarmLevel"] {
  if (state === "NOMINAL" || state === "RESOLVED") return "NONE";
  if (state === "STORM_WARNING") return "WATCH";
  if (state === "RECOVERY" || state === "RESTORATION") return "RECOVERING";
  return "CRITICAL";
}

export function evaluateController(snapshot: ControllerSnapshot): ControllerDecision {
  const thresholds = CONTROLLER_THRESHOLDS;
  const stormWarning =
    snapshot.dustOpacityPct >= thresholds.stormDustOpacityPct ||
    snapshot.solarOutputPct < thresholds.stormSolarOutputPct;
  const powerCritical =
    snapshot.solarOutputPct <= thresholds.criticalSolarOutputPct &&
    snapshot.batteryChargePct <= thresholds.criticalBatteryChargePct;
  const lifeSupportRisk =
    snapshot.oxygenGeneratorOutputPct <= thresholds.lifeSupportGeneratorOutputPct ||
    snapshot.oxygenReservePct <= thresholds.lifeSupportReservePct;
  const recoveryReading =
    snapshot.solarOutputPct >= thresholds.recoverySolarOutputPct &&
    snapshot.oxygenGeneratorOutputPct >= thresholds.recoveryGeneratorOutputPct;
  const restorationReady =
    snapshot.batteryChargePct >= thresholds.restorationBatteryChargePct &&
    snapshot.oxygenReservePct >= thresholds.restorationOxygenReservePct;
  const resolvedReading =
    snapshot.batteryChargePct >= thresholds.resolvedBatteryChargePct &&
    snapshot.oxygenReservePct >= thresholds.resolvedOxygenReservePct &&
    snapshot.solarOutputPct >= thresholds.resolvedSolarOutputPct;

  let nextState = snapshot.currentState;
  let operatorDecision = snapshot.operatorDecision;
  const recoveryStableTicks = recoveryReading ? snapshot.recoveryStableTicks + 1 : 0;
  const resolvedStableTicks = resolvedReading ? snapshot.resolvedStableTicks + 1 : 0;

  switch (snapshot.currentState) {
    case "NOMINAL":
      if (stormWarning) nextState = "STORM_WARNING";
      break;
    case "STORM_WARNING":
      if (powerCritical) nextState = "POWER_CRITICAL";
      break;
    case "POWER_CRITICAL":
      if (lifeSupportRisk) {
        nextState = "LIFE_SUPPORT_RISK";
        operatorDecision = "PENDING";
      }
      break;
    case "LIFE_SUPPORT_RISK":
      if (snapshot.operatorDecision === "APPROVED") nextState = "CONTAINMENT";
      break;
    case "CONTAINMENT":
      if (recoveryStableTicks >= thresholds.stableReadingsRequired) nextState = "RECOVERY";
      break;
    case "RECOVERY":
      if (restorationReady) nextState = "RESTORATION";
      break;
    case "RESTORATION":
      if (resolvedStableTicks >= thresholds.stableReadingsRequired) nextState = "RESOLVED";
      break;
    case "RESOLVED":
      break;
  }

  const containmentActive = nextState === "CONTAINMENT" || nextState === "RECOVERY";
  const restorationActive = nextState === "RESTORATION";

  return {
    nextState,
    transitioned: nextState !== snapshot.currentState,
    alarmLevel: alarmForState(nextState),
    action: CONTROLLER_ACTIONS[nextState],
    operatorDecision,
    recoveryStableTicks,
    resolvedStableTicks,
    commands: {
      isolateLab: containmentActive,
      isolateGreenhouse: containmentActive || restorationActive,
      sealAirlock: containmentActive,
      shedNonCriticalLoad: containmentActive,
      prioritizeLifeSupport: containmentActive || restorationActive,
      energizeEmergencyBus: containmentActive || restorationActive,
    },
  };
}
