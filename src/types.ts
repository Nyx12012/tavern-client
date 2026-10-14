export const CONSOLE_EVENT_TYPES = [
  "PlayerStateChanged",
  "PlayerJoined",
  "PlayerLeft",
  "PlayerKilled",
  "PlayerMovedChunk",
  "ObjectKilled",
  "InventoryChanged",
  "CommandExecuted",
  "ServerSettingsChanged",
  "PopulationModified",
  "AtmBalanceChanged",
  "TradeDeckUsed",
  "TrialStarted",
  "TrialFinished",
  "SocialTabletPlayerBanned",
  "SocialTabletPlayerReported",
  "ProfilingData",
  "TraceLog",
  "DebugLog",
  "InfoLog",
  "WarnLog",
  "ErrorLog",
  "FatalLog",
] as const;

export type KnownConsoleEventType = (typeof CONSOLE_EVENT_TYPES)[number];

export type ConsoleEventType = KnownConsoleEventType | (string & {});

export type TokenProvider = () => string | Promise<string>;

export type LogLevel = "info" | "warn" | "error";

export interface TavernClientOptions {
  host: string;
  port?: number;
  token: string | TokenProvider;
  authTimeoutMs?: number;
  commandTimeoutMs?: number;
  pingIntervalMs?: number;
  maxBackoffMs?: number;
  autoReconnect?: boolean;
  resubscribeDelaysMs?: number[];
  retrySubscribeMs?: number;
  resendUnansweredMs?: number;
  log?: (level: LogLevel, message: string) => void;
}

export interface CommandResult {
  resultString: string;
  result: unknown;
  error?: string;
}

export type SubscribeOutcome = "Success" | "Unchanged" | "NotFound" | "Queued" | (string & {});

export interface TavernEvent {
  type: ConsoleEventType;
  data: unknown;
  timeStamp?: string;
}

export interface Player {
  id: number | null;
  username: string;
}

export interface TavernClientEvents {
  ready: () => void;
  close: (why: string) => void;
  error: (err: Error) => void;
  line: (text: string) => void;
  event: (ev: TavernEvent) => void;
  rejected: (why: string) => void;
  late: (command: string, result: CommandResult) => void;
}
