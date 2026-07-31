import type { ControllerDecision, ControllerSnapshot, ControllerState } from "./contracts.js";

const actionForState: Record<ControllerState, string> = {
  NOMINAL: "MONITOR",
  STORM_WARNING: "TRACK_STORM_AND_PRESERVE_RESERVE",
  POWER_CRITICAL: "PREPARE_NONCRITICAL_LOAD_SHED",
  LIFE_SUPPORT_RISK: "PROPOSE_SHED_NONCRITICAL_AND_PRIORITIZE_OXYGEN",
  CONTAINMENT: "SHED_NONCRITICAL_AND_PRIORITIZE_OXYGEN",
  RECOVERY: "HOLD_CONTAINMENT_AND_VERIFY_RECOVERY",
  RESTORATION: "RESTORE_LAB_THEN_GREENHOUSE",
  RESOLVED: "MONITOR_POST_INCIDENT",
};

function alarmForState(state: ControllerState): ControllerDecision["alarmLevel"] {
  if (state === "NOMINAL" || state === "RESOLVED") return "NONE";
  if (state === "STORM_WARNING") return "WATCH";
  if (state === "RECOVERY" || state === "RESTORATION") return "RECOVERING";
  return "CRITICAL";
}

export function evaluateController(snapshot: ControllerSnapshot): ControllerDecision {
  const stormWarning = snapshot.dustOpacityPct >= 35 || snapshot.solarOutputPct < 65;
  const powerCritical = snapshot.solarOutputPct <= 15 && snapshot.batteryChargePct <= 60;
  const lifeSupportRisk =
    snapshot.oxygenGeneratorOutputPct <= 50 || snapshot.oxygenReservePct <= 86;
  const recoveryReading =
    snapshot.solarOutputPct >= 35 && snapshot.oxygenGeneratorOutputPct >= 85;
  const restorationReady =
    snapshot.batteryChargePct >= 60 && snapshot.oxygenReservePct >= 90;
  const resolvedReading =
    snapshot.batteryChargePct >= 70 &&
    snapshot.oxygenReservePct >= 95 &&
    snapshot.solarOutputPct >= 75;

  let nextState = snapshot.currentState;
  let operatorDecision = snapshot.operatorDecision;
  let recoveryStableTicks = recoveryReading ? snapshot.recoveryStableTicks + 1 : 0;
  let resolvedStableTicks = resolvedReading ? snapshot.resolvedStableTicks + 1 : 0;

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
      if (recoveryStableTicks >= 2) nextState = "RECOVERY";
      break;
    case "RECOVERY":
      if (restorationReady) nextState = "RESTORATION";
      break;
    case "RESTORATION":
      if (resolvedStableTicks >= 2) nextState = "RESOLVED";
      break;
    case "RESOLVED":
      break;
  }

  const containmentActive = ["CONTAINMENT", "RECOVERY"].includes(nextState);
  const restorationActive = nextState === "RESTORATION";

  return {
    nextState,
    transitioned: nextState !== snapshot.currentState,
    alarmLevel: alarmForState(nextState),
    action: actionForState[nextState],
    operatorDecision,
    recoveryStableTicks,
    resolvedStableTicks,
    isolateLab: containmentActive,
    isolateGreenhouse: containmentActive || restorationActive,
    sealAirlock: containmentActive,
    shedNonCriticalLoad: containmentActive,
    prioritizeLifeSupport: containmentActive || restorationActive,
  };
}
