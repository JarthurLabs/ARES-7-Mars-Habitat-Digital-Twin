import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evidenceBrowserLaunchArguments,
  requiredBundledLibraries,
  validateEvidenceBrowserDependencies,
  validateEvidenceBrowserLaunchArguments,
  validateEvidenceBrowserVersion,
} from "./evidence-browser-runtime.mjs";

const bundledLibraryDirectory = "/tmp/ares7-private-browser/al2023/lib";
const resolvedInventory = [
  "linux-vdso.so.1 (0x00007fff00000000)",
  "libdl.so.2 => /lib64/libdl.so.2 (0x00007fff00000001)",
  ...requiredBundledLibraries.map(
    (library, index) =>
      `${library} => ${bundledLibraryDirectory}/${library} (0x${String(index + 2).padStart(16, "0")})`,
  ),
  "/lib64/ld-linux-x86-64.so.2 (0x00007fff00000009)",
].join("\n");

test("uses the exact rootless AL2023 browser library set", () => {
  assert.deepEqual(requiredBundledLibraries, [
    "libexpat.so.1",
    "libnspr4.so",
    "libnss3.so",
    "libnssutil3.so",
    "libplc4.so",
    "libplds4.so",
  ]);
  const result = validateEvidenceBrowserDependencies(
    resolvedInventory,
    bundledLibraryDirectory,
  );
  assert.equal(result.status, "all-dependencies-resolved");
  assert.deepEqual(result.requiredBundledLibraries, [...requiredBundledLibraries]);
  assert.match(result.inventory.join("\n"), /<bundled-library-directory>\/libnspr4\.so/);
  assert.doesNotMatch(result.inventory.join("\n"), /0x[0-9a-f]+/i);
});

test("fails closed when ldd reports any unresolved dependency", () => {
  const missing = resolvedInventory.replace(
    `${bundledLibraryDirectory}/libnspr4.so`,
    "not found",
  );
  assert.throws(
    () => validateEvidenceBrowserDependencies(missing, bundledLibraryDirectory),
    /unresolved shared-library dependency/,
  );
});

test("fails closed when a required library resolves outside the pinned bundle", () => {
  const systemResolved = resolvedInventory.replace(
    `${bundledLibraryDirectory}/libnss3.so`,
    "/usr/lib64/libnss3.so",
  );
  assert.throws(
    () => validateEvidenceBrowserDependencies(systemResolved, bundledLibraryDirectory),
    /libnss3\.so was not resolved from the pinned rootless library bundle/,
  );
});

test("keeps the evidence launch allowlist compatible and browser security enabled", () => {
  assert.deepEqual(
    validateEvidenceBrowserLaunchArguments(),
    evidenceBrowserLaunchArguments,
  );
  assert.ok(evidenceBrowserLaunchArguments.includes("--enable-unsafe-swiftshader"));
  assert.ok(evidenceBrowserLaunchArguments.includes("--no-sandbox"));
  assert.ok(!evidenceBrowserLaunchArguments.includes("--disable-web-security"));
  assert.ok(!evidenceBrowserLaunchArguments.includes("--allow-running-insecure-content"));
  assert.throws(
    () =>
      validateEvidenceBrowserLaunchArguments([
        ...evidenceBrowserLaunchArguments,
        "--disable-web-security",
      ]),
    /Unsafe evidence browser argument is forbidden/,
  );
  assert.throws(
    () =>
      validateEvidenceBrowserLaunchArguments([
        ...evidenceBrowserLaunchArguments,
        "--disable-web-security=true",
      ]),
    /Unsafe evidence browser argument is forbidden/,
  );
  assert.throws(
    () =>
      validateEvidenceBrowserLaunchArguments([
        ...evidenceBrowserLaunchArguments,
        "--remote-debugging-port=9222",
      ]),
    /Unreviewed evidence browser argument is forbidden/,
  );
  assert.throws(
    () =>
      validateEvidenceBrowserLaunchArguments([
        ...evidenceBrowserLaunchArguments,
        "--no-sandbox",
      ]),
    /contains a duplicate/,
  );
  assert.throws(
    () => validateEvidenceBrowserLaunchArguments(evidenceBrowserLaunchArguments.slice(1)),
    /do not exactly match the reviewed allowlist/,
  );
});

test("requires the Chromium major aligned to the aliased Playwright core", () => {
  assert.equal(validateEvidenceBrowserVersion("149.0.7827.0"), "149.0.7827.0");
  assert.throws(() => validateEvidenceBrowserVersion("151.0.7922.34"), /major 149/);
});

