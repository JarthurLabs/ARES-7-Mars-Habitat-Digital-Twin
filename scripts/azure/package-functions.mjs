import { mkdirSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { handleFailure, repositoryRoot, run } from "./common.mjs";

try {
  const artifact = resolve(
    repositoryRoot,
    process.env.ARES7_FUNCTION_ARTIFACT ?? "artifacts/released-package.zip",
  );
  const relativeArtifact = relative(repositoryRoot, artifact);
  if (relativeArtifact.startsWith("..") || relativeArtifact === "")
    throw new Error("function artifact must stay inside the repository");
  run("npm", ["--prefix", "functions", "ci"]);
  run("npm", ["--prefix", "functions", "test"]);
  run("npm", ["--prefix", "functions", "run", "build"]);
  run("npm", ["--prefix", "functions", "prune", "--omit=dev"]);
  mkdirSync(resolve(artifact, ".."), { recursive: true });
  rmSync(artifact, { force: true });
  run(
    "zip",
    [
      "-q",
      "-r",
      artifact,
      "dist",
      "host.json",
      "package.json",
      "package-lock.json",
      "node_modules",
    ],
    {
      cwd: resolve(repositoryRoot, "functions"),
    },
  );
  const entries = run("unzip", ["-Z1", artifact], { capture: true });
  for (const required of ["host.json", "package.json", "dist/index.js"]) {
    if (!entries.split("\n").includes(required)) {
      throw new Error(`packaged archive is missing ${required}`);
    }
  }
  console.log(`packaged ${artifact}`);
} catch (error) {
  handleFailure(error);
}
