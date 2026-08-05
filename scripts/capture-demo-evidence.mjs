import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const localGraphicsArgs = executablePath
  ? [
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ]
  : [];

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local evidence server did not become ready.");
}

await mkdir("evidence/screenshots", { recursive: true });
const server = spawn(process.execPath, ["scripts/serve-dist.mjs"], { stdio: "inherit" });

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, executablePath, args: localGraphicsArgs });
  try {
    const desktop = await browser.newPage({
      viewport: { width: 1600, height: 900 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await desktop.goto(origin);
    await desktop.getByText("LOCAL REPLAY", { exact: true }).waitFor();
    await desktop.getByRole("button", { name: /Power Control PWR-01/ }).click();
    await desktop.getByRole("dialog", { name: "Power Control" }).waitFor();
    await desktop.screenshot({ path: "evidence/screenshots/ares7-public-demo-desktop-20260805.png" });
    await desktop.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
      reducedMotion: "reduce",
      isMobile: true,
      hasTouch: true,
    });
    await mobile.goto(origin, { waitUntil: "domcontentloaded" });
    await mobile.getByText("LOCAL REPLAY", { exact: true }).waitFor();
    await mobile.screenshot({ path: "evidence/screenshots/ares7-public-demo-mobile-20260805.png" });
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

console.log("Captured genuine desktop and mobile static-replay evidence.");