test("the live capture and lock use only the exact audited browser packages", async () => {
  const [captureSource, packageSource, packageLockSource] = await Promise.all([
    readFile(new URL("../capture-live-browser-evidence.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(packageLockSource);
  assert.match(captureSource, /launchEvidenceBrowser/);
  assert.match(captureSource, /validateEvidenceWebm/);
  assert.doesNotMatch(captureSource, /from ["']@playwright\/test["']/);
  assert.equal(packageJson.devDependencies["@sparticuz/chromium"], "149.0.0");
  assert.equal(
    packageJson.devDependencies["playwright-core-ares7"],
    "npm:playwright-core@1.61.1",
  );
  assert.equal(packageJson.devDependencies["tar-fs"], "3.1.3");
  assert.equal(packageJson.devDependencies["@playwright/test"], "1.62.1");
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/@sparticuz/chromium"].version,
      resolved: packageLock.packages["node_modules/@sparticuz/chromium"].resolved,
      integrity: packageLock.packages["node_modules/@sparticuz/chromium"].integrity,
    },
    {
      version: "149.0.0",
      resolved:
        "https://registry.npmjs.org/@sparticuz/chromium/-/chromium-149.0.0.tgz",
      integrity:
        "sha512-2NECBVKlUA9xIUXb4fT8OoGKdAJs+I2tNYscO8FwcxCKCWA7FmpPI0fdVxGJoIJglrFZYn+4YEJqChq4rdrxQg==",
    },
  );
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/playwright-core-ares7"].version,
      resolved: packageLock.packages["node_modules/playwright-core-ares7"].resolved,
      integrity: packageLock.packages["node_modules/playwright-core-ares7"].integrity,
    },
    {
      version: "1.61.1",
      resolved: "https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.1.tgz",
      integrity:
        "sha512-h7Qlt6m4REp25qvIdvbDtVmD4LqVXfpRxhORv9L0jzETM05p4fuPJ3dKyuSXQxDSbXnmS79HAgi9589lGSpLkg==",
    },
  );
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/tar-fs"].version,
      resolved: packageLock.packages["node_modules/tar-fs"].resolved,
      integrity: packageLock.packages["node_modules/tar-fs"].integrity,
    },
    {
      version: "3.1.3",
      resolved: "https://registry.npmjs.org/tar-fs/-/tar-fs-3.1.3.tgz",
      integrity:
        "sha512-/hU4AXnIdZu+Gvl1pk0oI5f5HxWsCJRtY2aFaJdk9VvyL48DWU6iU5WAIPG+wIi1YvWA6eTJvIviP/tMAZZNwQ==",
    },
  );
});

test("the standalone preflight is lock-bound to the same audited runtime", async () => {
  const [packageSource, packageLockSource] = await Promise.all([
    readFile(new URL("./browser-preflight/package.json", import.meta.url), "utf8"),
    readFile(new URL("./browser-preflight/package-lock.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(packageLockSource);
  const expectedDependencies = {
    "@sparticuz/chromium": "149.0.0",
    "playwright-core-ares7": "npm:playwright-core@1.61.1",
    "tar-fs": "3.1.3",
  };
  assert.deepEqual(packageJson.dependencies, expectedDependencies);
  assert.deepEqual(packageLock.packages[""].dependencies, expectedDependencies);
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/@sparticuz/chromium"].version,
      resolved: packageLock.packages["node_modules/@sparticuz/chromium"].resolved,
      integrity: packageLock.packages["node_modules/@sparticuz/chromium"].integrity,
    },
    {
      version: "149.0.0",
      resolved:
        "https://registry.npmjs.org/@sparticuz/chromium/-/chromium-149.0.0.tgz",
      integrity:
        "sha512-2NECBVKlUA9xIUXb4fT8OoGKdAJs+I2tNYscO8FwcxCKCWA7FmpPI0fdVxGJoIJglrFZYn+4YEJqChq4rdrxQg==",
    },
  );
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/playwright-core-ares7"].version,
      resolved: packageLock.packages["node_modules/playwright-core-ares7"].resolved,
      integrity: packageLock.packages["node_modules/playwright-core-ares7"].integrity,
    },
    {
      version: "1.61.1",
      resolved: "https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.1.tgz",
      integrity:
        "sha512-h7Qlt6m4REp25qvIdvbDtVmD4LqVXfpRxhORv9L0jzETM05p4fuPJ3dKyuSXQxDSbXnmS79HAgi9589lGSpLkg==",
    },
  );
  assert.deepEqual(
    {
      version: packageLock.packages["node_modules/tar-fs"].version,
      resolved: packageLock.packages["node_modules/tar-fs"].resolved,
      integrity: packageLock.packages["node_modules/tar-fs"].integrity,
    },
    {
      version: "3.1.3",
      resolved: "https://registry.npmjs.org/tar-fs/-/tar-fs-3.1.3.tgz",
      integrity:
        "sha512-/hU4AXnIdZu+Gvl1pk0oI5f5HxWsCJRtY2aFaJdk9VvyL48DWU6iU5WAIPG+wIi1YvWA6eTJvIviP/tMAZZNwQ==",
    },
  );
});
