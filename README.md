# ARES-7 — Mars Habitat Digital Twin

[![Verify](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/ci.yml/badge.svg)](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/ci.yml)
[![CodeQL](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/codeql.yml/badge.svg)](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/codeql.yml)
[![Dependency review](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/actions/workflows/dependency-review.yml)

[Public interactive replay](https://jarthurlabs.github.io/ARES-7-Mars-Habitat-Digital-Twin/) — published on GitHub Pages and verified reachable on August 9, 2026. It is intentionally labeled `LOCAL REPLAY`; it does not pretend to be a live Azure dashboard.

ARES-7 is an Azure portfolio lab that turns a deterministic Martian
dust storm into a traceable, human-approved containment sequence across a
modeled habitat.

## Watch the 90-second demo

[![Watch the ARES-7 portfolio demo](https://github.com/user-attachments/assets/692d1b8e-dc34-43e9-b7e4-af7696a7dfb2)](https://github.com/user-attachments/assets/e3ad2ea0-0116-411b-8e50-cb7ef0673ba2)

_Click the image to watch. The video uses the safe deterministic viewer replay
so anyone can see the incident, human approval gate, containment, and recovery
without Azure access. The Azure event path was verified separately in a live
run described below._

The interesting question is not whether a dashboard can turn red. It is
whether an event-driven controller can act on a coherent snapshot, reject
duplicate delivery, and stop before a consequential action. ARES-7 makes those
decisions visible.

## At a glance

- 9 DTDL v2 interfaces.
- 11 digital-twin definitions and 15 relationship definitions.
- 12 deterministic raw telemetry ticks.
- One 8-state controller shared by the local replay and Functions.
- Automated checks cover the viewer, shared controller, simulator, Functions,
  infrastructure guards, models, and browser behavior.
- One explicit human approval gate before containment.
- IoT Hub `F1` and Web PubSub `Free_F1` enforced in Bicep.

## Live Azure verification

On August 9, 2026, commit
[`bfd8445`](https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin/commit/bfd8445f720e55ac1b0304cb813c4f5e207f489c)
was deployed and verified through the real Azure event path. Run
`968227e6-2830-4212-835e-18eb29f5d1da` processed ticks 0 through 11 plus one
exact duplicate. It paused at tick 4 for human approval, reconciled that
decision, then finished with 12 distinct snapshots and the final state
`RESOLVED / APPROVED / MONITOR_POST_INCIDENT`.

After verification, the exact lab resource group was deleted. Independent
subscription-wide checks returned `false` for group existence and no remaining
ARES-7-tagged groups or resources. The public replay, video, code, and redacted
evidence remain available without keeping Azure services running.

## What happens during the drill

1. A deterministic simulator introduces rising dust opacity.
2. Solar generation falls and the battery begins discharging.
3. Oxygen production and reserve cross the life-support threshold.
4. Automation pauses at `LIFE_SUPPORT_RISK`.
5. The operator may approve containment or hold the plan.
6. Only after approval may the controller isolate noncritical modules, seal the
   airlock, shed load, and prioritize life support.
7. Stable recovery readings are required before restoration and resolution.

The raw simulators never assume that approval occurred. They report environment
and subsystem readings; one shared controller package owns commanded effects for
both the local replay and Azure Functions.

## Architecture

```mermaid
flowchart LR
  SIM[Deterministic simulator<br/>12 coherent ticks]
  IOT[IoT Hub F1]
  ING[Telemetry ingest Function]
  ADT[(Azure Digital Twins<br/>9 models · 11 base twins · per-tick snapshots)]
  CLOCK[Scenario clock<br/>commit marker]
  CTL[Emergency controller]
  OP[Operator approval]
  WPS[Web PubSub Free]
  UI[Three.js mission control]

  SIM -->|device-scoped MQTT credential| IOT
  IOT -->|Event Grid| ING
  ING -->|patch subsystem twins| ADT
  ING -->|update last| CLOCK
  CLOCK -->|evaluate coherent tick| CTL
  CTL -->|idempotent patches + ETag| ADT
  OP -->|APPROVED| CTL
  CTL -. optional broadcast .-> WPS
  WPS -. optional read-only adapter .-> UI
```

The simulator sends one aggregate message for each scenario tick. The ingest
Function validates and hashes it, creates an immutable snapshot twin, stamps
every projection with the same run/tick/version, then updates `ares7-clock`
last using its ETag. If a projection falls over halfway through, the clock does
not pretend everything is fine. A same-payload retry can finish the work.

The controller ignores unrelated twin noise. For clock events it reads the
exact immutable snapshot named by the commit marker and catches up any missing
ticks in order. For approval events it uses a separate decision and action ID,
so approval after the final telemetry tick runs immediately. Each actuator
write is ETag guarded and resumable; the habitat commits last, and Web PubSub
broadcasts only the state that actually stuck.

See [the architecture notes](docs/architecture.md) for the trust boundaries,
graph, and implementation status.

## Safety and reliability choices

- Aggregate telemetry defines a clear consistency boundary and stable hash.
- An immutable twin preserves each accepted run/tick payload.
- The clock twin is ETag committed only after every projection is stamped.
- At-least-once delivery is expected; duplicate and older ticks are ignored.
- A conflicting habitat write fails rather than silently overwriting newer
  state.
- Partial commands converge by action ID instead of replaying finished writes.
- A Web PubSub failure cannot roll back authoritative twin state.
- Service clients use `DefaultAzureCredential`; no owner key is stored in code.
- The simulator accepts only a device-scoped IoT credential at runtime.
- The containment plan cannot execute while the operator decision is pending.
- Cost-sensitive SKUs fail closed instead of falling back to paid tiers.

## Current implementation status

| Component | Status | Evidence |
|---|---|---|
| Interactive Three.js habitat | Published replay | Public GitHub Pages viewer, portfolio video, responsive captures, and browser tests |
| Local incident and approval UI | Working locally through the shared reducer | Viewer and local-adapter tests |
| Deterministic telemetry simulator | Working locally | 12-frame NDJSON and 3 tests |
| DTDL graph definition | Defined locally | 9 interfaces, 11 base twins, 15 relationships, and per-tick snapshots |
| Ingest and controller Functions | **Deployed and verified live** | Exact-commit deployment and completed Azure scenario run |
| Core Bicep | Built, validated, reviewed with What-If, and deployed | Deployment `ares7-core-20260731` succeeded |
| Azure resource group | **Deleted after verification** | `rg-ares7-lab-eus2` returned `false`; no ARES-7-tagged residue remained |
| Azure core services | **Historical live deployment; removed** | Digital Twins, IoT Hub F1, Web PubSub Free_F1, Functions, Event Grid, identities, monitoring, and storage |
| Azure event path | **Verified live August 9, 2026; resources removed** | 12 ordered snapshots, duplicate handling, approval gate, and resolved final state |
| Static public replay | **Published and verified** | GitHub Pages returned the ARES-7 viewer on August 9, 2026 |
| Web PubSub browser adapter | Optional read-only UI | UI defaults to `LOCAL REPLAY`; live mode uses a short-lived viewer URL with no group publish or join roles |
| Azure 3D Scenes Studio bundle | Optional offline bundle validated | Studio rendering is not claimed and is not a completion requirement |

The live run verified the complete cloud path: device telemetry, IoT Hub,
event routing, Functions, Digital Twins, the approval boundary, duplicate
handling, and final controller reconciliation. The public viewer remains a
safe replay so reviewers never need Azure credentials.

## Run it locally

Use Node.js 22 and install each package once:

```bash
npm ci
npm --prefix simulator ci
npm --prefix functions ci
npm run verify
```

Start the viewer:

```bash
npm run dev
```

Open the URL printed by Vite, run the dust-storm drill, and inspect the event
stream when the simulation pauses at the approval gate. The detailed sequence
is in the [demo runbook](docs/demo-runbook.md).

The static replay requires no install. Its data-source chip, run ID, tick,
snapshot version, and controller state stay visible so a reviewer can tell
exactly what the screen is showing. Select a habitat module to open the twin
inspector; arrow keys move through the module list and `Escape` closes it.

Generate a network-free telemetry run:

```bash
npm --prefix simulator run dry-run
```

## Evidence

| Nominal | Approval required | Containment active |
|---|---|---|
| [![Nominal state](evidence/screenshots/ares7-nominal.png)](evidence/screenshots/ares7-nominal.png) | [![Human approval gate](evidence/screenshots/ares7-human-approval-gate.png)](evidence/screenshots/ares7-human-approval-gate.png) | [![Containment active](evidence/screenshots/ares7-containment-active.png)](evidence/screenshots/ares7-containment-active.png) |

The current public-demo captures are [desktop with the twin inspector](evidence/screenshots/ares7-public-demo-desktop-20260805.png) and [mobile at 390×844](evidence/screenshots/ares7-public-demo-mobile-20260805.png). They were produced through the built application, not assembled in an image editor.

The [evidence register](evidence/README.md) separates local behavior, Azure
infrastructure, and live integration proof. An item is marked verified only
when its corresponding evidence exists.

## Cost controls and cleanup

The target is a short evidence run under $10, with a planned $25 Azure budget
alert as a secondary warning. Budget alerts are delayed notifications, not
hard spending caps. The template excludes VMs, Kubernetes, Cosmos DB, Azure
Data Explorer, private endpoints, and paid AI services.

The exact cost boundary and resource-group deletion record are documented in
[cost and cleanup](docs/cost-and-cleanup.md). The tagged resource group was
deleted after the final portfolio review, and subscription-wide tag checks
found no ARES-7 residue.

## What this lab does not claim

ARES-7 is a portfolio lab, not a production safety system. Its telemetry is
synthetic and deterministic; it is not connected to spacecraft hardware. The
public browser experience and portfolio video use a local replay. The Azure
event path was tested separately and does not turn the public demo into a live
operations console.

The lab template permits public service endpoints to keep the first deployment
understandable and inexpensive. It has not undergone penetration, load,
availability, or disaster-recovery testing. The procedural Three.js habitat is
separate from the generated Azure 3D Scenes Studio bundle. Offline schema and
mapping validation does not prove that Studio has loaded the private blobs or
rendered live twin behavior.

## Repository map

```text
src/         Three.js habitat, mission-control UI, and local controller adapter
packages/    Source-only controller contracts, thresholds, transitions, and commands
simulator/   Deterministic aggregate telemetry and device-side sender
models/      DTDL v2 interfaces, immutable snapshot model, and base twin graph
functions/   Ingest Function, controller, tests, and graph scripts
infra/       Cost-gated core Azure Bicep
docs/        Architecture, runbook, incident journal, and cost controls
evidence/    Genuine local captures, verification logs, and evidence register
```

The [incident journal](docs/incident-journal.md) records real mistakes and
their fixes, including external-font capture failures, the CommonJS/ESM SDK
boundary, raw telemetry that originally assumed approval, and two issues found
by real Azure Bicep validation.

## License

[MIT](LICENSE) © 2026 Jamal Arthur.
