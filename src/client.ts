import { EventEmitter } from "node:events";
import { Connection } from "./connection.js";
import { CommandTimeoutError } from "./errors.js";
import { rosterFrom, subscribeOutcome } from "./reply.js";
import type {
  CommandResult, ConsoleEventType, LogLevel, Player, SubscribeOutcome, TavernClientEvents, TavernClientOptions,
} from "./types.js";

const DEFAULTS = {
  port: 1760,
  authTimeoutMs: 10000,
  commandTimeoutMs: 30000,
  pingIntervalMs: 20000,
  maxBackoffMs: 30000,
  autoReconnect: true,
  resubscribeDelaysMs: [8000, 20000, 40000],
  retrySubscribeMs: 15000,
  resendUnansweredMs: 600000,
};

const SAFE_PLAYER = /^[A-Za-z0-9 _.\-]{1,32}$/;
const MESSAGE_MAX = 500;

interface Session {
  confirmed: Set<string>;
  notFound: Set<string>;
  inflight: Set<string>;
  unanswered: Map<string, number>;
}

const newSession = (): Session => ({
  confirmed: new Set(), notFound: new Set(), inflight: new Set(), unanswered: new Map(),
});

function defaultLog(level: LogLevel, message: string) {
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  out(`[tavern-client] ${message}`);
}

export interface TavernClient {
  on<K extends keyof TavernClientEvents>(event: K, listener: TavernClientEvents[K]): this;
  once<K extends keyof TavernClientEvents>(event: K, listener: TavernClientEvents[K]): this;
  off<K extends keyof TavernClientEvents>(event: K, listener: TavernClientEvents[K]): this;
}

export class TavernClient extends EventEmitter {
  private readonly connection: Connection;
  private readonly log: (level: LogLevel, message: string) => void;
  private readonly commandTimeoutMs: number;
  private readonly resubscribeDelaysMs: number[];
  private readonly retrySubscribeMs: number;
  private readonly resendUnansweredMs: number;
  private readonly wanted = new Set<string>();
  private session = newSession();
  private timers: NodeJS.Timeout[] = [];

  constructor(options: TavernClientOptions) {
    super();
    this.log = options.log ?? defaultLog;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs;
    this.resubscribeDelaysMs = options.resubscribeDelaysMs ?? DEFAULTS.resubscribeDelaysMs;
    this.retrySubscribeMs = options.retrySubscribeMs ?? DEFAULTS.retrySubscribeMs;
    this.resendUnansweredMs = options.resendUnansweredMs ?? DEFAULTS.resendUnansweredMs;
    this.connection = new Connection({
      host: options.host,
      port: options.port ?? DEFAULTS.port,
      token: options.token,
      authTimeoutMs: options.authTimeoutMs ?? DEFAULTS.authTimeoutMs,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULTS.pingIntervalMs,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
      autoReconnect: options.autoReconnect ?? DEFAULTS.autoReconnect,
      log: this.log,
    });
    this.connection.on("ready", () => this.onReady());
    this.connection.on("close", (why: string) => {
      this.clearTimers();
      this.emit("close", why);
    });
    for (const name of ["line", "event", "rejected", "late"] as const) {
      this.connection.on(name, (...args: unknown[]) => this.emit(name, ...args));
    }
    this.connection.on("error", (e: Error) => {
      if (this.listenerCount("error") > 0) this.emit("error", e);
    });
  }

  get connected(): boolean {
    return this.connection.connected;
  }

  get subscriptions(): string[] {
    return [...this.wanted];
  }

  connect(): Promise<void> {
    return this.connection.connect();
  }

  command(text: string, timeoutMs = this.commandTimeoutMs): Promise<CommandResult> {
    return this.connection.command(text, timeoutMs);
  }

  async subscribe(eventType: ConsoleEventType): Promise<SubscribeOutcome> {
    if (eventType === "*") throw new Error("the console has no wildcard subscription: subscribe to each event type");
    this.wanted.add(eventType);
    if (!this.connected) return "Queued";
    return this.sendSubscribe(eventType, this.session);
  }

  async unsubscribe(eventType: ConsoleEventType): Promise<SubscribeOutcome> {
    this.wanted.delete(eventType);
    this.session.confirmed.delete(eventType);
    this.session.unanswered.delete(eventType);
    if (!this.connected) return "Queued";
    const r = await this.connection.command(`websocket unsubscribe ${eventType}`, this.commandTimeoutMs);
    return subscribeOutcome(r);
  }

  close(): void {
    this.clearTimers();
    this.connection.close();
  }

  async players(): Promise<Player[]> {
    const r = await this.command("player list");
    if (r.error) throw new Error(r.error);
    return rosterFrom(r.result) ?? [];
  }

  message(player: string, text: string): Promise<CommandResult> {
    if (!SAFE_PLAYER.test(player)) {
      return Promise.reject(new Error(`unsafe player name: ${JSON.stringify(player)}`));
    }
    const clean = [...String(text)].filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && c !== "\"" && c !== "\\";
    }).join("").slice(0, MESSAGE_MAX);
    if (clean.trim() === "") return Promise.reject(new Error("empty message text"));
    return this.command(`player message "${player}" "${clean}"`);
  }

  private onReady() {
    this.clearTimers();
    this.session = newSession();
    this.resubscribeAll(true);
    for (const delay of this.resubscribeDelaysMs) this.later(delay, () => this.resubscribeAll(true));
    if (this.retrySubscribeMs > 0) {
      const timer = setInterval(() => this.resubscribeAll(false), this.retrySubscribeMs);
      timer.unref?.();
      this.timers.push(timer);
    }
    this.emit("ready");
  }

  private later(delay: number, fn: () => void) {
    const timer = setTimeout(fn, delay);
    timer.unref?.();
    this.timers.push(timer);
  }

  private clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private resubscribeAll(force: boolean) {
    if (!this.connected) return;
    for (const name of this.wanted) this.resubscribe(name, force);
  }

  private resubscribe(name: string, force: boolean) {
    const s = this.session;
    if (s.inflight.has(name)) return;
    const waiting = s.unanswered.get(name);
    if (waiting !== undefined) {
      if (Date.now() - waiting < this.resendUnansweredMs) return;
    } else if (!force && (s.confirmed.has(name) || s.notFound.has(name))) {
      return;
    }
    this.sendSubscribe(name, s).catch((e: Error) => {
      if (!(e instanceof CommandTimeoutError) && this.connected) this.log("warn", `could not subscribe to ${name}: ${e.message}`);
    });
  }

  private async sendSubscribe(name: string, s: Session): Promise<SubscribeOutcome> {
    s.inflight.add(name);
    try {
      const r = await this.connection.command(`websocket subscribe ${name}`, this.commandTimeoutMs,
        (late) => this.outcomeOf(name, s, late));
      return this.outcomeOf(name, s, r);
    } catch (e) {
      if (e instanceof CommandTimeoutError) s.unanswered.set(name, Date.now());
      throw e;
    } finally {
      s.inflight.delete(name);
    }
  }

  private outcomeOf(name: string, s: Session, r: CommandResult): SubscribeOutcome {
    s.unanswered.delete(name);
    const outcome = subscribeOutcome(r);
    if (outcome === "Success" || outcome === "Unchanged") {
      s.confirmed.add(name);
      s.notFound.delete(name);
    } else {
      if (outcome === "NotFound") s.notFound.add(name);
      this.log("warn", `subscribing to ${name} on ${this.connection.label}: ${outcome}`);
    }
    return outcome;
  }
}
