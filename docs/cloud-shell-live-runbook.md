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

## 4. Upload the optional segmented GLB

Generate and validate the original asset first:

```bash
npm run asset:export
npm run asset:test
npm run asset:validate
```

Upload it with Microsoft Entra authentication. The command never makes the
container public and refuses to overwrite an existing blob with a different
SHA-256 digest.

```bash
export ARES7_CONFIRM_SCENE_UPLOAD=upload-ares7-habitat-segmented.glb
npm run azure:upload:scene
unset ARES7_CONFIRM_SCENE_UPLOAD
```

The GLB has stable, separate mesh names. Create the scene, element mappings, and
behaviors in 3D Scenes Studio itself. Do not present the GLB as a configured
Studio scene until that Studio-generated configuration and live behavior have
been captured.

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

## Microsoft references

- [Azure Digital Twins endpoints and event routes](https://learn.microsoft.com/en-us/azure/digital-twins/concepts-route-events)
- [Create Azure Digital Twins event routes and filters](https://learn.microsoft.com/en-us/azure/digital-twins/how-to-create-routes)
- [Azure IoT Hub and Event Grid](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-event-grid)
- [Event Grid system-topic subscription Bicep schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.eventgrid/2022-06-15/systemtopics/eventsubscriptions)
- [Flex Consumption Function Apps](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Azure Digital Twins 3D Scenes Studio](https://learn.microsoft.com/en-us/azure/digital-twins/how-to-use-3d-scenes-studio)
