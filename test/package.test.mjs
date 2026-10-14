import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the version matches the top of the changelog", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(/^## (\S+)/m.exec(changelog)?.[1], pkg.version);
});

test("the package is ready for npm", () => {
  assert.equal(pkg.name, "tavern-client");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, undefined);
  assert.match(pkg.repository?.url ?? "", /github\.com\/Nyx12012\/tavern-client/);
  assert.ok(existsSync(new URL("../LICENSE", import.meta.url)));
});

test("npm pack ships the build, the readme, the changelog and the licence only", () => {
  const [packed] = JSON.parse(execSync("npm pack --dry-run --json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString());
  const names = packed.files.map((f) => f.path).sort();
  assert.ok(names.includes("dist/index.js"));
  assert.ok(names.includes("dist/index.d.ts"));
  for (const name of names) assert.match(name, /^(dist\/[\w.]+\.(js|d\.ts)|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/);
});
