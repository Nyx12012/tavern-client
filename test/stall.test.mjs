import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandTimeoutError } from "../dist/index.js";
import { NO_FAKE, client, count, logs, pollUntil, sleep, startServer, waitFor } from "./helpers.mjs";

async function withClient(fn, extra) {
  const server = startServer();
  const port = await server.listening;
  const c = client(port, extra);
  try {
    await c.connect();
    await fn(c, server, port);
  } finally {
    c.close();
    server.stop();
  }
}

test("a late reply is matched on its commandId", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  await c.command("__stall 1000");
  const late = waitFor(c, "late", 5000);
  await assert.rejects(() => c.command("player list", 200), (e) => {
    assert.ok(e instanceof CommandTimeoutError);
    assert.equal(e.command, "player list");
    assert.match(e.message, /^command timed out after 0\.2s: player list\. The server may still run it later\.$/);
    return true;
  });
  const [command, result] = await late;
  assert.equal(command, "player list");
  assert.deepEqual(result.result, [{ id: 1, username: "Tester" }]);
  assert.deepEqual((await c.command("player list")).result, [{ id: 1, username: "Tester" }]);
}));

test("a subscribe answered late counts and is not sent again for 10 minutes", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  const events = [];
  c.on("event", (ev) => events.push(ev));
  await c.command("__stall 1500");
  await assert.rejects(() => c.subscribe("PlayerKilled"), CommandTimeoutError);
  await sleep(2000);
  assert.equal(await count(c, "websocket subscribe PlayerKilled"), 1);
  await c.command("__emit PlayerKilled {}");
  await pollUntil(() => events.length === 1, 3000, "the event");
  await sleep(600);
  assert.equal(await count(c, "websocket subscribe PlayerKilled"), 1);
}, { commandTimeoutMs: 300, resubscribeDelaysMs: [500, 900], retrySubscribeMs: 200 }));

test("a subscribe still waiting is sent again once the resend window passes", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  await c.command("__stall 1500");
  await assert.rejects(() => c.subscribe("PlayerKilled"), CommandTimeoutError);
  await sleep(2200);
  assert.ok(await count(c, "websocket subscribe PlayerKilled") >= 2);
}, { commandTimeoutMs: 300, retrySubscribeMs: 200, resendUnansweredMs: 400 }));

test("a stall logs one line when it starts and one when replies come back", { skip: NO_FAKE, timeout: 20000 }, async () => {
  const log = logs();
  await withClient(async (c) => {
    await c.command("__stall 1000");
    const tries = ["player list", "a", "b"].map((t) => assert.rejects(() => c.command(t, 200), CommandTimeoutError));
    await Promise.all(tries);
    await assert.rejects(() => c.command("c", 200), CommandTimeoutError);
    assert.equal(log.count("warn", /^No answer from 127\.0\.0\.1:\d+ in 0\.2s\. A server that just started/), 1);
    await pollUntil(() => log.count("info", /is answering commands again, after \d+s\.$/) === 1, 5000, "the second line");
    await sleep(300);
    assert.equal(log.count("warn", /No answer/), 1);
    assert.equal(log.count("info", /answering commands again/), 1);
  }, { log });
});

test("after a restart: Command not found, then a stall, then every reply in order", { skip: NO_FAKE, timeout: 40000 }, async () => {
  let server = startServer();
  const port = await server.listening;
  const c = client(port, { maxBackoffMs: 500 });
  const late = [];
  const events = [];
  c.on("late", (command) => late.push(command));
  c.on("event", (ev) => events.push(ev));
  try {
    await c.connect();
    await c.subscribe("PlayerKilled");
    const closed = waitFor(c, "close", 5000);
    server.stop();
    await closed;
    server = startServer(port);
    await server.listening;
    await waitFor(c, "ready", 15000, "reconnect");
    await pollUntil(async () => (await c.command("websocket subscriptions")).result.includes("PlayerKilled"), 5000, "resubscribed");

    await c.command("__warmup 400");
    assert.match((await c.command("player list")).error, /Command not found/);
    await sleep(500);

    await c.command("__stall 1200");
    for (const t of ["one", "two", "three"]) await assert.rejects(() => c.command(t, 150), CommandTimeoutError);
    await c.command("__emit PlayerKilled {}");
    await pollUntil(() => events.length === 1, 1000, "an event during the stall");
    assert.deepEqual(late, []);
    await pollUntil(() => late.length === 3, 5000, "the late replies");
    assert.deepEqual(late, ["one", "two", "three"]);
    assert.deepEqual(await c.players(), [{ id: 1, username: "Tester" }]);
  } finally {
    c.close();
    server.stop();
  }
});
