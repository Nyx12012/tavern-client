import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_EVENT_TYPES } from "../dist/index.js";

test("the catalog holds the 23 events the console lists", () => {
  assert.equal(CONSOLE_EVENT_TYPES.length, 23);
  assert.equal(new Set(CONSOLE_EVENT_TYPES).size, 23);
  for (const name of ["ProfilingData", "PlayerJoined", "PlayerLeft", "PlayerStateChanged", "CommandExecuted", "InfoLog", "FatalLog"]) {
    assert.ok(CONSOLE_EVENT_TYPES.includes(name), name);
  }
});
