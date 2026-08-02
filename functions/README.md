# Cloud Functions

These Functions build and test locally. They have not been deployed or wired to
Event Grid in Azure yet.

The Function App has two Event Grid triggers:

1. `ingestTelemetry` validates plain or Base64 aggregate events, creates an
   immutable run/tick snapshot, stamps each projection, and ETag-commits
   `ares7-clock` last.
2. `emergencyController` ignores every routed twin event except the clock. It
   currently reads the mutable projections, rejects duplicate or old ticks,
   evaluates one state transition, updates the affected twins, and optionally
   broadcasts the result through Web PubSub.

## Safety properties

- At-least-once delivery is expected. A tick at or below `lastProcessedTick` is ignored.
- Accepted ticks are contiguous and tied to a UUID run, v2 snapshot identity,
  UTC sample time, and stable SHA-256 payload hash.
- Duplicate payloads are harmless; conflicting duplicates, gaps, stale runs,
  partial writes, and clock ETag races fail visibly.
- Module changes are idempotent.
- The habitat update uses its ETag. A conflicting controller invocation fails instead of silently overwriting newer state.
- No more than one emergency-state transition is allowed per tick.
- The system stops at `LIFE_SUPPORT_RISK` with `operatorDecision=PENDING`.
- Containment begins only after the habitat twin is explicitly changed to `APPROVED`.
- Default Azure Credential is used. No Digital Twins or Web PubSub key is stored in code.

## Local checks

```bash
npm install
npm run test:coverage
npm run build
```

The build removes its previous output and emits only `src/` into `dist/`; it
does not package compiled tests. The in-memory twin port has real ETag behavior
and deliberate failure injection, so the ingest tests do not need Azure
credentials. The Functions remain undeployed. The controller’s switch from
mutable projections to the immutable snapshot is intentionally left for the
next milestone.
