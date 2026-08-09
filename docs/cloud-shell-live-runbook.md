# Guarded Cloud Shell live run

This runbook is the prepared deployment sequence. Running it changes the one
ARES-7 Azure resource group and can incur metered charges. The scripts stop on
the wrong subscription, wrong resource group, a missing phase confirmation, or
a declared spending envelope above 10 US dollars. The spending variable is a
workflow guard, not an Azure hard cap; check Cost Analysis and any budget alert
before starting.

The repository does not contain an Azure credential, device key, connection
string, shared access signature, or generated 3D Scenes Studio configuration.

## 1. Prepare Cloud Shell

Use Bash in Azure Cloud Shell. Clone or update the repository, enter its root,
and install locked dependencies:

```bash
npm ci
npm --prefix simulator ci
npm --prefix functions ci
npm run verify
```

Cloud Shell must have Node.js 22 or newer, `zip`, `unzip`, and Azure CLI 2.70 or
newer. The `azure-iot` extension installs automatically on the first `az iot`
or `az dt` command.

Set the exact scope. Paste the subscription UUID you reviewed; do not use a
subscription name or the word `current`.

```bash
export ARES7_RESOURCE_GROUP=rg-ares7-lab-eus2
export ARES7_SUBSCRIPTION_ID='<paste-exact-subscription-uuid>'

az account show --subscription "$ARES7_SUBSCRIPTION_ID" --output table
az resource list \
  --subscription "$ARES7_SUBSCRIPTION_ID" \
  --resource-group "$ARES7_RESOURCE_GROUP" \
  --output table
```

Run the read-only build, validation, and integration What-If:

```bash
npm run azure:preflight
```

Stop if What-If includes a paid IoT Hub or Web PubSub tier, an always-ready
Function instance, a resource outside the exact group, or anything not explained
by `infra/integration.bicep`.

## 2. Enable the guarded live milestone

These values authorize only the prepared live-scenario writes. They contain no
credential.

```bash
export ARES7_MILESTONE=live-scenario
export ARES7_CONFIRM_WRITE=deploy-rg-ares7-lab-eus2
export ARES7_MAX_SPEND_USD=10
```

Build the tested Function package locally before creating integration resources:

```bash
npm run azure:package:functions
```

## 3. Deploy integration, code, graph, device, and events

Review each exact confirmation immediately before its command.

```bash
export ARES7_CONFIRM_INTEGRATION=integration-reviewed-rg-ares7-lab-eus2
npm run azure:deploy:integration
unset ARES7_CONFIRM_INTEGRATION

export ARES7_CONFIRM_FUNCTION_DEPLOY=functions-rg-ares7-lab-eus2
npm run azure:deploy:functions
unset ARES7_CONFIRM_FUNCTION_DEPLOY

export ARES7_CONFIRM_GRAPH_BOOTSTRAP=graph-rg-ares7-lab-eus2
npm run azure:bootstrap:graph
unset ARES7_CONFIRM_GRAPH_BOOTSTRAP

export ARES7_CONFIRM_DEVICE=ares7-simulator
npm run azure:provision:device
unset ARES7_CONFIRM_DEVICE

export ARES7_CONFIRM_EVENT_WIRING=wire-rg-ares7-lab-eus2
npm run azure:wire:events
unset ARES7_CONFIRM_EVENT_WIRING
```

The event command first verifies that `ingestTelemetry` and
`emergencyController` exist. It then deploys these narrow paths:

- Only `devices/ares7-simulator` telemetry reaches `ingestTelemetry`.
- Only `ares7-clock` and `ares7-habitat` twin updates reach
  `emergencyController`.
- Both subscriptions deliver one event at a time, retry up to 10 attempts within
  60 minutes, and dead-letter through the Event Grid managed identity to the
  private `event-dead-letter` container.

The Azure Digital Twins endpoint is an ARM resource in Bicep. Its event route is
a data-plane object, so the guarded script creates it after the template and
refuses to replace a route with drift.

## 4. Upload the optional private 3D Scenes bundle

Generate and validate the original asset and offline configuration first. The
checked-in configuration targets the storage account recorded by the existing
core-deployment evidence. If the current deployment output names a different
`stares7*` account, regenerate it with that exact name.

```bash
npm run asset:export
npm run asset:test
npm run asset:validate
npm run asset:scene:export -- stares7j6vhj3eh4zuie
npm run asset:scene:test
npm run asset:scene:validate
```

The generated `3DScenesConfiguration.json` uses Microsoft's published v1.0.0
schema (JSON Schema draft 2020-12). Local validation also proves that its ten
elements reference the ten stable GLB nodes and base-graph twin IDs, and that
its four behaviors reference real DTDL properties. This is offline evidence;
it does not prove Studio can render the configuration.

