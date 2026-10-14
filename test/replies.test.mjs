import { test } from "node:test";
import assert from "node:assert/strict";
import { frameType, rosterFrom, subscribeOutcome, toCommandResult } from "../dist/reply.js";
import { NO_FAKE, client, count, startServer } from "./helpers.mjs";

const NOT_FOUND = "[CommandService.Handle] Command not found";
const LIST_TYPE = "System.Collections.Generic.List`1[System.Object]";

async function withClient(fn, extra) {
  const server = startServer();
  const port = await server.listening;
  const c = client(port, extra);
  try {
    await c.connect();
    await fn(c);
  } finally {
    c.close();
    server.stop();
  }
}

test("a refused command keeps Exception apart from Result and ResultString", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  await c.command("__warmup 5000");
  const r = await c.command("player list");
  assert.equal(r.error, NOT_FOUND);
  assert.equal(r.result, null);
  assert.equal(r.resultString, "");
  await assert.rejects(() => c.players(), new RegExp(NOT_FOUND.replace(/[[\].]/g, "\\$&")));
  assert.equal(c.connected, true);
}));

test("subscribe answers Success, Unchanged and NotFound", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  assert.equal(await c.subscribe("PlayerKilled"), "Success");
  assert.equal(await c.subscribe("PlayerKilled"), "Unchanged");
  assert.equal(await c.subscribe("NopeEvent"), "NotFound");
  assert.equal(await c.unsubscribe("PlayerKilled"), "Success");
  assert.equal(await c.unsubscribe("PlayerKilled"), "Unchanged");
  assert.deepEqual(c.subscriptions, ["NopeEvent"]);
}));

test("an empty roster is [] beside a .NET type name", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  await c.command("__roster []");
  const r = await c.command("player list");
  assert.deepEqual(r.result, []);
  assert.equal(r.resultString, LIST_TYPE);
  assert.equal(r.error, undefined);
  assert.deepEqual(await c.players(), []);
  await c.command('__roster [{"id":1000000000,"username":"ShadowOS_"}]');
  assert.deepEqual(await c.players(), [{ id: 1000000000, username: "ShadowOS_" }]);
}));

test("both failure shapes read as failures", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  assert.equal((await c.command("__fail boom")).error, "boom");
  assert.equal((await c.command("__failstr kaput")).error, "System.Exception: kaput");
  assert.equal((await c.command("player list")).error, undefined);
}));

test("message() quotes the name and cleans the text", { skip: NO_FAKE, timeout: 20000 }, () => withClient(async (c) => {
  await c.message("Bob Smith", 'say "hi" \\ back\nnow');
  assert.equal(await count(c, 'player message "Bob Smith" "say hi  backnow"'), 1);
  await assert.rejects(() => c.message("bad;name", "hi"), /unsafe player name/);
  await assert.rejects(() => c.message("Bob", " \n\t"), /empty message text/);
}));

test("the reply readers match the real wire", () => {
  assert.equal(frameType(0), "SystemMessage");
  assert.equal(frameType(1), "Subscription");
  assert.equal(frameType(2), "CommandResult");
  assert.equal(frameType("CommandResult"), "CommandResult");

  const refused = toCommandResult({ Exception: { ClassName: "System.Exception", Message: NOT_FOUND, Data: null } });
  assert.deepEqual(refused, { resultString: "", result: null, error: NOT_FOUND });

  const subscribed = toCommandResult({ Result: "Success", ResultString: "Success", Command: {} });
  assert.equal(subscribeOutcome(subscribed), "Success");
  assert.equal(subscribeOutcome({ resultString: "", result: 1 }), "Unchanged");
  assert.equal(subscribeOutcome({ resultString: "", result: 2 }), "NotFound");
  assert.equal(subscribeOutcome({ resultString: "", result: null, error: "x" }), "error: x");

  assert.deepEqual(rosterFrom([{ Identifier: 7, Username: "Alice" }, { username: "" }, null]), [{ id: 7, username: "Alice" }]);
  assert.equal(rosterFrom(null), null);
});
