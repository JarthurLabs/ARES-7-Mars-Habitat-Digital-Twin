import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createBrotliDecompress } from "node:zlib";
import { extract } from "tar-fs";

const execFileAsync = promisify(execFile);

export const evidenceBrowserProfile = "rootless-serverless-chromium-149-al2023";
export const evidenceBrowserMajorVersion = 149;

// This is an allowlist, not @sparticuz/chromium's complete default argument
// list. In particular, do not add --disable-web-security or
// --allow-running-insecure-content. The live viewer must pass normal browser
// cross-origin checks for its Azure negotiate and Web PubSub connections.
export const evidenceBrowserLaunchArguments = Object.freeze([
  "--disable-dev-shm-usage",
  "--disable-setuid-sandbox",
  "--enable-unsafe-swiftshader",
  "--headless=shell",
  "--ignore-gpu-blocklist",
  "--in-process-gpu",
  "--no-sandbox",
  "--no-zygote",
  "--single-process",
  "--use-angle=swiftshader",
  "--use-gl=angle",
]);

export const requiredBundledLibraries = Object.freeze([
  "libexpat.so.1",
  "libnspr4.so",
  "libnss3.so",
  "libnssutil3.so",
  "libplc4.so",
  "libplds4.so",
]);

const forbiddenLaunchArguments = Object.freeze([
  "--allow-running-insecure-content",
  "--disable-web-security",
]);

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPathWithin(parent, candidate) {
  const normalizedParent = resolve(parent);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${sep}`)
  );
}

export function validateEvidenceBrowserLaunchArguments(
  launchArguments = evidenceBrowserLaunchArguments,
) {
  if (!Array.isArray(launchArguments) || launchArguments.length === 0) {
    throw new Error("The evidence browser launch-argument allowlist is empty");
  }
  for (const forbidden of forbiddenLaunchArguments) {
    if (
      launchArguments.some(
        (argument) => argument === forbidden || argument.startsWith(`${forbidden}=`),
      )
    ) {
      throw new Error(`Unsafe evidence browser argument is forbidden: ${forbidden}`);
    }
  }
  if (new Set(launchArguments).size !== launchArguments.length) {
    throw new Error("The evidence browser launch-argument allowlist contains a duplicate");
  }
  const reviewed = new Set(evidenceBrowserLaunchArguments);
  for (const argument of launchArguments) {
    if (!reviewed.has(argument)) {
      throw new Error(`Unreviewed evidence browser argument is forbidden: ${argument}`);
    }
  }
  if (launchArguments.length !== reviewed.size) {
    throw new Error("The evidence browser launch arguments do not exactly match the reviewed allowlist");
  }
  return [...launchArguments];
}

export function validateEvidenceBrowserDependencies(lddOutput, libraryDirectory) {
  if (typeof lddOutput !== "string" || !lddOutput.trim()) {
    throw new Error("ldd returned no Chromium dependency inventory");
  }
  if (/\bnot found\b/i.test(lddOutput)) {
    throw new Error("Chromium has an unresolved shared-library dependency");
  }

  const resolved = {};
  for (const library of requiredBundledLibraries) {
    const matcher = new RegExp(
      `^\\s*${escapeRegularExpression(library)}\\s+=>\\s+(\\S+)`,
      "m",
    );
    const match = lddOutput.match(matcher);
    if (!match?.[1] || !isPathWithin(libraryDirectory, match[1])) {
      throw new Error(
        `Chromium dependency ${library} was not resolved from the pinned rootless library bundle`,
      );
    }
    resolved[library] = match[1];
  }

  const normalizedInventory = lddOutput
    .trim()
    .replaceAll(resolve(libraryDirectory), "<bundled-library-directory>")
    .replace(/\s+\(0x[0-9a-f]+\)/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    status: "all-dependencies-resolved",
    requiredBundledLibraries: Object.keys(resolved),
    inventory: normalizedInventory,
  };
}

export function validateEvidenceBrowserVersion(version) {
  const match = String(version).match(/^(\d+)\./);
  if (!match || Number(match[1]) !== evidenceBrowserMajorVersion) {
    throw new Error(
      `Expected evidence Chromium major ${evidenceBrowserMajorVersion}; received ${String(version)}`,
    );
  }
  return String(version);
}

async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}

async function resolveEvidenceVideoEncoder() {
  const browserPathSetting = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (!browserPathSetting) {
    throw new Error(
      "PLAYWRIGHT_BROWSERS_PATH must identify the run-specific pinned FFmpeg installation",
    );
  }

  const playwrightEntry = fileURLToPath(import.meta.resolve("playwright-core-ares7"));
  const playwrightDirectory = dirname(playwrightEntry);
  const playwrightPackage = JSON.parse(
    await readFile(resolve(playwrightDirectory, "package.json"), "utf8"),
  );
  if (playwrightPackage.name !== "playwright-core" || playwrightPackage.version !== "1.61.1") {
    throw new Error("The evidence Playwright alias is not the reviewed 1.61.1 package");
  }
  const browserRevisions = JSON.parse(
    await readFile(resolve(playwrightDirectory, "browsers.json"), "utf8"),
  );
  const ffmpeg = browserRevisions.browsers?.find((browser) => browser.name === "ffmpeg");
  if (String(ffmpeg?.revision ?? "") !== "1011") {
    throw new Error("The pinned evidence Playwright package does not use FFmpeg revision 1011");
  }

  const browserCacheDirectory =
    browserPathSetting === "0"
      ? resolve(playwrightDirectory, ".local-browsers")
      : resolve(browserPathSetting);
  const encoderPath = resolve(
    browserCacheDirectory,
    `ffmpeg-${ffmpeg.revision}`,
    "ffmpeg-linux",
  );
  const encoderLstat = await lstat(encoderPath);
  const verifiedEncoderPath = await realpath(encoderPath);
  const encoderStat = await stat(verifiedEncoderPath);
  if (
    encoderLstat.isSymbolicLink() ||
    !isPathWithin(browserCacheDirectory, verifiedEncoderPath) ||
    !encoderStat.isFile() ||
    encoderStat.uid !== process.getuid() ||
    (encoderStat.mode & 0o022) !== 0 ||
    encoderStat.size !== 5_101_056 ||
    (encoderStat.mode & 0o111) === 0
  ) {
    throw new Error("The pinned Playwright FFmpeg encoder is missing or incomplete");
  }
  const encoderSha256 = await sha256(verifiedEncoderPath);
  if (encoderSha256 !== "460d44f3416005662f528d4b92e7b94ace924e8a0288106d3803b73c56eaadc8") {
    throw new Error("The pinned Playwright FFmpeg encoder digest does not match the reviewed build");
  }

  return {
    path: verifiedEncoderPath,
    metadata: {
      revision: String(ffmpeg.revision),
      bytes: encoderStat.size,
      sha256: encoderSha256,
    },
  };
}

export async function validateEvidenceWebm(videoPath, options = {}) {
  const videoLstat = await lstat(videoPath);
  const verifiedVideoPath = await realpath(videoPath);
  const videoStat = await stat(verifiedVideoPath);
  if (
    videoLstat.isSymbolicLink() ||
    !videoStat.isFile() ||
    videoStat.size < (options.minimumBytes ?? 1_000)
  ) {
    throw new Error("The evidence WebM is missing, symlinked, or unexpectedly small");
  }

  const encoder = await resolveEvidenceVideoEncoder();
  const decodeDirectory = await mkdtemp(resolve(dirname(verifiedVideoPath), ".decode."));
  const decodedFramePath = resolve(decodeDirectory, "decoded-last-frame.png");
  try {
    const result = await execFileAsync(
      encoder.path,
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-i",
        verifiedVideoPath,
        "-update",
        "1",
        "-y",
        decodedFramePath,
      ],
      {
        timeout: options.timeout ?? 180_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (String(result.stderr ?? "").trim()) {
      throw new Error(String(result.stderr).trim());
    }
    const [decodedFrame, decodedFrameStat] = await Promise.all([
      readFile(decodedFramePath),
      stat(decodedFramePath),
    ]);
    if (
      decodedFrameStat.size < (options.minimumDecodedFrameBytes ?? 512) ||
      !decodedFrame.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    ) {
      throw new Error("Pinned FFmpeg did not produce a valid decoded PNG frame");
    }
    return {
      status: "decoded-with-pinned-ffmpeg",
      videoBytes: videoStat.size,
      decodedFrameBytes: decodedFrameStat.size,
      encoder: encoder.metadata,
    };
  } catch (error) {
    const diagnostic = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `The pinned FFmpeg decoder rejected the evidence WebM${
        diagnostic ? `: ${diagnostic}` : ""
      }`,
    );
  } finally {
    await rm(decodeDirectory, { recursive: true, force: true });
  }
}

function assertSupportedRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The rootless evidence browser requires Linux x64");
  }
  if (major < 22 || (major === 22 && minor < 17) || major === 23) {
    throw new Error(
      "The rootless evidence browser requires Node.js 22.17 or newer in the 22 line, or Node.js 24 or newer",
    );
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function verifyPrivateRuntimeArtifact(path, runtimeDirectory, minimumBytes = 1) {
  const artifactLstat = await lstat(path);
  const verifiedPath = await realpath(path);
  const artifactStat = await stat(verifiedPath);
  if (
    artifactLstat.isSymbolicLink() ||
    !isPathWithin(runtimeDirectory, verifiedPath) ||
    !artifactStat.isFile() ||
    artifactStat.uid !== process.getuid() ||
    (artifactStat.mode & 0o022) !== 0 ||
    artifactStat.size < minimumBytes
  ) {
    throw new Error(`The evidence browser runtime artifact is unsafe or incomplete: ${path}`);
  }
  return { path: verifiedPath, stat: artifactStat };
}

async function verifyPrivateRuntimeTree(directory, runtimeDirectory) {
  const directoryLstat = await lstat(directory);
  const verifiedDirectory = await realpath(directory);
  if (
    directoryLstat.isSymbolicLink() ||
    !directoryLstat.isDirectory() ||
    directoryLstat.uid !== process.getuid() ||
    (directoryLstat.mode & 0o022) !== 0 ||
    !isPathWithin(runtimeDirectory, verifiedDirectory)
  ) {
    throw new Error(`The evidence browser runtime directory is unsafe: ${directory}`);
  }

  const entries = await readdir(verifiedDirectory, { withFileTypes: true });
  if (entries.length === 0) {
    throw new Error(`The evidence browser runtime directory is empty: ${directory}`);
  }
  for (const entry of entries) {
    const entryPath = resolve(verifiedDirectory, entry.name);
    if (entry.isDirectory()) {
      await verifyPrivateRuntimeTree(entryPath, runtimeDirectory);
    } else if (entry.isFile()) {
      await verifyPrivateRuntimeArtifact(entryPath, runtimeDirectory);
    } else {
      throw new Error(`The evidence browser runtime contains an unsupported entry: ${entryPath}`);
    }
  }
}

async function extractBrotliTar(source, destination) {
  await mkdir(destination, { mode: 0o700 });
  await pipeline(
    createReadStream(source),
    createBrotliDecompress(),
    extract(destination, {
      chown: false,
      strict: true,
      validateSymlinks: true,
    }),
  );
}

async function extractPinnedBrowserAssets(runtimeDirectory) {
  const chromiumEntry = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
  const chromiumPackageDirectory = resolve(dirname(chromiumEntry), "..");
  const chromiumPackage = JSON.parse(
    await readFile(resolve(chromiumPackageDirectory, "package.json"), "utf8"),
  );
  if (chromiumPackage.name !== "@sparticuz/chromium" || chromiumPackage.version !== "149.0.0") {
    throw new Error("The installed rootless Chromium package is not the reviewed 149.0.0 build");
  }
  const assets = resolve(chromiumPackageDirectory, "bin");
  const swiftShaderFiles = [
    "libEGL.so",
    "libGLESv2.so",
    "libvk_swiftshader.so",
    "libvulkan.so.1",
    "vk_swiftshader_icd.json",
  ];
  const expected = [
    resolve(runtimeDirectory, "chromium"),
    resolve(runtimeDirectory, "fonts/fonts.conf"),
    resolve(runtimeDirectory, "al2023/lib/libnspr4.so"),
    ...swiftShaderFiles.map((name) => resolve(runtimeDirectory, name)),
  ];
  const presence = await Promise.all(expected.map(pathExists));
  if (presence.every(Boolean)) return resolve(runtimeDirectory, "chromium");
  if (presence.some(Boolean)) {
    throw new Error("The run-specific rootless Chromium extraction is incomplete");
  }

  const staging = await mkdtemp(resolve(runtimeDirectory, ".extract."));
  try {
    await pipeline(
      createReadStream(resolve(assets, "chromium.br")),
      createBrotliDecompress(),
      createWriteStream(resolve(staging, "chromium"), {
        flags: "wx",
        mode: 0o700,
      }),
    );
    await extractBrotliTar(resolve(assets, "fonts.tar.br"), resolve(staging, "fonts"));
    await extractBrotliTar(
      resolve(assets, "swiftshader.tar.br"),
      resolve(staging, "swiftshader"),
    );
    await extractBrotliTar(resolve(assets, "al2023.tar.br"), resolve(staging, "al2023"));

    await rename(resolve(staging, "chromium"), resolve(runtimeDirectory, "chromium"));
    await rename(resolve(staging, "fonts"), resolve(runtimeDirectory, "fonts"));
    await rename(resolve(staging, "al2023"), resolve(runtimeDirectory, "al2023"));
    for (const name of swiftShaderFiles) {
      await rename(resolve(staging, "swiftshader", name), resolve(runtimeDirectory, name));
    }
    return resolve(runtimeDirectory, "chromium");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function prepareEvidenceBrowserRuntime(options = {}) {
  assertSupportedRuntime();
  validateEvidenceBrowserLaunchArguments();

  const systemTemporaryDirectory = await realpath(tmpdir());
  const requestedRuntimeDirectory =
    options.runtimeDirectory ?? process.env.ARES7_BROWSER_RUNTIME_DIR;
  const runtimeDirectory = requestedRuntimeDirectory
    ? resolve(requestedRuntimeDirectory)
    : await mkdtemp(resolve(systemTemporaryDirectory, "ares7-evidence-browser-149."));
  if (requestedRuntimeDirectory) {
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  }
  const runtimeLstat = await lstat(runtimeDirectory);
  const verifiedRuntimeDirectory = await realpath(runtimeDirectory);
  if (
    runtimeLstat.isSymbolicLink() ||
    !runtimeLstat.isDirectory() ||
    runtimeLstat.uid !== process.getuid() ||
    (runtimeLstat.mode & 0o077) !== 0 ||
    !isPathWithin(systemTemporaryDirectory, verifiedRuntimeDirectory)
  ) {
    throw new Error(
      "The evidence browser runtime must be an owned, private, non-symlink directory beneath the system temporary directory",
    );
  }

  // Extract with ownership changes explicitly disabled. Azure Cloud Shell is
  // rootless, and this also makes the same path deterministic in restricted
  // continuous-integration containers that reject archive chown operations.
  const executablePath = await extractPinnedBrowserAssets(verifiedRuntimeDirectory);
  const libraryDirectory = resolve(verifiedRuntimeDirectory, "al2023/lib");
  const libraryLstat = await lstat(libraryDirectory);
  const verifiedLibraryDirectory = await realpath(libraryDirectory);
  if (
    libraryLstat.isSymbolicLink() ||
    !libraryLstat.isDirectory() ||
    !isPathWithin(verifiedRuntimeDirectory, verifiedLibraryDirectory)
  ) {
    throw new Error("The evidence Chromium library directory is unsafe");
  }
  const executable = await verifyPrivateRuntimeArtifact(
    executablePath,
    verifiedRuntimeDirectory,
    100_000_000,
  );
  const verifiedExecutablePath = executable.path;

  const browserEnvironment = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TZ: process.env.TZ ?? "UTC",
    HOME: resolve(verifiedRuntimeDirectory, "home"),
    TMPDIR: verifiedRuntimeDirectory,
    FONTCONFIG_PATH: resolve(verifiedRuntimeDirectory, "fonts"),
    LD_LIBRARY_PATH: verifiedLibraryDirectory,
  };
  await mkdir(browserEnvironment.HOME, { recursive: true, mode: 0o700 });

  const executableStat = executable.stat;
  await verifyPrivateRuntimeTree(
    resolve(verifiedRuntimeDirectory, "fonts"),
    verifiedRuntimeDirectory,
  );
  await verifyPrivateRuntimeTree(
    resolve(verifiedRuntimeDirectory, "al2023"),
    verifiedRuntimeDirectory,
  );
  for (const artifact of [
    resolve(verifiedRuntimeDirectory, "fonts/fonts.conf"),
    resolve(verifiedRuntimeDirectory, "libEGL.so"),
    resolve(verifiedRuntimeDirectory, "libGLESv2.so"),
    resolve(verifiedRuntimeDirectory, "libvk_swiftshader.so"),
    resolve(verifiedRuntimeDirectory, "libvulkan.so.1"),
    resolve(verifiedRuntimeDirectory, "vk_swiftshader_icd.json"),
    ...requiredBundledLibraries.map((library) =>
      resolve(verifiedLibraryDirectory, library),
    ),
  ]) {
    await verifyPrivateRuntimeArtifact(artifact, verifiedRuntimeDirectory);
  }

  let lddResult;
  try {
    lddResult = await execFileAsync("ldd", [verifiedExecutablePath], {
      env: browserEnvironment,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const diagnostic = [error?.stdout, error?.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Could not inventory evidence Chromium shared libraries${
        diagnostic ? `: ${diagnostic}` : ""
      }`,
    );
  }
  const dependencies = validateEvidenceBrowserDependencies(
    `${lddResult.stdout ?? ""}\n${lddResult.stderr ?? ""}`,
    verifiedLibraryDirectory,
  );
  const videoEncoder = (await resolveEvidenceVideoEncoder()).metadata;

  return {
    profile: evidenceBrowserProfile,
    executablePath: verifiedExecutablePath,
    executableBytes: executableStat.size,
    executableSha256: await sha256(verifiedExecutablePath),
    launchArguments: [...evidenceBrowserLaunchArguments],
    libraryDirectory: verifiedLibraryDirectory,
    browserEnvironment,
    dependencies,
    videoEncoder,
  };
}

export async function launchEvidenceBrowser(options = {}) {
  const runtime = await prepareEvidenceBrowserRuntime(options);
  const { chromium } = await import("playwright-core-ares7");
  const browser = await chromium.launch({
    executablePath: runtime.executablePath,
    args: runtime.launchArguments,
    env: runtime.browserEnvironment,
    headless: true,
    timeout: options.timeout ?? 60_000,
  });

  try {
    const browserVersion = validateEvidenceBrowserVersion(browser.version());
    return {
      browser,
      metadata: {
        profile: runtime.profile,
        browserVersion,
        executableBytes: runtime.executableBytes,
        executableSha256: runtime.executableSha256,
        launchArguments: runtime.launchArguments,
        dependencies: runtime.dependencies,
        videoEncoder: runtime.videoEncoder,
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
