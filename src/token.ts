import { readFileSync } from "node:fs";
import { join } from "node:path";

export function defaultTokenFile(): string | undefined {
  const appdata = process.env.APPDATA;
  return appdata ? join(appdata, "TheModdingTavern", "console_token.txt") : undefined;
}

export function readToken(file: string | undefined = defaultTokenFile()): string {
  if (!file) throw new Error("no console token file: pass a path to console_token.txt");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`cannot read the console token at ${file}. Start the game server once so it writes the file, or copy console_token.txt from the server.`);
  }
  const token = text.replace(/^﻿/, "").trim();
  if (!token) throw new Error(`the console token file ${file} is empty`);
  return token;
}
