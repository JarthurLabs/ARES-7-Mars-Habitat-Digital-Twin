# Segmented 3D asset

`ares7-habitat-segmented.glb` is generated from original procedural geometry by
`scripts/3d/export-ares7-glb.mjs`. Each physical ARES-7 twin has its own stable
node and mesh name so a builder can select it independently in Azure Digital
Twins 3D Scenes Studio.

Generate and validate it from the repository root:

```bash
node scripts/3d/export-ares7-glb.mjs
node scripts/3d/validate-glb.mjs
node --test scripts/3d/segmented-glb.test.mjs
```

The GLB contains geometry, materials, stable names, and non-authoritative twin
ID hints only. It deliberately does not contain or imitate the configuration
file that 3D Scenes Studio creates. Element-to-twin mappings and behaviors must
be created and verified in Studio, then exported as evidence separately.

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
