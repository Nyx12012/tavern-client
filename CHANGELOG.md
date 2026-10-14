# Changelog

## 1.0.0 (2026-10-13)

First release, tested live against a stock TavernLib 1.5.2 server.

- `TavernClient`: login, commands with replies matched on their id, `websocket subscribe`
  events, keepalive, and reconnect that subscribes again on its own.
- A wrong token is reported as `TokenRefusedError` after `authTimeoutMs`, since the server
  never answers it.
- Answers that arrive after a command timed out are matched and emitted as `late`; a
  subscribe still waiting for its answer is not sent again for 10 minutes; one log line when
  a restarted server stops answering, one when it starts again.
- `players()`, `message()`, `readToken()`, and the event catalog `CONSOLE_EVENT_TYPES`.
