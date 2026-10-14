import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NO_FAKE, client, pollUntil, startServer } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const JOIN = { user: { id: 1000000000, username: "ShadowOS_" }, mode: "OpenVR", position: {} };

function buildExamples() {
  execFileSync(process.execPath, [TSC, "-p", "tsconfig.examples.json"], { cwd: ROOT, stdio: "pipe" });
}

test("the examples compile against the built package", () => {
  buildExamples();
});

test("the welcome example waits after PlayerJoined before it greets", { skip: NO_FAKE, timeout: 30000 }, async () => {
  buildExamples();
  const server = startServer();
  const port = await server.listening;
  const bot = spawn(process.execPath, ["build/examples/welcome.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TAVERN_HOST: "127.0.0.1", TAVERN_PORT: String(port), TAVERN_TOKEN: "ok", TAVERN_WELCOME_DELAY: "0.6" },
  });
  const out = [];
  bot.stdout.on("data", (d) => {
    for (const line of String(d).split(/\r?\n/)) if (line) out.push({ at: Date.now(), line });
  });
  bot.stderr.on("data", (d) => out.push({ at: Date.now(), line: String(d) }));
  const driver = client(port);
  try {
    await pollUntil(() => out.some((o) => o.line === "waiting for players"), 10000, "the bot to start");
    await driver.connect();
    await driver.command(`__emit PlayerJoined ${JSON.stringify(JOIN)}`);
    await pollUntil(() => out.some((o) => o.line === "welcomed ShadowOS_"), 5000, "the welcome");
    const joined = out.find((o) => o.line === "ShadowOS_ joined, welcome in 0.6s");
    const welcomed = out.find((o) => o.line === "welcomed ShadowOS_");
    assert.ok(joined, JSON.stringify(out));
    assert.ok(welcomed.at - joined.at >= 550, `greeted ${welcomed.at - joined.at} ms after the join`);
  } finally {
    driver.close();
    bot.kill();
    server.stop();
  }
});
