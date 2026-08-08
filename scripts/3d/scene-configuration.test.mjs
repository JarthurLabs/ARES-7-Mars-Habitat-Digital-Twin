import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildAres7SceneConfiguration,
  EVIDENCED_STORAGE_ACCOUNT_NAME,
  sceneElementId,
} from "./export-scene-configuration.mjs";
import { buildAres7Glb, SEGMENTS } from "./export-ares7-glb.mjs";
import { validateAres7SceneConfiguration } from "./validate-scene-configuration.mjs";

function clone(value) {
  return structuredClone(value);
}

describe("ARES-7 3D Scenes configuration", () => {
  it("builds one deterministic scene mapped to every stable node and base twin", () => {
    const first = buildAres7SceneConfiguration();
    const second = buildAres7SceneConfiguration();
    assert.deepEqual(first, second);
    const result = validateAres7SceneConfiguration(first, {
      glbBuffer: buildAres7Glb(),
      expectedStorageAccountName: EVIDENCED_STORAGE_ACCOUNT_NAME,
    });
    assert.equal(result.elementCount, SEGMENTS.length);
    assert.equal(result.behaviorCount, 4);
    assert.equal(result.layerCount, 1);
    assert.deepEqual(result.stableNodes, SEGMENTS.map(({ twinId }) => twinId));
  });

  it("keeps the checked-in configuration generated from the deterministic builder", () => {
    const checkedIn = JSON.parse(
      readFileSync("models/3d/3DScenesConfiguration.json", "utf8"),
    );
    assert.deepEqual(
      checkedIn,
      buildAres7SceneConfiguration(EVIDENCED_STORAGE_ACCOUNT_NAME),
    );
    assert.doesNotThrow(() =>
      validateAres7SceneConfiguration(checkedIn, {
        expectedStorageAccountName: EVIDENCED_STORAGE_ACCOUNT_NAME,
      }),
    );
  });

  it("rejects a document that violates Microsoft's JSON Schema", () => {
    const invalid = clone(buildAres7SceneConfiguration());
    delete invalid.configuration.scenes[0].displayName;
    assert.throws(
      () => validateAres7SceneConfiguration(invalid, { glbBuffer: buildAres7Glb() }),
      /3D Scenes schema validation failed/,
    );
  });

  it("rejects cross-references that JSON Schema cannot verify", () => {
    const invalid = clone(buildAres7SceneConfiguration());
    invalid.configuration.scenes[0].behaviorIDs[0] = "missing-behavior";
    assert.throws(
      () => validateAres7SceneConfiguration(invalid, { glbBuffer: buildAres7Glb() }),
      /unknown behavior missing-behavior/,
    );
  });

  it("rejects an element that no longer targets its stable GLB node", () => {
    const invalid = clone(buildAres7SceneConfiguration());
    const habitat = invalid.configuration.scenes[0].elements.find(
      ({ id }) => id === sceneElementId("ares7-habitat"),
    );
    habitat.objectIDs = ["mesh_ares7_habitat"];
    assert.throws(
      () => validateAres7SceneConfiguration(invalid, { glbBuffer: buildAres7Glb() }),
      /must map to its stable GLB node ID/,
    );
  });

  it("rejects asset URLs carrying a SAS or any other query string", () => {
    const invalid = clone(buildAres7SceneConfiguration());
    invalid.configuration.scenes[0].assets[0].url += "?sp=r&sig=not-a-real-signature";
    assert.throws(
      () => validateAres7SceneConfiguration(invalid, { glbBuffer: buildAres7Glb() }),
      /must not contain a SAS or query string/,
    );
  });
});
