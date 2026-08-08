import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

export const SEGMENTS = Object.freeze([
  { twinId: "ares7-environment", meshName: "mesh_ares7_environment", material: "martian_regolith" },
  { twinId: "ares7-habitat", meshName: "mesh_ares7_habitat", material: "habitat_foundation" },
  { twinId: "ares7-module-command", meshName: "mesh_ares7_module_command", material: "command_white" },
  { twinId: "ares7-module-crew", meshName: "mesh_ares7_module_crew", material: "crew_white" },
  { twinId: "ares7-module-lab", meshName: "mesh_ares7_module_lab", material: "lab_white" },
  { twinId: "ares7-module-greenhouse", meshName: "mesh_ares7_module_greenhouse", material: "greenhouse_glass" },
  { twinId: "ares7-life-support", meshName: "mesh_ares7_life_support", material: "life_support_blue" },
  { twinId: "ares7-airlock-main", meshName: "mesh_ares7_airlock_main", material: "airlock_orange" },
  { twinId: "ares7-battery-alpha", meshName: "mesh_ares7_battery_alpha", material: "battery_charcoal" },
  { twinId: "ares7-solar-alpha", meshName: "mesh_ares7_solar_alpha", material: "solar_blue" },
]);

const MATERIALS = Object.freeze({
  martian_regolith: [0.34, 0.09, 0.045, 1],
  habitat_foundation: [0.13, 0.15, 0.16, 1],
  command_white: [0.73, 0.78, 0.79, 1],
  crew_white: [0.63, 0.69, 0.7, 1],
  lab_white: [0.57, 0.65, 0.68, 1],
  greenhouse_glass: [0.16, 0.48, 0.38, 1],
  life_support_blue: [0.12, 0.38, 0.52, 1],
  airlock_orange: [0.79, 0.29, 0.08, 1],
  battery_charcoal: [0.12, 0.14, 0.16, 1],
  solar_blue: [0.035, 0.16, 0.34, 1],
});

function emptyGeometry() {
  return { positions: [], normals: [], indices: [] };
}

function mergeGeometry(parts) {
  const merged = emptyGeometry();
  for (const part of parts) {
    const offset = merged.positions.length / 3;
    merged.positions.push(...part.positions);
    merged.normals.push(...part.normals);
    merged.indices.push(...part.indices.map((index) => index + offset));
  }
  return merged;
}

