import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { CommandTimeoutError, NotConnectedError, TokenRefusedError, seconds } from "./errors.js";
import { frameType, lineFor, toCommandResult } from "./reply.js";
import type { CommandResult, LogLevel, TokenProvider } from "./types.js";

const CONNECT_DEADLINE_MS = 30000;
const PRIME_TIMEOUT_MS = 8000;
const LATE_MEMORY = 1000;
const MAX_ID = 2147483647;

export interface ConnectionOptions {
  host: string;
  port: number;
  token: string | TokenProvider;
  authTimeoutMs: number;
  pingIntervalMs: number;
  maxBackoffMs: number;
  autoReconnect: boolean;
  log: (level: LogLevel, message: string) => void;
}

type OnLate = (result: CommandResult) => void;

interface Pending {
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class Connection extends EventEmitter {
  readonly label: string;
  private ws: WebSocket | null = null;
  private stopped = true;
  private authed = false;
  private attempt = 0;
  private lastSeen = 0;
  private tokenSent = false;
  private errorLogged = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private authTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly late = new Map<number, { command: string; onLate?: OnLate }>();
  private stallSince: number | null = null;

  constructor(private readonly opts: ConnectionOptions) {
    super();
    this.label = `${opts.host}:${opts.port}`;
  }

  get connected(): boolean {
    return this.authed;
  }

  connect(): Promise<void> {
    if (!this.stopped) return Promise.resolve();
    this.stopped = false;
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.connectTimer = setTimeout(() => {
        if (this.authed) return;
        this.failConnect(new Error(`could not connect to ${this.label} within ${seconds(CONNECT_DEADLINE_MS)}`));
      }, CONNECT_DEADLINE_MS);
      this.open();
    });
  }

  private failConnect(e: Error) {
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    this.close();
    reject?.(e);
  }

  private open() {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${this.label}`);
    } catch (e) {
      this.opts.log("warn", `cannot open ${this.label}: ${(e as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.tokenSent = false;
    this.armAuthTimer(ws);
    ws.on("open", () => void this.sendToken(ws));
    ws.on("message", (data) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      this.onFrame(String(data));
    });
    ws.on("pong", () => { this.lastSeen = Date.now(); });
    ws.on("error", (e) => this.onSocketError(e as Error));
    ws.on("close", () => { if (this.ws === ws) this.onDown("connection closed"); });
  }

  private onSocketError(e: Error) {
    if (this.listenerCount("error") > 0) {
      this.emit("error", e);
    } else if (!this.errorLogged) {
      this.errorLogged = true;
      this.opts.log("warn", `${this.label}: ${e.message}`);
    }
  }

  private armAuthTimer(ws: WebSocket) {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = setTimeout(() => {
      this.authTimer = null;
      if (this.authed || this.ws !== ws) return;
      if (this.tokenSent && ws.readyState === WebSocket.OPEN) {
        this.onRefused(`the console did not accept the token within ${seconds(this.opts.authTimeoutMs)}. A wrong token gets no answer: copy a fresh console_token.txt.`);
        return;
      }
      this.opts.log("warn", `no login reply from ${this.label} within ${seconds(this.opts.authTimeoutMs)}, retrying`);
      try { ws.terminate(); } catch { }
    }, this.opts.authTimeoutMs);
  }

  private async sendToken(ws: WebSocket) {
    try {
      const token = typeof this.opts.token === "function" ? await this.opts.token() : this.opts.token;
      if (ws.readyState !== WebSocket.OPEN || this.ws !== ws) return;
      ws.send(token);
      this.tokenSent = true;
      this.armAuthTimer(ws);
    } catch (e) {
      this.opts.log("error", `token provider failed: ${(e as Error).message}`);
      try { ws.terminate(); } catch { }
    }
  }

  private onRefused(why: string) {
    this.emit("rejected", why);
    if (this.readyReject) {
      this.failConnect(new TokenRefusedError(why));
      return;
    }
    const ws = this.ws;
    try { ws?.terminate(); } catch { }
  }

  private onFrame(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emit("line", raw);
      return;
    }
    if (msg == null || typeof msg !== "object") {
      this.emit("line", raw);
      return;
    }
    const type = frameType(msg.type);
    if (type === "SystemMessage") {
      const text = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data ?? "");
      if (!this.authed) {
        if (/Connection Succeeded/i.test(text)) this.onAuthed();
        else if (/Invalid Token|refused/i.test(text)) this.onRefused(`the console rejected the token (${text}). Copy a fresh console_token.txt.`);
        return;
      }
      if (text) this.emit("line", text);
      return;
    }
    if (type === "CommandResult") {
      this.onResult(msg.commandId, toCommandResult(msg.data));
      return;
    }
    if (type === "Subscription" && typeof msg.eventType === "string") {
      this.emit("event", { type: msg.eventType, data: msg.data, timeStamp: msg.timeStamp });
      return;
    }
    this.emit("line", raw);
  }

  private onResult(commandId: unknown, r: CommandResult) {
    const line = lineFor(r);
    if (line) this.emit("line", line);
    const id = Number(commandId);
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(r);
    } else {
      const late = this.late.get(id);
      if (late) {
        this.late.delete(id);
        late.onLate?.(r);
        this.emit("late", late.command, r);
      }
    }
    if (this.stallSince !== null) {
      const waited = seconds(Math.round((Date.now() - this.stallSince) / 1000) * 1000);
      this.stallSince = null;
      this.opts.log("info", `${this.label} is answering commands again, after ${waited}.`);
    }
  }

  private onAuthed() {
    this.authed = true;
    this.attempt = 0;
    this.errorLogged = false;
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.lastSeen = Date.now();
    this.startPing();
    this.command("websocket subscriptions", PRIME_TIMEOUT_MS)
      .catch((e) => this.opts.log("warn", `${this.label}: priming round trip failed: ${(e as Error).message}`))
      .finally(() => this.signalReady());
  }

  private signalReady() {
    if (!this.authed) return;
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    const resolve = this.readyResolve;
    this.readyResolve = null;
    this.readyReject = null;
    this.emit("ready");
    resolve?.();
  }

  command(text: string, timeoutMs: number, onLate?: OnLate): Promise<CommandResult> {
    const ws = this.ws;
    if (!this.authed || !ws) return Promise.reject(new NotConnectedError());
    const id = this.nextId;
    this.nextId = this.nextId >= MAX_ID ? 1 : this.nextId + 1;
    const sentAt = Date.now();
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.timedOut(id, text, sentAt, timeoutMs, onLate);
        reject(new CommandTimeoutError(text, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ id, content: text }));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  private timedOut(id: number, command: string, sentAt: number, timeoutMs: number, onLate?: OnLate) {
    this.late.set(id, { command, onLate });
    while (this.late.size > LATE_MEMORY) this.late.delete(this.late.keys().next().value as number);
    if (this.stallSince === null) {
      this.stallSince = sentAt;
      this.opts.log("warn", `No answer from ${this.label} in ${seconds(timeoutMs)}. A server that just started runs no commands while it loads the world, for up to a few minutes, then runs them all.`);
    }
  }

  private onDown(why: string) {
    const wasAuthed = this.authed;
    this.authed = false;
    this.ws = null;
    this.clearTimers();
    this.dropPending();
    if (wasAuthed) this.emit("close", why);
    if (!this.opts.autoReconnect && this.readyReject) {
      this.failConnect(new Error(`cannot reach the console at ${this.label} (${why})`));
      return;
    }
    this.scheduleReconnect();
  }

  private dropPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("disconnected from the console"));
    }
    this.pending.clear();
    this.late.clear();
    this.stallSince = null;
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastSeen > this.opts.pingIntervalMs * 2 + 5000) {
        this.opts.log("warn", `no answer from ${this.label}, reconnecting`);
        try { ws.terminate(); } catch { }
        return;
      }
      try { ws.ping(); } catch { }
    }, this.opts.pingIntervalMs);
  }

  private scheduleReconnect() {
    if (this.stopped || !this.opts.autoReconnect || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.attempt, this.opts.maxBackoffMs) + Math.floor(Math.random() * 250);
    this.attempt++;
    if (this.attempt <= 3 || this.attempt % 10 === 0) {
      this.opts.log("info", `reconnecting to ${this.label}, attempt ${this.attempt} in ${seconds(delay)}`);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  close() {
    this.stopped = true;
    this.clearTimers();
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    if (ws) {
      ws.removeAllListeners();
      ws.on("error", () => { });
      try {
        ws.close();
        const killer = setTimeout(() => { try { ws.terminate(); } catch { } }, 1000);
        killer.unref?.();
      } catch {
        try { ws.terminate(); } catch { }
      }
    }
    this.dropPending();
    reject?.(new Error("closed before connect completed"));
  }

  private clearTimers() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
}
