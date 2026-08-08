# Segmented 3D asset

`ares7-habitat-segmented.glb` is generated from original procedural geometry by
`scripts/3d/export-ares7-glb.mjs`. Each physical ARES-7 twin has its own stable
node and mesh name so a builder can select it independently in Azure Digital
Twins 3D Scenes Studio.

`3DScenesConfiguration.json` is a deterministic, offline-generated Studio
configuration targeting the storage account recorded in the existing Azure
core deployment evidence. It contains one scene, ten twin-to-object mappings,
four behaviors, and one operations layer. It is not evidence that the files
have been uploaded, accepted, or rendered by Studio.

Generate and validate it from the repository root:

```bash
node scripts/3d/export-ares7-glb.mjs
node scripts/3d/validate-glb.mjs
node --test scripts/3d/segmented-glb.test.mjs
node scripts/3d/export-scene-configuration.mjs stares7j6vhj3eh4zuie
node scripts/3d/validate-scene-configuration.mjs
node --test scripts/3d/scene-configuration.test.mjs
```

If the scoped storage account name changes, pass the new `stares7*` name to the
configuration exporter before upload. The uploader refuses a configuration
whose asset URL does not match the one ARES-7 storage account found inside the
exact guarded subscription and resource group.

The checked-in Microsoft schema is an unchanged copy of
[`microsoft/iot-cardboard-js` v1.0.0](https://github.com/microsoft/iot-cardboard-js/blob/263f5ddc496b0b7ab1a9b837764f786e1e2e54e1/schemas/3DScenesConfiguration/v1.0.0/3DScenesConfiguration.schema.json).
It uses JSON Schema draft 2020-12. The validator first verifies the schema's
pinned SHA-256, then checks the configuration with Hyperjump. A second validation
pass covers references the Microsoft schema does not express: unique IDs,
scene-to-behavior and behavior-to-element links, DTDL properties, base-graph
twin IDs, the private asset URL, and mesh-bearing GLB node IDs.

The generated behaviors visualize habitat mission state, power/life-support
health, module isolation, and the airlock seal. The habitat behavior also has a
popover for state, alarm, operator decision, and controller action.

Stable selectable nodes:

- `ares7-environment`
- `ares7-habitat`
- `ares7-module-command`
- `ares7-module-crew`
- `ares7-module-lab`
- `ares7-module-greenhouse`
- `ares7-life-support`
- `ares7-airlock-main`
- `ares7-battery-alpha`
- `ares7-solar-alpha`

Microsoft's [published viewer code](https://github.com/microsoft/iot-cardboard-js/blob/263f5ddc496b0b7ab1a9b837764f786e1e2e54e1/src/Components/3DV/SceneView.tsx)
matches `objectIDs` against Babylon `mesh.id`, and its
[lockfile](https://github.com/microsoft/iot-cardboard-js/blob/263f5ddc496b0b7ab1a9b837764f786e1e2e54e1/package-lock.json)
pins `@babylonjs/core` and
`@babylonjs/loaders` 5.11.0. The headless compatibility test loads this
one-primitive GLB with those exact packages and proves that its mesh IDs are
the ten stable `ares7-*` node names. Every element's `objectIDs` value is then
checked against the loaded IDs, and its `primaryTwinID` is checked against
`models/twin-graph.json`. This test covers Microsoft's published repository
version; it does not identify or prove the loader version deployed by the
hosted Studio.

Microsoft documents the Studio builder as the supported authoring workflow and
warns that manual configuration edits can create viewer inconsistencies. The
generated file therefore remains provisional until the real private container
is opened in 3D Scenes Studio and the scene, mappings, behaviors, and live
updates are visually verified. Do not use a fabricated viewer capture as proof.
