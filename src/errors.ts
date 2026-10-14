export function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(3))}s`;
}

export class TokenRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefusedError";
  }
}

export class NotConnectedError extends Error {
  constructor(message = "not connected to the console") {
    super(message);
    this.name = "NotConnectedError";
  }
}

export class CommandTimeoutError extends Error {
  readonly command: string;
  readonly timeoutMs: number;

  constructor(command: string, timeoutMs: number) {
    super(`command timed out after ${seconds(timeoutMs)}: ${command}. The server may still run it later.`);
    this.name = "CommandTimeoutError";
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}
