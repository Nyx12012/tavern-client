import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenRefusedError } from "../dist/index.js";
import { NO_FAKE, client, startServer, waitFor } from "./helpers.mjs";

test("silence after the token reads as refused", { skip: NO_FAKE, timeout: 20000 }, async () => {
  const server = startServer();
  const port = await server.listening;
  const c = client(port, { token: "BADTOKEN", authTimeoutMs: 500 });
  const rejected = [];
  c.on("rejected", (why) => rejected.push(why));
  try {
    const started = Date.now();
    await assert.rejects(() => c.connect(), (e) => {
      assert.ok(e instanceof TokenRefusedError);
      assert.match(e.message, /did not accept the token within 0\.5s\. A wrong token gets no answer/);
      return true;
    });
    assert.ok(Date.now() - started < 3000, "refused well before the 30 s connect deadline");
    assert.equal(rejected.length, 1);
    assert.equal(c.connected, false);
  } finally {
    c.close();
    server.stop();
  }
});

test("a spoken refusal reads as refused at once", { skip: NO_FAKE, timeout: 20000 }, async () => {
  const server = startServer(0, ["--refusal", "spoken"]);
  const port = await server.listening;
  const c = client(port, { token: "BADTOKEN", authTimeoutMs: 8000 });
  try {
    const started = Date.now();
    await assert.rejects(() => c.connect(), (e) => e instanceof TokenRefusedError && /rejected the token \(Invalid Token\)/.test(e.message));
    assert.ok(Date.now() - started < 3000);
  } finally {
    c.close();
    server.stop();
  }
});

test("a refusal after the first login is reported and retried", { skip: NO_FAKE, timeout: 30000 }, async () => {
  const server = startServer();
  const port = await server.listening;
  const tokens = ["ok", "BADTOKEN", "ok"];
  const c = client(port, { token: () => tokens.shift() ?? "ok", authTimeoutMs: 300, maxBackoffMs: 300 });
  try {
    await c.connect();
    const rejected = waitFor(c, "rejected", 10000);
    const back = waitFor(c, "ready", 15000, "ready again");
    await assert.rejects(() => c.command("__drop"), /disconnected/);
    const [why] = await rejected;
    assert.match(why, /did not accept the token/);
    await back;
    assert.equal(c.connected, true);
  } finally {
    c.close();
    server.stop();
  }
});
