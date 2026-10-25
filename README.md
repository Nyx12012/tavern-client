# tavern-client

A typed Node client for the TavernLib console of a self-hosted *A Township Tale* server
(the WebSocket console on port 1760). It handles the login, matching replies to commands,
event subscriptions, keepalive and reconnects, so a bot is `connect`, `command`, `on("event")`.

```
npm install tavern-client
```

Node 18 or later. Works with `import` and `require`.

## Quick start

```ts
import { TavernClient, readToken } from "tavern-client";

const tavern = new TavernClient({
  host: "127.0.0.1",
  token: readToken("C:/path/to/console_token.txt"),
});

tavern.on("event", (ev) => console.log(ev.type, ev.data));

await tavern.connect();
await tavern.subscribe("PlayerJoined");
await tavern.subscribe("PlayerLeft");

console.log(await tavern.players());
await tavern.message("SomePlayer", "Hello from the console");
```

`examples/cli.ts` tails events; `examples/welcome.ts` greets players as they join.

## The token

The server writes its console token to `%APPDATA%\TheModdingTavern\console_token.txt` the
first time it starts. `readToken()` reads that file (or the path you give it). The token
never expires and has full power over the server, and the console is plain `ws://`, so only
connect over a network you trust: the same machine, a VPN, or an SSH tunnel.

`token` can also be a function, called on every connection attempt, if you want to read the
file again after the server owner replaces it.

## Commands

`command(text)` resolves with `{ result, resultString, error }`. The console keeps these
apart: `result` is the value, `resultString` is often just a .NET type name (an empty
`player list` is `[]` with ``System.Collections.Generic.List`1[System.Object]``), and `error`
is set when the server refused or failed the command, for example
`[CommandService.Handle] Command not found`. A failed command still resolves; check `error`.

A command with no answer rejects with `CommandTimeoutError` after `commandTimeoutMs`
(30 s). The server may still run it later (see the restart section), so do not blindly send
it again. If the answer does come, the client emits `late` with the command and its result.

`players()` returns `{ id, username }` entries. `message(player, text)` sends a HUD message;
quotes, backslashes and control characters are dropped from the text, and names may hold
letters, digits, spaces, `_`, `.` and `-`.

## Events

`subscribe(type)` uses the console's own `websocket subscribe` and answers `Success`,
`Unchanged` (already subscribed) or `NotFound` (no such event). Subscriptions are kept and
sent again after every reconnect. Subscribing while disconnected answers `Queued`.

The console lists 23 event types, exported as `CONSOLE_EVENT_TYPES`:

`PlayerJoined` `PlayerLeft` `PlayerStateChanged` `PlayerKilled` `PlayerMovedChunk`
`ObjectKilled` `InventoryChanged` `CommandExecuted` `ServerSettingsChanged`
`PopulationModified` `AtmBalanceChanged` `TradeDeckUsed` `TrialStarted` `TrialFinished`
`SocialTabletPlayerBanned` `SocialTabletPlayerReported` `ProfilingData`
`TraceLog` `DebugLog` `InfoLog` `WarnLog` `ErrorLog` `FatalLog`

`PlayerJoined` and `PlayerLeft` fire when a player's client connects to or leaves the
server, with `{ user: { id, username }, mode, position }`. `InventoryChanged`,
`PlayerMovedChunk` and `ProfilingData` are chatty. `ev.data` is the game's own payload,
passed through as it arrives.

## How the server behaves

These come from a stock TavernLib 1.5.2 server and shape what the client does.

- **A wrong token gets no answer.** The socket stays open and nothing comes back. The client
  waits `authTimeoutMs` (10 s) after sending the token, emits `rejected`, and `connect()`
  rejects with `TokenRefusedError`. A refusal after the first login is reported the same way
  and retried.
- **A restarted server is slow to answer.** It accepts the login at once. TavernLib commands
  such as `player list` answer `Command not found` for about 30 s. Then, while the world
  loads, it runs no command at all for anything from 45 s to over four minutes, though
  events, logs and pings keep flowing. Then it runs every queued command in order and answers each one under its own
  id. The client logs one line when commands stop being answered and one when they come
  back, emits `late` for answers to commands that had already timed out, counts a late answer
  to a subscribe, and does not send a subscribe that is still waiting again for 10 minutes.
- **A message sent right after `PlayerJoined` is not shown.** The player is still loading:
  a message 15 s after the join was lost, 25 to 30 s worked. `examples/welcome.ts` waits
  30 s (`TAVERN_WELCOME_DELAY`).

## Options

| Option | Default | |
|---|---|---|
| `host` | | server address, no scheme |
| `port` | 1760 | |
| `token` | | the token, or a function returning it |
| `authTimeoutMs` | 10000 | silence after the token that counts as a refusal |
| `commandTimeoutMs` | 30000 | per command, unless `command()` is given one |
| `pingIntervalMs` | 20000 | keepalive; two missed rounds force a reconnect |
| `maxBackoffMs` | 30000 | cap on the reconnect delay |
| `autoReconnect` | true | |
| `resubscribeDelaysMs` | [8000, 20000, 40000] | extra re-subscribes after each connect |
| `retrySubscribeMs` | 15000 | how often failed subscribes are tried again |
| `resendUnansweredMs` | 600000 | how long a subscribe with no answer is left alone |
| `log` | console | `(level, message) => void`; pass `() => {}` to silence |

## Client events

| Event | Arguments | |
|---|---|---|
| `ready` | | logged in (again) |
| `close` | why | connection lost, reconnecting |
| `rejected` | why | the server did not accept the token |
| `event` | `{ type, data, timeStamp }` | a subscribed event |
| `late` | command, result | the answer to a command that had timed out |
| `line` | text | every console line, for logging |
| `error` | Error | socket errors (logged once if nothing listens) |

## Tests

`npm test` builds the package and runs the tests. The ones that need a fake game console
are skipped unless `TAVERN_FAKE_CONSOLE` points at one; it is not part of this repo.

## Licence

MIT