Upload both files with Microsoft Entra authentication. The command keeps all
of the normal exact-subscription, exact-resource-group, live-milestone, and
maximum-$10 guards. It additionally requires the storage account to disable
anonymous blob and Shared Key access, default to OAuth, and require TLS 1.2.
It uploads only missing blobs and refuses to overwrite any existing blob that
lacks the expected SHA-256 metadata, so it cannot silently replace a
Studio-created configuration.

```bash
export ARES7_CONFIRM_SCENE_UPLOAD=upload-ares7-3d-scenes-bundle
npm run azure:upload:scene
unset ARES7_CONFIRM_SCENE_UPLOAD
```

Microsoft recommends using the Studio builder instead of manually editing the
configuration blob. Treat the guarded direct upload as a provisional evidence
candidate only. In the real 3D Scenes Studio UI, connect the exact ADT instance
and private `ares7-3d-scenes` container, then capture genuine proof that:

- `ARES-7 Mars Habitat` opens without configuration or asset errors;
- all ten elements select the intended GLB mesh and resolve their primary twin;
- the Operations layer exposes all four behaviors;
- habitat, subsystem, isolation, and airlock visuals change from live twin data;
- the habitat popover shows state, alarm, operator decision, and controller
  action; and
- the pending approval and post-approval containment states are visible during
  the same identified live run.

Preserve the actual `3DScenesConfiguration.json` downloaded after any Studio
save, its SHA-256, the no-anonymous-access account setting, and the uncropped
Studio capture. Do not present the generated JSON alone as Studio UI proof.

## 5. Run telemetry and preserve the human gate

Open a second Cloud Shell tab with the same repository and scope variables. In
the first tab, start the deterministic 12-tick device run. The script retrieves
the device-only connection string into child-process memory, does not export or
print it, and discards it when the process exits.

```bash
export ARES7_CONFIRM_SCENARIO=run-ares7-simulator
npm run azure:run:scenario
unset ARES7_CONFIRM_SCENARIO
```

The guarded command sends 12 distinct frames and then resends tick 11 with the
same timestamp and payload hash. The live verification must therefore show 12
immutable snapshots while the ingestion logs or delivery metrics show the 13th
successful delivery as an idempotent duplicate.

Wait until the habitat is `LIFE_SUPPORT_RISK` with an operator decision of
`PENDING`. In the second tab, explicitly approve the proposed containment:

```bash
export ARES7_CONFIRM_APPROVAL=approve-containment
npm run azure:approve:containment
unset ARES7_CONFIRM_APPROVAL
```

The approval command checks the state and refuses an early, stale, or duplicate
approval. Keep the run ID printed by the scenario command with the live evidence.

## 6. Verify without changing claims prematurely

```bash
npm run azure:verify:live
```

Confirm the deployed Functions, exact event route, graph counts, clock tick,
habitat state, Event Grid delivery metrics, and private dead-letter container.
Redact subscription, tenant, email, tokens, keys, and connection strings from
saved logs. Update public evidence claims only from captured output from this
actual run.

For a temporary read-only browser proof, add `source=azure` and a URL-encoded
`negotiate` value to the GitHub Pages URL. The viewer accepts an override only
when it is HTTPS, has no credentials or custom port, uses an exact
`azurewebsites.net` hostname, and ends at `/api/viewer/negotiate`. With no query
parameters, the public page remains deterministic local replay.

The guarded evidence capture serves the pinned local `dist` bundle beneath an
intercepted Pages origin so the exact production Origin policy is exercised. Its
JSON records `captureMode=local-pinned-dist-under-intercepted-pages-origin`; it
does not claim that GitHub Pages served that bundle.

## Microsoft references

- [Azure Digital Twins endpoints and event routes](https://learn.microsoft.com/en-us/azure/digital-twins/concepts-route-events)
- [Create Azure Digital Twins event routes and filters](https://learn.microsoft.com/en-us/azure/digital-twins/how-to-create-routes)
- [Azure IoT Hub and Event Grid](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-event-grid)
- [Event Grid system-topic subscription Bicep schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.eventgrid/2022-06-15/systemtopics/eventsubscriptions)
- [Flex Consumption Function Apps](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Azure Digital Twins 3D Scenes Studio](https://learn.microsoft.com/en-us/azure/digital-twins/how-to-use-3d-scenes-studio)
- [Microsoft 3D Scenes configuration schema v1.0.0](https://github.com/microsoft/iot-cardboard-js/blob/263f5ddc496b0b7ab1a9b837764f786e1e2e54e1/schemas/3DScenesConfiguration/v1.0.0/3DScenesConfiguration.schema.json)
