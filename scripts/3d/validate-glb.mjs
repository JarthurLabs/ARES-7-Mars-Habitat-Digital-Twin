import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { SEGMENTS } from "./export-ares7-glb.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const maximumStudioFileBytes = 100 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseGlb(buffer) {
  assert(Buffer.isBuffer(buffer), "GLB input must be a Buffer");
  assert(buffer.length >= 28, "GLB is too short");
  assert(buffer.readUInt32LE(0) === 0x46546c67, "GLB magic is invalid");
  assert(buffer.readUInt32LE(4) === 2, "GLB must use glTF 2.0");
  assert(buffer.readUInt32LE(8) === buffer.length, "GLB declared length does not match the file");
  let offset = 12;
  const chunks = [];
  while (offset < buffer.length) {
    assert(offset + 8 <= buffer.length, "GLB chunk header is truncated");
    const byteLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    assert(byteLength % 4 === 0, "GLB chunks must be four-byte aligned");
    assert(offset + byteLength <= buffer.length, "GLB chunk exceeds the file boundary");
    chunks.push({ type, data: buffer.subarray(offset, offset + byteLength) });
    offset += byteLength;
  }
  assert(chunks.length === 2, "GLB must contain exactly JSON and BIN chunks");
  assert(chunks[0].type === 0x4e4f534a, "the first GLB chunk must be JSON");
  assert(chunks[1].type === 0x004e4942, "the second GLB chunk must be BIN");
  const document = JSON.parse(chunks[0].data.toString("utf8").trimEnd());
  return { document, binary: chunks[1].data };
}

export function validateAres7Glb(buffer) {
  assert(buffer.length < maximumStudioFileBytes, "GLB exceeds the 100 MB 3D Scenes Studio recommendation");
  const { document, binary } = parseGlb(buffer);
  assert(document.asset?.version === "2.0", "asset metadata must declare glTF 2.0");
  assert(document.extras?.studioConfigurationIncluded === false, "the asset must not claim a Studio configuration");
  assert(document.buffers?.length === 1 && !document.buffers[0].uri, "GLB must use one embedded binary buffer");
  assert(document.buffers[0].byteLength <= binary.length, "embedded buffer length exceeds the BIN chunk");
  assert(Array.isArray(document.nodes) && Array.isArray(document.meshes), "GLB must define nodes and meshes");

  const nodeNames = document.nodes.map((node) => node.name).filter(Boolean);
  const meshNames = document.meshes.map((mesh) => mesh.name).filter(Boolean);
  assert(new Set(nodeNames).size === nodeNames.length, "node names must be unique");
  assert(new Set(meshNames).size === meshNames.length, "mesh names must be unique");
  assert(document.meshes.length === SEGMENTS.length, "each ARES-7 segment must have one mesh");

  let triangleCount = 0;
  for (const segment of SEGMENTS) {
    const node = document.nodes.find((candidate) => candidate.name === segment.twinId);
    assert(node, `missing stable node ${segment.twinId}`);
    const mesh = document.meshes[node.mesh];
    assert(mesh?.name === segment.meshName, `${segment.twinId} does not map to ${segment.meshName}`);
    assert(mesh.extras?.ares7TwinId === segment.twinId, `${segment.meshName} lost its twin hint`);
    assert(mesh.primitives?.length === 1, `${segment.meshName} must have one selectable primitive`);
    const primitive = mesh.primitives[0];
    assert(primitive.mode === 4, `${segment.meshName} must use triangle primitives`);
    assert(Number.isInteger(primitive.attributes?.POSITION), `${segment.meshName} is missing positions`);
    assert(Number.isInteger(primitive.attributes?.NORMAL), `${segment.meshName} is missing normals`);
    assert(Number.isInteger(primitive.indices), `${segment.meshName} is missing indices`);
    const indexAccessor = document.accessors[primitive.indices];
    assert(indexAccessor.count % 3 === 0, `${segment.meshName} index count is not triangular`);
    triangleCount += indexAccessor.count / 3;
  }

  for (const [index, view] of document.bufferViews.entries()) {
    assert(view.buffer === 0, `bufferView ${index} does not use the embedded buffer`);
    assert(view.byteOffset % 4 === 0, `bufferView ${index} is not four-byte aligned`);
    assert(view.byteOffset + view.byteLength <= document.buffers[0].byteLength, `bufferView ${index} is out of bounds`);
  }
  for (const [index, accessor] of document.accessors.entries()) {
    assert(Number.isInteger(accessor.bufferView), `accessor ${index} has no bufferView`);
    assert(accessor.count > 0, `accessor ${index} is empty`);
    assert([5123, 5126].includes(accessor.componentType), `accessor ${index} has an unsupported component type`);
  }
  assert(triangleCount >= 800, "segmented habitat geometry is unexpectedly sparse");
  return {
    byteLength: buffer.length,
    meshCount: document.meshes.length,
    nodeCount: document.nodes.length,
    triangleCount,
    stableNodes: SEGMENTS.map((segment) => segment.twinId),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(process.argv[2] ?? resolve(repositoryRoot, "models/3d/ares7-habitat-segmented.glb"));
  const result = validateAres7Glb(readFileSync(input));
  console.log(JSON.stringify({ input, ...result }, null, 2));
}
