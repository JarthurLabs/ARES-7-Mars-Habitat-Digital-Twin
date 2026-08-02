import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"));

const signatures = [
  ["private key", new RegExp("-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE" + " KEY-----")],
  ["GitHub token", new RegExp("gh" + "p_[A-Za-z0-9]{30,}")],
  ["GitHub fine-grained token", new RegExp("github" + "_pat_[A-Za-z0-9_]{40,}")],
  ["Azure storage key", new RegExp("Account" + "Key=[A-Za-z0-9+/=]{20,}")],
];

const findings = [];
for (const file of files) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of signatures) {
    if (pattern.test(contents)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length) {
  console.error(`possible secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`secret pattern check passed across ${files.length} text candidates`);
