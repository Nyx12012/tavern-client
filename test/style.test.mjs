import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set([".git", "node_modules", "dist", "build"]);
const CODE = new Set([".ts", ".mjs", ".js"]);
const TEXT = new Set([".ts", ".mjs", ".js", ".json", ".md", ""]);
const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const CREDIT = ["claude", "anthropic", "co-authored"];

function files(dir = ROOT) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name === "package-lock.json") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out;
}

function comments(path) {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found = new Set();
  const visit = (node) => {
    for (const r of [...(ts.getLeadingCommentRanges(text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]) {
      found.add(`${relative(ROOT, path)}:${source.getLineAndCharacterOfPosition(r.pos).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  visit(source.endOfFileToken);
  return [...found];
}

test("no comments or doc comments in code", () => {
  const found = files().filter((p) => CODE.has(extname(p))).flatMap(comments);
  assert.deepEqual(found, []);
});

test("no long dashes anywhere", () => {
  const found = files().filter((p) => TEXT.has(extname(p))).filter((p) => DASHES.some((d) => readFileSync(p, "utf8").includes(d)));
  assert.deepEqual(found.map((p) => relative(ROOT, p)), []);
});

test("no assistant credit anywhere", () => {
  const found = [];
  for (const p of files().filter((f) => TEXT.has(extname(f)) && basename(f) !== "style.test.mjs")) {
    const text = readFileSync(p, "utf8").toLowerCase();
    for (const word of CREDIT) if (text.includes(word)) found.push(`${relative(ROOT, p)}:${word}`);
  }
  assert.deepEqual(found, []);
});
