import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import iotDevice from "azure-iot-device";
import mqttTransport from "azure-iot-device-mqtt";
import { buildFrame, SCENARIO_TICKS } from "./scenario.mjs";

const { Client, Message } = iotDevice;
const { Mqtt } = mqttTransport;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const intervalArgument = process.argv.indexOf("--interval");
const intervalSeconds = intervalArgument >= 0
  ? Number(process.argv[intervalArgument + 1])
  : Number(process.env.ARES7_INTERVAL_SECONDS ?? 12);

if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
  throw new Error("Interval must be a non-negative number of seconds.");
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
  if (client) await client.open();
  for (let tick = 0; tick < SCENARIO_TICKS; tick += 1) {
    const frame = buildFrame(tick, scenarioRunId, new Date().toISOString());
    await sendFrame(frame);
    if (tick < SCENARIO_TICKS - 1 && intervalSeconds > 0) {
      await wait(intervalSeconds * 1000);
    }
  }
} finally {
  if (client) await client.close();
}
