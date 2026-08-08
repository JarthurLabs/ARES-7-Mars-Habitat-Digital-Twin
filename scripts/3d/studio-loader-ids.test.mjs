import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { GLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.js";
import "@babylonjs/loaders/glTF/2.0/index.js";
import { SEGMENTS } from "./export-ares7-glb.mjs";

// microsoft/iot-cardboard-js main pins these loader packages to 5.11.0 and its
// SceneView matches configuration objectIDs against Babylon mesh.id. This test
// proves the IDs produced by that published loader for the checked-in GLB. It
// does not replace verification against the separately deployed Studio build.

describe("Microsoft published 3D Scenes viewer loader compatibility", () => {
  it("loads the one-primitive GLB with the ten stable node names as mesh IDs", async () => {
    assert.equal(GLTFFileLoader.name, "GLTFFileLoader");
    const previousLogLevels = Logger.LogLevels;
    Logger.LogLevels = Logger.ErrorLogLevel;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const bytes = readFileSync("models/3d/ares7-habitat-segmented.glb");
      const loader = new GLTFFileLoader();
      const data = await loader.directLoad(
        scene,
        `model/gltf-binary;base64,${bytes.toString("base64")}`,
      );
      await loader.importMeshAsync(null, scene, data, "", undefined, "ares7.glb");
      const loadedMeshIds = scene.meshes
        .map(({ id }) => id)
        .filter((id) => id !== "__root__");
      assert.deepEqual(
        loadedMeshIds,
        SEGMENTS.map(({ twinId }) => twinId),
      );

      const configuration = JSON.parse(
        readFileSync("models/3d/3DScenesConfiguration.json", "utf8"),
      );
      const configuredObjectIds = configuration.configuration.scenes[0].elements.flatMap(
        ({ objectIDs }) => objectIDs,
      );
      assert.deepEqual(configuredObjectIds, loadedMeshIds);
    } finally {
      scene.dispose();
      engine.dispose();
      Logger.LogLevels = previousLogLevels;
    }
  });
});
