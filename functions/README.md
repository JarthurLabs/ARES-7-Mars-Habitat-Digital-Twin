# Cloud Functions

These Functions build and test locally. They have not been deployed or wired to
Event Grid in Azure yet.

The Function App has two Event Grid triggers:

1. `ingestTelemetry` validates plain or Base64 aggregate events, creates an
   immutable run/tick snapshot, stamps each projection, and ETag-commits
   `ares7-clock` last.
2. `emergencyController` accepts committed clock events and unseen approval
   decisions. It loads the exact immutable snapshot, catches up missed ticks in
   order, reconciles one action at a time, and broadcasts only after the twins
   hold the authoritative result.

## Safety properties

- At-least-once delivery is expected. Missing committed ticks are processed in
  order; completed ticks are harmless duplicates.
- Accepted ticks are contiguous and tied to a UUID run, v2 snapshot identity,
  UTC sample time, and stable SHA-256 payload hash.
- Duplicate payloads are harmless; conflicting duplicates, gaps, stale runs,
  partial writes, and clock ETag races fail visibly.
- Every actuator and the habitat record a deterministic `lastActionId`. A retry
  skips finished writes and resumes at the first incomplete command.
- Every actuator and habitat write uses its ETag. A competing writer wins
  visibly instead of being paved over.
- No more than one emergency-state transition is allowed per tick.
- The system stops at `LIFE_SUPPORT_RISK` with `operatorDecision=PENDING`.
- Approval has its own decision ID and action ID, so approval at the final
  telemetry tick runs immediately instead of waiting for a clock event that may
  never come.
- Web PubSub runs after authoritative state is committed. A broadcast failure
  leaves the command intact and can retry without replaying the actuators.
- Default Azure Credential is used. No Digital Twins or Web PubSub key is stored in code.

## Local checks

```bash
npm install
npm run test:coverage
npm run build
```

The build removes its previous output and emits only `src/` into `dist/`; it
does not package compiled tests. The in-memory twin port has real ETag behavior
and deliberate failure injection, so the handler tests cover races, partial
writes, stale approvals, retry convergence, and broadcast failure without
Azure credentials. The Functions remain undeployed.
