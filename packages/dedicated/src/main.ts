import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startDedicatedServer } from "./server.js";

/**
 * Dedicated server entry point. Configuration via environment:
 *   PORT        listen port                  (default 8080)
 *   DATA_DIR    world + accounts directory   (default ./data)
 *   CLIENT_DIR  built client to serve        (default: sibling packages/client/dist)
 *   SEED        world seed for new worlds    (default 1337)
 *   SERVER_NAME name shown to clients        (default FlatCraft)
 */

const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDir = resolve(here, "../../client/dist");

const clientDir = process.env["CLIENT_DIR"] ?? (existsSync(defaultClientDir) ? defaultClientDir : undefined);
if (!clientDir) {
  console.warn("no built client found (set CLIENT_DIR or run `npm run build`); serving API/WS only");
}

const server = await startDedicatedServer({
  port: Number(process.env["PORT"] ?? 8080),
  dataDir: process.env["DATA_DIR"] ?? "./data",
  clientDir,
  seed: process.env["SEED"] !== undefined ? Number(process.env["SEED"]) : undefined,
  serverName: process.env["SERVER_NAME"],
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: saving world and shutting down...`);
    void server.close().then(() => process.exit(0));
  });
}
