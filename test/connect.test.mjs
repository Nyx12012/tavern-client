import { test } from "node:test";
import assert from "node:assert/strict";
import { NotConnectedError } from "../dist/index.js";
import { NO_FAKE, client, pollUntil, startServer, waitFor } from "./helpers.mjs";

const JOIN = { user: { id: 1000000000, username: "ShadowOS_" }, mode: "OpenVR", position: { x: 1, y: 2, z: 3 } };

test("connect, command, PlayerJoined and PlayerLeft, restart, resubscribe", { skip: NO_FAKE, timeout: 60000 }, async () => {
  let server = startServer();
  const port = await server.listening;
  const c = client(port, { maxBackoffMs: 1000 });
  const events = [];
  c.on("event", (ev) => events.push(ev));
  try {
    await c.connect();
    assert.equal(c.connected, true);
    assert.deepEqual(await c.players(), [{ id: 1, username: "Tester" }]);

    assert.equal(await c.subscribe("PlayerJoined"), "Success");
    assert.equal(await c.subscribe("PlayerLeft"), "Success");
    await c.command(`__emit PlayerJoined ${JSON.stringify(JOIN)}`);
    await c.command(`__emit PlayerLeft ${JSON.stringify(JOIN)}`);
    await pollUntil(() => events.length >= 2, 5000, "join and leave");
    assert.deepEqual(events.map((e) => e.type), ["PlayerJoined", "PlayerLeft"]);
    assert.deepEqual(events[0].data, JOIN);
    assert.ok(events[0].timeStamp);

    const closed = waitFor(c, "close", 10000);
    server.stop();
    await closed;
    assert.equal(c.connected, false);

    server = startServer(port);
    await server.listening;
    await waitFor(c, "ready", 30000, "reconnect");
    await pollUntil(async () => {
      const subs = await c.command("websocket subscriptions");
      return Array.isArray(subs.result) && subs.result.includes("PlayerJoined") && subs.result.includes("PlayerLeft");
    }, 10000, "both subscriptions on the new connection");
    events.length = 0;
    await c.command(`__emit PlayerJoined ${JSON.stringify(JOIN)}`);
    await pollUntil(() => events.length >= 1, 5000, "the join after the restart");
    assert.deepEqual(events[0].data, JOIN);
  } finally {
    c.close();
    server.stop();
  }
});

test("a token provider is asked again on every connection", { skip: NO_FAKE, timeout: 30000 }, async () => {
  const server = startServer();
  const port = await server.listening;
  let asked = 0;
  const c = client(port, { token: async () => { asked++; return "ok"; }, maxBackoffMs: 500 });
  try {
    await c.connect();
    assert.equal(asked, 1);
    const closed = waitFor(c, "close", 5000);
    const back = waitFor(c, "ready", 15000, "reconnect");
    await assert.rejects(() => c.command("__drop"), /disconnected/);
    await closed;
    await back;
    assert.equal(asked, 2);
  } finally {
    c.close();
    server.stop();
  }
});

test("a dropped connection reconnects and resubscribes", { skip: NO_FAKE, timeout: 30000 }, async () => {
  const server = startServer();
  const port = await server.listening;
  const c = client(port, { maxBackoffMs: 500 });
  const events = [];
  c.on("event", (ev) => events.push(ev));
  try {
    await c.connect();
    await c.subscribe("PlayerKilled");
    const back = waitFor(c, "ready", 15000, "reconnect");
    await assert.rejects(() => c.command("__drop"), /disconnected/);
    await back;
    await pollUntil(async () => (await c.command("websocket subscriptions")).result.includes("PlayerKilled"), 5000, "resubscribed");
    await c.command('__emit PlayerKilled {"back":true}');
    await pollUntil(() => events.some((e) => e.data?.back === true), 5000, "the event after the drop");
  } finally {
    c.close();
    server.stop();
  }
});

test("close() stops for good", { skip: NO_FAKE, timeout: 20000 }, async () => {
  const server = startServer();
  const port = await server.listening;
  const c = client(port);
  try {
    await c.connect();
    const pending = c.command("__noreply", 5000);
    c.close();
    await assert.rejects(pending, /disconnected/);
    assert.equal(c.connected, false);
    await assert.rejects(() => c.command("player list"), NotConnectedError);
    assert.equal(await c.subscribe("PlayerKilled"), "Queued");
    await assert.rejects(() => c.subscribe("*"), /no wildcard/);
  } finally {
    server.stop();
  }
});