function box(width, height, depth, center = [0, 0, 0]) {
  const [cx, cy, cz] = center;
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces = [
    { normal: [1, 0, 0], corners: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
    { normal: [-1, 0, 0], corners: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
    { normal: [0, 1, 0], corners: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { normal: [0, -1, 0], corners: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
    { normal: [0, 0, 1], corners: [[x, -y, z], [x, y, z], [-x, y, z], [-x, -y, z]] },
    { normal: [0, 0, -1], corners: [[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]] },
  ];
  const geometry = emptyGeometry();
  for (const face of faces) {
    const offset = geometry.positions.length / 3;
    for (const corner of face.corners) {
      geometry.positions.push(corner[0] + cx, corner[1] + cy, corner[2] + cz);
      geometry.normals.push(...face.normal);
    }
    geometry.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return geometry;
}

function cylinder(radius, height, segments = 32, center = [0, 0, 0]) {
  const [cx, cy, cz] = center;
  const half = height / 2;
  const geometry = emptyGeometry();
  for (let index = 0; index < segments; index += 1) {
    const start = (index / segments) * Math.PI * 2;
    const end = ((index + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(start);
    const z0 = Math.sin(start);
    const x1 = Math.cos(end);
    const z1 = Math.sin(end);
    let offset = geometry.positions.length / 3;
    geometry.positions.push(
      cx + x0 * radius, cy - half, cz + z0 * radius,
      cx + x0 * radius, cy + half, cz + z0 * radius,
      cx + x1 * radius, cy + half, cz + z1 * radius,
      cx + x1 * radius, cy - half, cz + z1 * radius,
    );
    geometry.normals.push(x0, 0, z0, x0, 0, z0, x1, 0, z1, x1, 0, z1);
    geometry.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);

    offset = geometry.positions.length / 3;
    geometry.positions.push(
      cx, cy + half, cz,
      cx + x0 * radius, cy + half, cz + z0 * radius,
      cx + x1 * radius, cy + half, cz + z1 * radius,
      cx, cy - half, cz,
      cx + x1 * radius, cy - half, cz + z1 * radius,
      cx + x0 * radius, cy - half, cz + z0 * radius,
    );
    geometry.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
    geometry.indices.push(offset, offset + 1, offset + 2, offset + 3, offset + 4, offset + 5);
  }
  return geometry;
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function indexBuffer(values) {
  if (Math.max(...values) > 65_535) throw new Error("a segmented mesh exceeded 16-bit index capacity");
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function accessorBounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  return { minimum, maximum };
}

function segmentGeometry(twinId) {
  switch (twinId) {
    case "ares7-environment":
      return { geometry: cylinder(24, 0.35, 64), translation: [0, -0.2, 0] };
    case "ares7-habitat":
      return {
        geometry: mergeGeometry([
          cylinder(14.5, 0.32, 64),
          box(4.8, 0.72, 1.2, [-3.9, 0.52, 0.5]),
          box(4.8, 0.72, 1.2, [3.9, 0.52, 0.5]),
          box(1.2, 0.72, 5.2, [-2.5, 0.52, -3.4]),
          box(1.2, 0.72, 5.2, [2.8, 0.52, -3.4]),
          box(1.3, 0.72, 4.4, [0, 0.52, 3.6]),
        ]),
        translation: [0, 0, 0],
      };
    case "ares7-module-command":
      return { geometry: mergeGeometry([cylinder(3.5, 2.2), cylinder(1.8, 0.55, 32, [0, 1.32, 0])]), translation: [0, 1.28, 0] };
    case "ares7-module-crew":
      return { geometry: mergeGeometry([cylinder(3.0, 1.9), box(3.5, 0.18, 0.22, [0, 0.25, 3])]), translation: [-7.2, 1.12, 1.1] };
    case "ares7-module-lab":
      return { geometry: mergeGeometry([cylinder(2.8, 1.8), box(0.2, 1.25, 3.0, [0, 0.1, 0])]), translation: [7.0, 1.08, 1.2] };
    case "ares7-module-greenhouse":
      return { geometry: mergeGeometry([cylinder(3.1, 1.55), box(4.6, 0.15, 0.25, [0, 0.4, 0])]), translation: [-5.0, 0.95, -6.3] };
    case "ares7-life-support":
      return { geometry: mergeGeometry([cylinder(2.45, 1.75), cylinder(0.42, 2.4, 20, [-1.25, 1.0, 0]), cylinder(0.42, 2.4, 20, [1.25, 1.0, 0])]), translation: [5.2, 1.02, -6.3] };
    case "ares7-airlock-main":
      return { geometry: mergeGeometry([cylinder(1.85, 1.35), box(1.15, 1.0, 0.22, [0, 0, 1.82])]), translation: [0.15, 0.82, 6.2] };
    case "ares7-battery-alpha":
      return { geometry: mergeGeometry([box(2.7, 1.5, 2.2), box(0.24, 1.1, 1.5, [-1.46, 0, 0]), box(0.24, 1.1, 1.5, [1.46, 0, 0])]), translation: [9.2, 0.9, -5.1] };
    case "ares7-solar-alpha":
      return {
        geometry: mergeGeometry([
          box(6.4, 0.14, 2.4, [-3.35, 1.15, 0]),
          box(6.4, 0.14, 2.4, [3.35, 1.15, 0]),
          cylinder(0.22, 1.9, 20, [0, 0.15, 0]),
          box(1.25, 0.55, 0.9, [0, -0.65, 0]),
        ]),
        translation: [-12.2, 0.85, -3.9],
      };
    default:
      throw new Error(`no geometry exists for ${twinId}`);
  }
}

export function buildAres7Glb() {
  const binaryChunks = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [{ name: "ARES-7 Segmented Habitat", children: SEGMENTS.map((_, index) => index + 1) }];
  let byteOffset = 0;

  function appendBuffer(buffer, target) {
    const padding = (4 - (byteOffset % 4)) % 4;
    if (padding) {
      binaryChunks.push(Buffer.alloc(padding));
      byteOffset += padding;
    }
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length, target });
    binaryChunks.push(buffer);
    byteOffset += buffer.length;
    return viewIndex;
  }

  const materialNames = Object.keys(MATERIALS);
  const materials = materialNames.map((name) => ({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: MATERIALS[name],
      metallicFactor: name === "solar_blue" || name === "battery_charcoal" ? 0.72 : 0.28,
      roughnessFactor: name === "martian_regolith" ? 0.96 : 0.48,
    },
    doubleSided: false,
  }));

  for (const segment of SEGMENTS) {
    const { geometry, translation } = segmentGeometry(segment.twinId);
    if (geometry.positions.length / 3 !== geometry.normals.length / 3) {
      throw new Error(`${segment.twinId} has mismatched position and normal counts`);
    }
    const positionView = appendBuffer(floatBuffer(geometry.positions), 34962);
    const normalView = appendBuffer(floatBuffer(geometry.normals), 34962);
    const indexView = appendBuffer(indexBuffer(geometry.indices), 34963);
    const bounds = accessorBounds(geometry.positions);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      byteOffset: 0,
      componentType: 5126,
      count: geometry.positions.length / 3,
      type: "VEC3",
      min: bounds.minimum,
      max: bounds.maximum,
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      byteOffset: 0,
      componentType: 5126,
      count: geometry.normals.length / 3,
      type: "VEC3",
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      byteOffset: 0,
      componentType: 5123,
      count: geometry.indices.length,
      type: "SCALAR",
      min: [Math.min(...geometry.indices)],
      max: [Math.max(...geometry.indices)],
    });
    const meshIndex = meshes.length;
    meshes.push({
      name: segment.meshName,
      primitives: [{
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: indexAccessor,
        material: materialNames.indexOf(segment.material),
        mode: 4,
      }],
      extras: { ares7TwinId: segment.twinId, stableMeshName: segment.meshName },
    });
    nodes.push({
      name: segment.twinId,
      mesh: meshIndex,
      translation,
      extras: { ares7TwinId: segment.twinId, selectableSegment: true },
    });
  }

  const binary = Buffer.concat(binaryChunks);
  const document = {
    asset: {
      version: "2.0",
      generator: "ARES-7 original segmented habitat exporter",
      copyright: "2026 JarthurLabs",
    },
    scene: 0,
    scenes: [{ name: "ARES-7 Mars Habitat", nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
    extras: {
      units: "meters",
      coordinateSystem: "glTF right-handed Y-up",
      studioConfigurationIncluded: false,
    },
  };
  const rawJson = Buffer.from(JSON.stringify(document), "utf8");
  const jsonPadding = (4 - (rawJson.length % 4)) % 4;
  const json = Buffer.concat([rawJson, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const paddedBinary = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + json.length + 8 + paddedBinary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, paddedBinary]);
}

export function writeAres7Glb(outputPath = resolve(repositoryRoot, "models/3d/ares7-habitat-segmented.glb")) {
  const resolved = resolve(outputPath);
  if (!resolved.endsWith(".glb")) throw new Error("output path must end in .glb");
  mkdirSync(dirname(resolved), { recursive: true });
  const glb = buildAres7Glb();
  writeFileSync(resolved, glb);
  return { outputPath: resolved, byteLength: glb.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = writeAres7Glb(process.argv[2]);
  console.log(`exported ${SEGMENTS.length} stable mesh segments to ${result.outputPath} (${result.byteLength} bytes)`);
}
