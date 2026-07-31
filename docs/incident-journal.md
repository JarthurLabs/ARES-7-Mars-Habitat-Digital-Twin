# Incident and build journal

This journal records real problems found while building ARES-7. It separates
resolved local issues from cloud behavior that still needs live validation.

## ARES-001 — Interface text missing from the first evidence capture

**Date:** 2026-07-31  
**Status:** Resolved locally

### Observation

The first visual capture rendered the Three.js habitat but did not reliably
render the interface text in the restricted capture environment.

### Cause

Presentation-critical fonts were requested outside the application bundle.
The capture environment could not rely on those remote requests.

### Change

Inter and IBM Plex Mono are now installed through `@fontsource` and their
required weights are imported from `src/main.ts`. The application no longer
depends on a remote font service.

### Verification

- Fresh local renders displayed headings, metrics, controls, and event entries.
- The viewer build and its three simulation tests pass.
- The current screenshots were produced by the corrected running application.

### Lesson

Evidence must reproduce in restricted and CI-like environments. Assets needed
to understand the system belong in the build.

## ARES-002 — Azure IoT SDK failed at the CommonJS/ESM boundary

**Date:** 2026-07-31  
**Status:** Resolved locally

### Observation

The ES module simulator failed before it could produce a dry run when Azure IoT
SDK members were loaded as named imports.

### Cause

`azure-iot-device` and `azure-iot-device-mqtt` expose CommonJS modules. Named
exports were not reliable at the Node.js ESM boundary.

### Change

The simulator now loads each package through a default import, then destructures
`Client`, `Message`, and `Mqtt` from the imported objects.

```js
import iotDevice from "azure-iot-device";
import mqttTransport from "azure-iot-device-mqtt";

const { Client, Message } = iotDevice;
const { Mqtt } = mqttTransport;
```

### Verification

- All three simulator tests pass.
- Dry-run mode emits 12 NDJSON frames.
- Dry-run mode makes no Azure connection.

### Lesson

The module format of a dependency must be checked rather than inferred from the
application's module format.

## ARES-003 — Raw telemetry assumed that containment had been approved

**Date:** 2026-07-31  
**Status:** Resolved locally

### Observation

The first deterministic scenario reduced bus demand and increased allocated
life-support power after a fixed tick. If an operator held or missed the
approval gate, those readings would imply a command that had never been
authorized.

### Cause

Environmental forcing and controller effects were combined in one scripted
timeline.

### Change

Raw frames now keep baseline `busDemandKw=34` and
`allocatedPowerKw=14`. Environment, solar, battery, and life-support readings
remain deterministic, but commanded effects belong solely to the controller.

### Verification

The simulator test `raw telemetry never assumes an unapproved controller
action` checks critical, recovery, and resolved frames without granting an
approval.

### Lesson

Sensor input and actuator state must have separate ownership. A convincing
demo is not worth weakening the approval boundary.

## ARES-004 — Bicep pre-deployment blockers

**Date:** 2026-07-31  
**Status:** Resolved and verified in Azure

### Observation

Pre-deployment review and Azure validation found template details that could
prevent the first core deployment or produce invalid names.

### Cause

- The maximum prefix length could make the derived storage account name exceed
  Azure's 24-character limit.
- Derived names did not explicitly normalize the prefix to lowercase.
- An early revision placed IoT authentication flags inside the similarly
  shaped Digital Twins properties block.
- Web PubSub `Free_F1` rejected the network ACL block accepted by paid tiers.

### Change

- `namePrefix` is limited to nine characters.
- `baseName` normalizes the prefix with `toLower`.
- IoT authentication flags were moved to the IoT Hub resource.
- The unsupported Free_F1 network ACL block was removed; local-key
  authentication remains disabled and the public-endpoint tradeoff is explicit.
- Digital Twins and Web PubSub local authentication are disabled; Storage
  shared-key access is disabled.

### Verification

`az bicep build` completed cleanly. Azure validation then succeeded, What-If
showed exactly seven creates, and deployment `ares7-core-20260731` completed
with state `Succeeded`. The live resource and SKU captures are in `evidence/`.

### Lesson

Name-length arithmetic and resource-provider schemas should be checked before
the first create operation. Preflight is part of cost control.

## ARES-005 — Scene metadata did not match the DTDL graph

**Date:** 2026-07-31  
**Status:** Resolved and recaptured

### Observation

The viewer called six visible objects a six-node twin graph and displayed
`dtmi:ares:habitat;1`, while the actual local definitions use
`dtmi:ares7:Habitat;1` and describe 11 twins.

### Change

The viewer now labels them `SCENE MODULES · 6 MODULES`, displays the real model
ID, and identifies its feed as a deterministic local simulation.

### Verification

Source and production build contain the corrected labels. All three 1600×900
screenshots were refreshed from the corrected running application.

### Lesson

Small labels are still technical claims. Visual polish must not blur the
difference between scene objects and cloud graph entities.

## Open items

- Deploy and prove the Functions/Event Grid service path before marking it live.
- Upload and verify the DTDL graph.
- Validate Event Grid ordering and duplicate behavior with a real scenario run.
- Add RBAC evidence without exposing tenant or subscription identifiers.
- Track the deprecation notices emitted by transitive Azure IoT SDK dependencies.
