import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import iotDevice from "azure-iot-device";
import mqttTransport from "azure-iot-device-mqtt";
import {
  buildFrame,
  delayAfterTickSeconds,
  scenarioTickRange,
  SCENARIO_TICKS,
} from "./scenario.mjs";

const { Client, Message } = iotDevice;
const { Mqtt } = mqttTransport;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const intervalArgument = process.argv.indexOf("--interval");
const intervalSeconds = intervalArgument >= 0
  ? Number(process.argv[intervalArgument + 1])
  : Number(process.env.ARES7_INTERVAL_SECONDS ?? 12);
const duplicateTickValue = process.env.ARES7_DUPLICATE_TICK?.trim();
const duplicateTick = !duplicateTickValue
  ? undefined
  : Number(duplicateTickValue);
const startTick = Number(process.env.ARES7_START_TICK ?? 0);
const endTick = Number(process.env.ARES7_END_TICK ?? SCENARIO_TICKS - 1);
const duplicateDelaySeconds = Number(
  process.env.ARES7_DUPLICATE_DELAY_SECONDS ?? intervalSeconds,
);
const approvalGateDelaySeconds = Number(
  process.env.ARES7_APPROVAL_GATE_DELAY_SECONDS ?? intervalSeconds,
);

if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
  throw new Error("Interval must be a non-negative number of seconds.");
}
if (
  duplicateTick !== undefined &&
  (!Number.isInteger(duplicateTick) || duplicateTick < 0 || duplicateTick >= SCENARIO_TICKS)
) {
  throw new Error(`ARES7_DUPLICATE_TICK must be an integer from 0 to ${SCENARIO_TICKS - 1}.`);
}
const ticks = scenarioTickRange(startTick, endTick);
if (duplicateTick !== undefined && !ticks.includes(duplicateTick)) {
  throw new Error("ARES7_DUPLICATE_TICK must be inside the selected scenario tick range.");
}
if (!Number.isFinite(duplicateDelaySeconds) || duplicateDelaySeconds < 0) {
  throw new Error("ARES7_DUPLICATE_DELAY_SECONDS must be a non-negative number of seconds.");
}
if (!Number.isFinite(approvalGateDelaySeconds) || approvalGateDelaySeconds < 0) {
  throw new Error("ARES7_APPROVAL_GATE_DELAY_SECONDS must be a non-negative number of seconds.");
}

const scenarioRunId = process.env.ARES7_SCENARIO_RUN_ID || randomUUID();
const connectionString = process.env.IOTHUB_DEVICE_CONNECTION_STRING;

if (!dryRun && !connectionString) {
  throw new Error(
    "IOTHUB_DEVICE_CONNECTION_STRING is required. Use an individual device credential or run with --dry-run.",
  );
}

const client = dryRun ? null : Client.fromConnectionString(connectionString, Mqtt);

async function sendFrame(frame) {
  const body = JSON.stringify(frame);
  if (dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  const message = new Message(body);
  message.contentType = "application/json";
  message.contentEncoding = "utf-8";
  message.properties.add("ares7-message-type", frame.messageType);
  message.properties.add("ares7-scenario-run-id", frame.scenarioRunId);
  message.properties.add("ares7-tick", String(frame.tick));
  await client.sendEvent(message);
  process.stdout.write(`sent tick=${frame.tick} simulatedMinute=${frame.simulatedMinute}\n`);
}

try {
  const frames = new Map();
  if (client) await client.open();
  for (const [index, tick] of ticks.entries()) {
    const frame = buildFrame(tick, scenarioRunId, new Date().toISOString());
    frames.set(tick, frame);
    await sendFrame(frame);
    const delaySeconds = delayAfterTickSeconds(tick, intervalSeconds, approvalGateDelaySeconds);
    if (index < ticks.length - 1 && delaySeconds > 0) {
      await wait(delaySeconds * 1000);
    }
  }
  if (duplicateTick !== undefined) {
    if (duplicateDelaySeconds > 0) await wait(duplicateDelaySeconds * 1000);
    await sendFrame(frames.get(duplicateTick));
    process.stdout.write(
      `resent exact duplicate tick=${duplicateTick} scenarioRunId=${scenarioRunId}\n`,
    );
  }
} finally {
  if (client) await client.close();
}
