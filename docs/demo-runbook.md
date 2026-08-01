# Demo runbook

This runbook gives a reviewer a repeatable local demonstration without Azure
credentials or network writes. The final section records the cloud preflight
boundary; it does not deploy services.

## Prerequisites

- Node.js 22.
- npm.
- A browser with WebGL enabled.
- Optional for Azure preflight only: Azure CLI, Bicep support, and read access
  to the intended subscription.

## One-time setup

From the repository root:

```bash
npm ci
npm --prefix simulator ci
npm --prefix functions ci
```

Do not create `.env` files for the local viewer or dry run. Neither needs an
Azure credential.

## Verify the repository

```bash
npm run verify
```

The command runs:

- 14 viewer, local-adapter, and shared-controller tests.
- 3 raw simulator tests.
- 4 Functions adapter tests.
- The production viewer build.
- The clean Azure Functions TypeScript build.

Expected result: 21 tests pass and both builds complete. The older captured run
predates the shared package and is preserved in
[`evidence/logs/2026-07-31-local-verification.txt`](../evidence/logs/2026-07-31-local-verification.txt).

## Run the visual incident drill

```bash
npm run dev
```

1. Open the URL printed by Vite.
2. Confirm the adapter reads `LOCAL TWIN SIM` and the habitat is nominal.
3. Select two scene modules and confirm the camera focus changes.
4. Select **Run dust storm drill**.
5. Watch solar output, battery reserve, oxygen mix, pressure, system health,
   scene lighting, particles, and the event stream change together.
6. At approximately `T+40`, confirm the simulation pauses and displays **Human
   decision required**.
7. Choose **Hold** once. Confirm that no containment controls execute.
8. Reset, rerun the drill, and choose **Approve plan**.
9. Confirm that the airlock becomes sealed, the greenhouse becomes isolated,
   the emergency bus becomes active, and the event stream records the operator
   approval before the commanded actions.
10. Reset to nominal and confirm the scenario can be repeated.

The screenshots in `evidence/screenshots/` are genuine captures from this
application. They predate a display-only model ID and scene-module label fix;
fresh post-fix captures are required before the repository is published.

## Generate raw telemetry evidence

```bash
ARES7_SCENARIO_RUN_ID=00000000-0000-4000-8000-000000000007 \
  npm --prefix simulator run dry-run
```

Dry-run mode prints 12 newline-delimited JSON frames and never constructs an
IoT Hub client. The raw frames keep `busDemandKw=34` and
`allocatedPowerKw=14`; they do not pretend that the operator approved a
controller action.

The checked-in sample is
[`evidence/telemetry/2026-07-31-dust-storm.ndjson`](../evidence/telemetry/2026-07-31-dust-storm.ndjson).

## Optional code walkthrough

Use this order for a five-minute review:

1. `simulator/src/scenario.mjs` — deterministic inputs.
2. `functions/src/ingestTelemetry.ts` — validation and clock-last commit.
3. `functions/src/stateMachine.ts` — transition and approval rules.
4. `functions/src/emergencyController.ts` — duplicate guard, ETag, and commands.
5. `models/twin-graph.json` — the defined, not-yet-uploaded Azure graph.
6. `infra/main.bicep` — service, security, tag, and SKU constraints.

## Azure core boundary

The real resource group `rg-ares7-lab-eus2` and four core services were created
by deployment `ares7-core-20260731`. Functions, routes, identities, models,
twins, and the device are not yet deployed.

Read-only inspection:

```bash
az group show --name rg-ares7-lab-eus2 --output table
az resource list --resource-group rg-ares7-lab-eus2 --output table
```

For an incremental change, validate and preview the template before deploying:

```bash
az deployment group validate \
  --resource-group rg-ares7-lab-eus2 \
  --template-file infra/main.bicep \
  --parameters '@infra/main.parameters.example.json'

az deployment group what-if \
  --resource-group rg-ares7-lab-eus2 \
  --template-file infra/main.bicep \
  --parameters '@infra/main.parameters.example.json'
```

Do not redeploy until What-If shows only the intended incremental change and
the required free SKUs. What-If is proposal evidence; the saved deployment
state and post-deployment inventory prove the existing core.

## Evidence capture checklist

- Record the exact command and UTC time.
- Capture the run ID and tick range when relevant.
- Keep raw logs as text; do not rely only on a screenshot.
- Crop or redact email, tenant, subscription, and other unnecessary IDs.
- Never show keys, connection strings, tokens, or SAS values.
- Label local simulation, template preview, and live Azure evidence separately.
- Update the evidence register before describing a component as deployed.
