import { TavernClient, readToken } from "tavern-client";

const host = process.env.TAVERN_HOST ?? "127.0.0.1";
const port = Number(process.env.TAVERN_PORT ?? 1760);
const token = process.env.TAVERN_TOKEN ?? readToken(process.env.TAVERN_TOKEN_FILE || undefined);
const delay = Number(process.env.TAVERN_WELCOME_DELAY ?? 30);

const tavern = new TavernClient({ host, port, token });

tavern.on("event", (ev) => {
  if (ev.type !== "PlayerJoined") return;
  const name = (ev.data as { user?: { username?: string } } | null)?.user?.username;
  if (!name) return;
  console.log(`${name} joined, welcome in ${delay}s`);
  setTimeout(async () => {
    try {
      const r = await tavern.message(name, `Welcome to the server, ${name}!`);
      console.log(r.error ? `could not welcome ${name}: ${r.error}` : `welcomed ${name}`);
    } catch (e) {
      console.log(`could not welcome ${name}: ${(e as Error).message}`);
    }
  }, delay * 1000);
});

await tavern.connect();
await tavern.subscribe("PlayerJoined");
console.log("waiting for players");

process.on("SIGINT", () => {
  tavern.close();
  setTimeout(() => process.exit(0), 300);
});
