import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const allowedExtensions = new Set([".css", ".html", ".ico", ".jpeg", ".jpg", ".js", ".png", ".svg", ".txt", ".webmanifest", ".webp", ".woff", ".woff2"]);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await filesIn(root);
if (!files.some((file) => file.endsWith("index.html"))) throw new Error("Pages artifact is missing index.html");

for (const file of files) {
  const path = relative(root, file);
  const extension = extname(path).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`Unexpected Pages artifact file: ${path}`);
  if (path.endsWith(".map") || /(^|\/)\.env($|[./])/.test(path)) throw new Error(`Sensitive build artifact rejected: ${path}`);
}

const index = await readFile(join(root, "index.html"), "utf8");
if (/VITE_ARES7_NEGOTIATE_URL|AZURE_WEBPUBSUB|access_token/i.test(index)) {
  throw new Error("Pages index contains a live configuration or token marker");
}

console.log(`Validated ${files.length} static Pages files; no source maps or environment files found.`);
