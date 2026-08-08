import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SEGMENTS } from "./export-ares7-glb.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

export const SCENES_SCHEMA_VERSION = "v1.0.0";
export const SCENES_SCHEMA_URL =
  "https://raw.githubusercontent.com/microsoft/iot-cardboard-js/main/schemas/3DScenesConfiguration/v1.0.0/3DScenesConfiguration.schema.json";
export const SCENE_CONTAINER_NAME = "ares7-3d-scenes";
export const SCENE_ASSET_BLOB_NAME = "ares7-habitat-segmented.glb";
export const SCENE_CONFIGURATION_BLOB_NAME = "3DScenesConfiguration.json";

// This account name is the redacted deployment output already recorded in
// evidence/logs/2026-07-31-azure-core-deployment.txt. Its presence here does
// not claim that either scene blob has been uploaded or rendered in Studio.
export const EVIDENCED_STORAGE_ACCOUNT_NAME = "stares7j6vhj3eh4zuie";

const DISPLAY_NAMES = Object.freeze({
  "ares7-environment": "Mars surface environment",
  "ares7-habitat": "ARES-7 habitat",
  "ares7-module-command": "Command module",
  "ares7-module-crew": "Crew module",
  "ares7-module-lab": "Science lab",
  "ares7-module-greenhouse": "Greenhouse",
  "ares7-life-support": "Life support",
  "ares7-airlock-main": "Main airlock",
  "ares7-battery-alpha": "Battery Alpha",
  "ares7-solar-alpha": "Solar Alpha",
});

function assertStorageAccountName(storageAccountName) {
  if (!/^stares7[a-z0-9]{1,17}$/.test(storageAccountName)) {
    throw new Error(
      "the 3D Scenes storage account must be a lowercase ARES-7 account named stares7* (3-24 characters)",
    );
  }
}

function stableId(label) {
  return createHash("sha256")
    .update(`ares7:3d-scenes:${SCENES_SCHEMA_VERSION}:${label}`)
    .digest("hex")
    .slice(0, 32);
}

export function sceneElementId(twinId) {
  return stableId(`element:${twinId}`);
}

export function sceneAssetUrl(storageAccountName) {
  assertStorageAccountName(storageAccountName);
  return `https://${storageAccountName}.blob.core.windows.net/${SCENE_CONTAINER_NAME}/${SCENE_ASSET_BLOB_NAME}`;
}

function valueRange(label, values, visual) {
  return {
    id: stableId(`range:${label}`),
    values,
    visual,
  };
}

function expressionRangeVisual({ label, displayName, property, valueRangeType, valueRanges }) {
  return {
    type: "ExpressionRangeVisual",
    id: stableId(`visual:${label}`),
    displayName,
    valueExpression: `PrimaryTwin.${property}`,
    expressionType: "CategoricalValues",
    valueRangeType,
    valueRanges,
    objectIDs: { expression: "objectIDs" },
  };
}

function valueWidget(label, displayName, property, type) {
  return {
    type: "Value",
    id: stableId(`widget:${label}`),
    widgetConfiguration: {
      displayName,
      valueExpression: `PrimaryTwin.${property}`,
      type,
    },
  };
}

function behavior(label, displayName, twinIds, visuals) {
  return {
    id: stableId(`behavior:${label}`),
    displayName,
    datasources: [
      {
        type: "ElementTwinToObjectMappingDataSource",
        elementIDs: twinIds.map(sceneElementId),
      },
    ],
    visuals,
  };
}

