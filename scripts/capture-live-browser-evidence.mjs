import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = resolve(repositoryRoot, "dist");
const evidenceRoot = resolve(
  repositoryRoot,
  process.env.ARES7_BROWSER_EVIDENCE_DIR ?? "artifacts/live-browser-evidence",
);
const negotiateUrl = process.env.ARES7_LIVE_NEGOTIATE_URL?.trim();
const scenarioRunId = process.env.ARES7_SCENARIO_RUN_ID?.trim();
const pagesOrigin = "https://jarthurlabs.github.io";
const pagesPath = "/ARES-7-Mars-Habitat-Digital-Twin/";
const pagesUrl = new URL(pagesPath, pagesOrigin);
const functionHost = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?\.azurewebsites\.net$/i;
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!negotiateUrl) throw new Error("ARES7_LIVE_NEGOTIATE_URL is required");
if (!scenarioRunId || !runIdPattern.test(scenarioRunId)) {
  throw new Error("ARES7_SCENARIO_RUN_ID must be the live scenario UUID");
}

const parsedNegotiateUrl = new URL(negotiateUrl);
if (
  parsedNegotiateUrl.protocol !== "https:" ||
  !functionHost.test(parsedNegotiateUrl.hostname) ||
  parsedNegotiateUrl.port ||
  parsedNegotiateUrl.username ||
  parsedNegotiateUrl.password ||
  parsedNegotiateUrl.hash ||
  parsedNegotiateUrl.search ||
  parsedNegotiateUrl.pathname !== "/api/viewer/negotiate"
) {
  throw new Error(
    "ARES7_LIVE_NEGOTIATE_URL must be the exact credential-free HTTPS azurewebsites.net negotiate route",
  );
}

await mkdir(evidenceRoot, { recursive: true });
const verifiedDistRoot = await realpath(distRoot);

function contentType(pathname) {
  return new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
  ]).get(extname(pathname).toLowerCase()) ?? "application/octet-stream";
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  colorScheme: "dark",
  reducedMotion: "reduce",
  recordVideo: { dir: evidenceRoot, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
const browserMessages = [];
page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));

await page.route(`${pagesOrigin}${pagesPath}**`, async (route) => {
  const requestUrl = new URL(route.request().url());
  let requestedPath = decodeURIComponent(requestUrl.pathname.slice(pagesPath.length));
  if (!requestedPath || requestedPath.endsWith("/")) requestedPath += "index.html";
  const filePath = resolve(verifiedDistRoot, requestedPath);
  const relativePath = relative(verifiedDistRoot, filePath);
  if (relativePath.startsWith("..") || relativePath === "") {
    await route.fulfill({ status: 404, body: "Not found" });
    return;
  }
  try {
    const body = await readFile(filePath);
    await route.fulfill({ status: 200, body, contentType: contentType(filePath) });
  } catch (error) {
    if (error?.code === "ENOENT") {
      await route.fulfill({ status: 404, body: "Not found" });
      return;
    }
    throw error;
  }
});

const liveUrl = new URL(pagesUrl);
liveUrl.searchParams.set("source", "azure");
liveUrl.searchParams.set("negotiate", parsedNegotiateUrl.toString());
const video = page.video();

try {
  await page.goto(liveUrl.toString(), { waitUntil: "networkidle" });
  await page.locator("#data-source-label").filter({ hasText: "AZURE LIVE · READ ONLY" }).waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await writeFile(
    resolve(evidenceRoot, "browser-ready.json"),
    `${JSON.stringify({ status: "connected-read-only", origin: pagesOrigin, capturedAtUtc: new Date().toISOString() }, null, 2)}\n`,
  );

  await page.waitForFunction(
    (expectedRunId) => document.querySelector("#run-id")?.textContent === expectedRunId,
    scenarioRunId,
    { timeout: 300_000 },
  );
  await page.screenshot({
    path: resolve(evidenceRoot, "azure-live-first-update.png"),
    fullPage: true,
  });

  await page.waitForFunction(
    (expectedRunId) =>
      document.querySelector("#run-id")?.textContent === expectedRunId &&
      document.querySelector("#run-tick")?.textContent === "11" &&
      document.querySelector("#controller-state")?.textContent === "RESOLVED",
    scenarioRunId,
    { timeout: 360_000 },
  );
  await page.screenshot({
    path: resolve(evidenceRoot, "azure-live-final-resolved.png"),
    fullPage: true,
  });

  const browserState = await page.evaluate(() => ({
    dataSource: document.querySelector("#data-source-label")?.textContent,
    scenarioRunId: document.querySelector("#run-id")?.textContent,
    tick: document.querySelector("#run-tick")?.textContent,
    snapshotVersion: document.querySelector("#snapshot-version")?.textContent,
    controllerState: document.querySelector("#controller-state")?.textContent,
  }));
  await writeFile(
    resolve(evidenceRoot, "browser-state.json"),
    `${JSON.stringify({ ...browserState, origin: pagesOrigin, capturedAtUtc: new Date().toISOString() }, null, 2)}\n`,
  );
} finally {
  await writeFile(resolve(evidenceRoot, "browser-console.log"), `${browserMessages.join("\n")}\n`);
  await page.close();
  await context.close();
  if (video) {
    const videoPath = await video.path();
    const finalVideoPath = resolve(evidenceRoot, "azure-live-browser-session.webm");
    await rename(videoPath, finalVideoPath);
    await writeFile(
      resolve(evidenceRoot, "browser-video-path.txt"),
      `${finalVideoPath}\n`,
    );
  }
  await browser.close();
}
