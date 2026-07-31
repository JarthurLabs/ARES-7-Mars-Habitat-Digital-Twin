# Telemetry simulator

The simulator sends one aggregate JSON message per tick. A tick represents 30 simulated minutes and runs every 12 real seconds by default. The message carries environment, power, and life-support readings plus a scenario run identifier and monotonically increasing tick.

The aggregate message is intentional: the ingest Function can patch all subsystem twins, then update `ares7-clock` last as the commit marker for the coherent snapshot.

The raw frames never assume that an operator approved containment. Bus demand
and life-support allocation remain at their uncommanded values; those effects
belong to the controller after the human gate.

## Safe local run

```bash
cd simulator
npm install
npm test
npm run dry-run
```

The dry run prints newline-delimited JSON and makes no network connection.

## IoT Hub run

Create the `ares7-simulator` device identity, retrieve its **device-only** credential, and set it in the process environment. Never use or commit an IoT Hub owner connection string.

```bash
export IOTHUB_DEVICE_CONNECTION_STRING='device-only credential from a secure source'
npm start
```

Every IoT message is marked `application/json` with UTF-8 encoding so Event Grid does not present the body as an unexpected Base64 string.
