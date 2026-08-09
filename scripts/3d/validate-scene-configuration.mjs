import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  registerSchema,
  validate as compileSchema,
} from "@hyperjump/json-schema/draft-2020-12";
import { SEGMENTS } from "./export-ares7-glb.mjs";
import {
  SCENE_ASSET_BLOB_NAME,
  SCENE_CONTAINER_NAME,
  SCENES_SCHEMA_URL,
} from "./export-scene-configuration.mjs";
import { parseGlb, validateAres7Glb } from "./validate-glb.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const schemaPath = resolve(
  repositoryRoot,
  "models/3d/schemas/3DScenesConfiguration-v1.0.0.schema.json",
);
const twinGraphPath = resolve(repositoryRoot, "models/twin-graph.json");
const dtdlModelsPath = resolve(repositoryRoot, "models/ares7-models.json");

export const SCENES_SCHEMA_SHA256 =
  "d32b2c210b0ae064028ec39b0bce71d38abbde3a9bca2d6bb319ac3ba0c3cd72";

function loadPinnedSchema() {
  const bytes = readFileSync(schemaPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    digest,
    SCENES_SCHEMA_SHA256,
    "the vendored Microsoft v1.0.0 schema does not match its pinned SHA-256",
  );
  return JSON.parse(bytes.toString("utf8"));
}

const schema = loadPinnedSchema();
registerSchema(schema);
const validateSchema = await compileSchema(schema.$id);

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function assertPrivateAssetUrl(assetUrl, expectedStorageAccountName) {
  const url = new URL(assetUrl);
  assert.equal(url.protocol, "https:", "the scene asset URL must use HTTPS");
  assert.equal(url.username, "", "the scene asset URL must not contain credentials");
  assert.equal(url.password, "", "the scene asset URL must not contain credentials");
  assert.equal(url.search, "", "the scene asset URL must not contain a SAS or query string");
  assert.equal(url.hash, "", "the scene asset URL must not contain a fragment");
  assert.match(
    url.hostname,
    /^stares7[a-z0-9]{1,17}\.blob\.core\.windows\.net$/,
    "the scene asset URL must use the guarded ARES-7 Azure Blob account",
  );
  if (expectedStorageAccountName) {
    assert.equal(
      url.hostname,
      `${expectedStorageAccountName}.blob.core.windows.net`,
      "the scene asset URL does not target the scoped ARES-7 storage account",
    );
  }
  assert.equal(
    url.pathname,
    `/${SCENE_CONTAINER_NAME}/${SCENE_ASSET_BLOB_NAME}`,
    "the scene asset URL must target the private ARES-7 scene container and GLB",
  );
}

function primaryTwinProperties(configuration, twinGraph, dtdlModels) {
  const modelByTwinId = new Map(
    twinGraph.twins.map(({ id, model }) => [id, model]),
  );
  const propertiesByModel = new Map(
    dtdlModels.map((model) => [
      model["@id"],
      new Set(
        model.contents
          .filter((content) => content["@type"] === "Property")
          .map((content) => content.name),
      ),
    ]),
  );
  const elementById = new Map(
    configuration.configuration.scenes.flatMap((scene) =>
      scene.elements.map((element) => [element.id, element]),
    ),
  );
  return { modelByTwinId, propertiesByModel, elementById };
}

function visualExpressions(visual) {
  const expressions = [];
  if (typeof visual.valueExpression === "string") {
    expressions.push(visual.valueExpression);
  }
  for (const widget of visual.widgets ?? []) {
    if (typeof widget.valueExpression === "string") {
      expressions.push(widget.valueExpression);
    }
    if (typeof widget.widgetConfiguration?.valueExpression === "string") {
      expressions.push(widget.widgetConfiguration.valueExpression);
    }
  }
  return expressions;
}

function validateBehaviorReferences(configuration, twinGraph, dtdlModels) {
  const { behaviors, layers, scenes } = configuration.configuration;
  assertUnique(behaviors.map(({ id }) => id), "behavior IDs");
  assertUnique(layers.map(({ id }) => id), "layer IDs");
  const behaviorById = new Map(behaviors.map((behavior) => [behavior.id, behavior]));
  const { modelByTwinId, propertiesByModel, elementById } = primaryTwinProperties(
    configuration,
    twinGraph,
    dtdlModels,
  );

  for (const scene of scenes) {
    for (const behaviorId of scene.behaviorIDs) {
      assert(behaviorById.has(behaviorId), `scene references unknown behavior ${behaviorId}`);
    }
  }
  for (const layer of layers) {
    for (const behaviorId of layer.behaviorIDs) {
      assert(behaviorById.has(behaviorId), `layer references unknown behavior ${behaviorId}`);
    }
  }

  for (const behavior of behaviors) {
    const elementIds = behavior.datasources.flatMap((datasource) =>
      datasource.type === "ElementTwinToObjectMappingDataSource"
        ? datasource.elementIDs
        : [],
    );
    assert(elementIds.length > 0, `behavior ${behavior.id} has no mapped elements`);
    assertUnique(elementIds, `behavior ${behavior.id} element references`);
    const elements = elementIds.map((elementId) => {
      const element = elementById.get(elementId);
      assert(element, `behavior ${behavior.id} references unknown element ${elementId}`);
      return element;
    });

    for (const visual of behavior.visuals) {
      for (const expression of visualExpressions(visual)) {
        const match = /^PrimaryTwin\.([A-Za-z][A-Za-z0-9]*)$/.exec(expression);
        assert(match, `unsupported generated expression ${expression}`);
        const property = match[1];
        for (const element of elements) {
          const modelId = modelByTwinId.get(element.primaryTwinID);
          assert(modelId, `element references unknown ARES-7 twin ${element.primaryTwinID}`);
          assert(
            propertiesByModel.get(modelId)?.has(property),
            `${element.primaryTwinID} model ${modelId} has no property ${property}`,
          );
        }
      }
    }
  }
}

