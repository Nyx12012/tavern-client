import type { CommandResult, Player, SubscribeOutcome } from "./types.js";

const FRAME_TYPES = ["SystemMessage", "Subscription", "CommandResult"];
const OUTCOMES = ["Success", "Unchanged", "NotFound"];
const EXCEPTION_TEXT = /^[A-Za-z_][\w.]*Exception: /;

export function frameType(value: unknown): string {
  if (typeof value === "number") return FRAME_TYPES[value] ?? String(value);
  return value == null ? "" : String(value);
}

function exceptionText(ex: unknown): string | undefined {
  if (ex == null) return undefined;
  if (typeof ex === "string") return ex.trim() === "" ? undefined : ex;
  if (typeof ex === "object") {
    const o = ex as Record<string, unknown>;
    const message = o.Message ?? o.message ?? o.ClassName ?? o.className;
    return message == null || message === "" ? JSON.stringify(ex) : String(message);
  }
  return String(ex);
}

export function toCommandResult(data: unknown): CommandResult {
  if (data == null) return { resultString: "", result: null };
  if (typeof data !== "object") return { resultString: String(data), result: null };
  const d = data as Record<string, unknown>;
  const rs = d.ResultString;
  const resultString = rs == null ? "" : typeof rs === "string" ? rs : JSON.stringify(rs);
  const result = d.Result ?? null;
  let error = exceptionText(d.Exception);
  if (error === undefined && result === null && EXCEPTION_TEXT.test(resultString)) error = resultString;
  return error === undefined ? { resultString, result } : { resultString, result, error };
}

export function subscribeOutcome(r: CommandResult): SubscribeOutcome {
  if (r.error) return `error: ${r.error}`;
  let value = r.result;
  if (value == null || (typeof value === "string" && value.trim() === "")) value = r.resultString;
  if (typeof value === "number") return OUTCOMES[value] ?? String(value);
  return value == null || value === "" ? "null" : String(value);
}

export function rosterFrom(result: unknown): Player[] | null {
  if (!Array.isArray(result)) return null;
  const out: Player[] = [];
  for (const p of result) {
    if (p == null || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const username = o.username ?? o.Username;
    if (username == null || String(username).trim() === "") continue;
    const id = o.id ?? o.Identifier;
    out.push({ id: typeof id === "number" ? id : id == null ? null : Number(id), username: String(username) });
  }
  return out;
}

export function lineFor(r: CommandResult): string | undefined {
  if (r.error) return r.error;
  if (r.resultString && !r.resultString.startsWith("System.")) return r.resultString;
  if (r.result != null && !(Array.isArray(r.result) && r.result.length === 0)) return JSON.stringify(r.result, null, 2);
  return undefined;
}
