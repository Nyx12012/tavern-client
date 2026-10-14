import { TavernClient, readToken } from "tavern-client";

const host = process.env.TAVERN_HOST ?? "127.0.0.1";
const port = Number(process.env.TAVERN_PORT ?? 1760);
const token = process.env.TAVERN_TOKEN ?? readToken(process.env.TAVERN_TOKEN_FILE || undefined);

const tavern = new TavernClient({ host, port, token });

tavern.on("ready", () => console.log(`connected to ${host}:${port}`));
tavern.on("close", (why) => console.log(`connection lost (${why}), reconnecting`));
tavern.on("rejected", (why) => console.log(`token refused: ${why}`));
tavern.on("event", (ev) => console.log(`[${ev.type}]`, JSON.stringify(ev.data)));
tavern.on("late", (command, result) => console.log(`late answer to ${command}:`, result.error ?? "ok"));

await tavern.connect();
for (const name of ["PlayerJoined", "PlayerLeft", "PlayerStateChanged", "CommandExecuted"]) {
  await tavern.subscribe(name);
}

const players = await tavern.players();
console.log(`online: ${players.map((p) => p.username).join(", ") || "nobody"}`);
console.log("tailing events, Ctrl+C to quit");

process.on("SIGINT", () => {
  tavern.close();
  setTimeout(() => process.exit(0), 300);
});