export function validateAres7SceneConfiguration(
  configuration,
  {
    glbBuffer = readFileSync(
      resolve(repositoryRoot, `models/3d/${SCENE_ASSET_BLOB_NAME}`),
    ),
    twinGraph = JSON.parse(readFileSync(twinGraphPath, "utf8")),
    dtdlModels = JSON.parse(readFileSync(dtdlModelsPath, "utf8")),
    expectedStorageAccountName,
  } = {},
) {
  if (!validateSchema(configuration).valid) {
    throw new Error("3D Scenes schema validation failed");
  }
  assert.equal(
    configuration.$schema,
    SCENES_SCHEMA_URL,
    "the configuration must identify Microsoft's canonical v1.0.0 schema",
  );

  const glbResult = validateAres7Glb(glbBuffer);
  const { document } = parseGlb(glbBuffer);
  const { scenes, behaviors, layers } = configuration.configuration;
  assert.equal(scenes.length, 1, "ARES-7 must generate exactly one Studio scene");
  const [scene] = scenes;
  assert.equal(scene.assets.length, 1, "the ARES-7 scene must use exactly one GLB asset");
  assert.equal(scene.assets[0].type, "3DAsset", "the scene asset type must be 3DAsset");
  assertPrivateAssetUrl(scene.assets[0].url, expectedStorageAccountName);

  assertUnique(scene.elements.map(({ id }) => id), "scene element IDs");
  assertUnique(
    scene.elements.flatMap(({ objectIDs }) => objectIDs),
    "scene element object IDs",
  );
  assert.equal(
    scene.elements.length,
    SEGMENTS.length,
    "every segmented ARES-7 GLB node must have one element mapping",
  );
  const graphTwins = new Set(twinGraph.twins.map(({ id }) => id));
  for (const segment of SEGMENTS) {
    const matching = scene.elements.filter(
      ({ primaryTwinID }) => primaryTwinID === segment.twinId,
    );
    assert.equal(
      matching.length,
      1,
      `${segment.twinId} must have exactly one twin-to-object mapping`,
    );
    assert.deepEqual(
      matching[0].objectIDs,
      [segment.twinId],
      `${segment.twinId} must map to its stable GLB node ID`,
    );
    assert(graphTwins.has(segment.twinId), `${segment.twinId} is missing from the base twin graph`);
    const node = document.nodes.find(({ name }) => name === segment.twinId);
    assert(Number.isInteger(node?.mesh), `${segment.twinId} is not a mesh-bearing GLB node`);
  }

  validateBehaviorReferences(configuration, twinGraph, dtdlModels);
  const sceneBehaviorIds = new Set(scene.behaviorIDs);
  assert.equal(
    sceneBehaviorIds.size,
    behaviors.length,
    "the generated scene must reference every generated behavior exactly once",
  );
  assert.equal(layers.length, 1, "the generated scene must define one operations layer");
  assert.deepEqual(
    new Set(layers[0].behaviorIDs),
    sceneBehaviorIds,
    "the operations layer must contain every scene behavior",
  );

  return {
    schemaVersion: "v1.0.0",
    schemaSha256: SCENES_SCHEMA_SHA256,
    sceneId: scene.id,
    assetUrl: scene.assets[0].url,
    elementCount: scene.elements.length,
    behaviorCount: behaviors.length,
    layerCount: layers.length,
    glbByteLength: glbResult.byteLength,
    stableNodes: glbResult.stableNodes,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(
    process.argv[2] ?? resolve(repositoryRoot, "models/3d/3DScenesConfiguration.json"),
  );
  const glb = resolve(
    process.argv[3] ?? resolve(repositoryRoot, `models/3d/${SCENE_ASSET_BLOB_NAME}`),
  );
  const configuration = JSON.parse(readFileSync(input, "utf8"));
  const result = validateAres7SceneConfiguration(configuration, {
    glbBuffer: readFileSync(glb),
  });
  console.log(JSON.stringify({ input, glb, ...result }, null, 2));
}