export function buildAres7SceneConfiguration(
  storageAccountName = EVIDENCED_STORAGE_ACCOUNT_NAME,
) {
  const habitatState = behavior(
    "habitat-state",
    "Habitat mission state",
    ["ares7-habitat"],
    [
      expressionRangeVisual({
        label: "habitat-state",
        displayName: "Mission state coloring",
        property: "operationalState",
        valueRangeType: "string",
        valueRanges: [
          valueRange("habitat-nominal", ["NOMINAL", "RESOLVED"], {
            color: "#26C485",
            labelExpression: "Nominal or resolved",
          }),
          valueRange("habitat-warning", ["STORM_WARNING"], {
            color: "#F5A623",
            iconName: "Warning",
            labelExpression: "Storm warning",
          }),
          valueRange("habitat-critical", ["POWER_CRITICAL", "LIFE_SUPPORT_RISK"], {
            color: "#C32F27",
            iconName: "Warning",
            labelExpression: "Critical mission state",
          }),
          valueRange("habitat-containment", ["CONTAINMENT"], {
            color: "#8B5CF6",
            labelExpression: "Containment active",
          }),
          valueRange("habitat-recovery", ["RECOVERY", "RESTORATION"], {
            color: "#33A1FD",
            labelExpression: "Recovery or restoration",
          }),
        ],
      }),
      {
        type: "Popover",
        title: "Habitat mission state",
        widgets: [
          valueWidget("habitat-operational-state", "Operational state", "operationalState", "string"),
          valueWidget("habitat-alarm-level", "Alarm level", "alarmLevel", "string"),
          valueWidget("habitat-operator-decision", "Operator decision", "operatorDecision", "string"),
          valueWidget("habitat-controller-action", "Controller action", "controllerAction", "string"),
        ],
        objectIDs: { expression: "objectIDs" },
      },
    ],
  );

  const subsystemHealth = behavior(
    "subsystem-health",
    "Power and life-support health",
    ["ares7-solar-alpha", "ares7-battery-alpha", "ares7-life-support"],
    [
      expressionRangeVisual({
        label: "subsystem-health",
        displayName: "Subsystem health coloring",
        property: "status",
        valueRangeType: "string",
        valueRanges: [
          valueRange("subsystem-nominal", ["NOMINAL"], {
            color: "#26C485",
            labelExpression: "Nominal",
          }),
          valueRange("subsystem-degraded", ["DEGRADED"], {
            color: "#F5A623",
            iconName: "Warning",
            labelExpression: "Degraded",
          }),
          valueRange("subsystem-critical", ["CRITICAL", "AT_RISK"], {
            color: "#C32F27",
            iconName: "Warning",
            labelExpression: "Critical or at risk",
          }),
        ],
      }),
    ],
  );

  const moduleIsolation = behavior(
    "module-isolation",
    "Module isolation",
    [
      "ares7-module-command",
      "ares7-module-crew",
      "ares7-module-lab",
      "ares7-module-greenhouse",
    ],
    [
      expressionRangeVisual({
        label: "module-isolation",
        displayName: "Isolation coloring",
        property: "isolated",
        valueRangeType: "boolean",
        valueRanges: [
          valueRange("module-connected", [false], {
            color: "#D7E0E5",
            labelExpression: "Connected",
          }),
          valueRange("module-isolated", [true], {
            color: "#F97316",
            iconName: "Warning",
            labelExpression: "Isolated",
          }),
        ],
      }),
    ],
  );

  const airlockSeal = behavior(
    "airlock-seal",
    "Airlock seal",
    ["ares7-airlock-main"],
    [
      expressionRangeVisual({
        label: "airlock-seal",
        displayName: "Seal coloring",
        property: "sealed",
        valueRangeType: "boolean",
        valueRanges: [
          valueRange("airlock-ready", [false], {
            color: "#D7E0E5",
            labelExpression: "Ready",
          }),
          valueRange("airlock-sealed", [true], {
            color: "#F97316",
            iconName: "Warning",
            labelExpression: "Sealed for containment",
          }),
        ],
      }),
    ],
  );

  const behaviors = [habitatState, subsystemHealth, moduleIsolation, airlockSeal];
  const behaviorIDs = behaviors.map(({ id }) => id);
  return {
    $schema: SCENES_SCHEMA_URL,
    configuration: {
      scenes: [
        {
          id: stableId("scene:ares7-habitat"),
          displayName: "ARES-7 Mars Habitat",
          description:
            "Segmented habitat view mapped to the ARES-7 Azure Digital Twins graph.",
          assets: [
            {
              type: "3DAsset",
              url: sceneAssetUrl(storageAccountName),
            },
          ],
          elements: SEGMENTS.map(({ twinId }) => ({
            type: "TwinToObjectMapping",
            id: sceneElementId(twinId),
            displayName: DISPLAY_NAMES[twinId],
            primaryTwinID: twinId,
            objectIDs: [twinId],
          })),
          behaviorIDs,
          pollingConfiguration: {
            minimumPollingFrequency: 12_000,
          },
        },
      ],
      behaviors,
      layers: [
        {
          id: stableId("layer:operations"),
          displayName: "Operations",
          behaviorIDs,
        },
      ],
    },
  };
}

function resolveRepositoryOutput(input) {
  const output = resolve(repositoryRoot, input);
  const repositoryRelative = relative(repositoryRoot, output);
  if (repositoryRelative === "" || repositoryRelative.startsWith("..")) {
    throw new Error("the scene configuration output must stay inside the repository");
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const storageAccountName =
    process.argv[2]?.trim() ||
    process.env.ARES7_SCENE_STORAGE_ACCOUNT?.trim() ||
    EVIDENCED_STORAGE_ACCOUNT_NAME;
  const output = resolveRepositoryOutput(
    process.argv[3] ?? `models/3d/${SCENE_CONFIGURATION_BLOB_NAME}`,
  );
  const configuration = buildAres7SceneConfiguration(storageAccountName);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(configuration, null, 2)}\n`, {
    flag: "w",
  });
  console.log(
    JSON.stringify(
      {
        output: relative(repositoryRoot, output),
        schemaVersion: SCENES_SCHEMA_VERSION,
        storageAccountName,
        scenes: configuration.configuration.scenes.length,
        elements: configuration.configuration.scenes[0].elements.length,
        behaviors: configuration.configuration.behaviors.length,
      },
      null,
      2,
    ),
  );
}
