import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildAres7Glb, SEGMENTS } from "./export-ares7-glb.mjs";
import { parseGlb, validateAres7Glb } from "./validate-glb.mjs";

describe("ARES-7 segmented GLB", () => {
  it("exports deterministic original geometry", () => {
    const first = buildAres7Glb();
    const second = buildAres7Glb();
    assert.equal(
      createHash("sha256").update(first).digest("hex"),
      createHash("sha256").update(second).digest("hex"),
    );
    assert.deepEqual(first, second);
  });

  it("keeps one stable selectable mesh per physical twin", () => {
    const buffer = buildAres7Glb();
    const result = validateAres7Glb(buffer);
    assert.equal(result.meshCount, SEGMENTS.length);
    assert.ok(result.triangleCount >= 800);
    const { document } = parseGlb(buffer);
    for (const segment of SEGMENTS) {
      const node = document.nodes.find((candidate) => candidate.name === segment.twinId);
      assert.equal(document.meshes[node.mesh].name, segment.meshName);
    }
  });

  it("rejects a damaged header", () => {
    const damaged = Buffer.from(buildAres7Glb());
    damaged.writeUInt32LE(0, 0);
    assert.throws(() => validateAres7Glb(damaged), /magic/);
  });
});
