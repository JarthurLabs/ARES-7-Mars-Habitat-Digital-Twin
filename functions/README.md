# Cloud Functions

These Functions build and test locally. They have not been deployed or wired to
Event Grid in Azure yet.

The Function App has two Event Grid triggers:

1. `ingestTelemetry` accepts the aggregate IoT Hub event, patches environment, power, life-support, and module twins, then updates `ares7-clock` last.
2. `emergencyController` ignores every routed twin event except the clock. It reads the coherent snapshot, rejects duplicate or old ticks, evaluates one state transition, updates the affected twins, and optionally broadcasts the result through Web PubSub.

## Safety properties

- At-least-once delivery is expected. A tick at or below `lastProcessedTick` is ignored.
- Module changes are idempotent.
- The habitat update uses its ETag. A conflicting controller invocation fails instead of silently overwriting newer state.
- No more than one emergency-state transition is allowed per tick.
- The system stops at `LIFE_SUPPORT_RISK` with `operatorDecision=PENDING`.
- Containment begins only after the habitat twin is explicitly changed to `APPROVED`.
- Default Azure Credential is used. No Digital Twins or Web PubSub key is stored in code.

## Local checks

```bash
npm install
npm test
npm run build
```

The build removes its previous output and emits only `src/` into `dist/`; it
does not package compiled tests. The pure state-machine tests do not require
Azure credentials.
