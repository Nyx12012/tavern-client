import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TavernClient } from "../dist/index.js";

const candidate = process.env.TAVERN_FAKE_CONSOLE
  || fileURLToPath(new URL("../../../tooling/tavern-fake-console/server.mjs", import.meta.url));
export const FAKE = existsSync(candidate) ? candidate : null;
export const NO_FAKE = FAKE ? false : "no fake console: set TAVERN_FAKE_CONSOLE to its server.mjs";

export function startServer(port = 0, args = []) {
  const child = spawn(process.execPath, [FAKE, "--port", String(port), ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TAVERN_FAKE_REFUSAL: "" },
  });
  let out = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fake console never came up:\n${out}`)), 10000);
    child.stdout.on("data", (d) => {
      out += d;
      const m = /listening on [\d.]+:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fake console exited ${code}:\n${out}`));
    });
  });
  return { child, listening, stop: () => child.kill() };
}

export function logs() {
  const lines = [];
  const log = (level, message) => lines.push({ level, message });
  log.lines = lines;
  log.count = (level, pattern) => lines.filter((l) => l.level === level && pattern.test(l.message)).length;
  return log;
}

export function client(port, extra = {}) {
  const c = new TavernClient({ host: "127.0.0.1", port, token: "ok", log: () => {}, ...extra });
  c.on("error", () => {});
  return c;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const waitFor = (emitter, event, ms, what = `"${event}"`) => new Promise((resolve, reject) => {
  const on = (...args) => {
    clearTimeout(timer);
    resolve(args);
  };
  const timer = setTimeout(() => {
    emitter.off(event, on);
    reject(new Error(`timed out waiting for ${what} after ${ms}ms`));
  }, ms);
  emitter.once(event, on);
});

export async function pollUntil(cond, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} after ${ms}ms`);
    await sleep(50);
  }
}

export async function count(c, command) {
  return (await c.command(`__count ${command}`)).result;
}
