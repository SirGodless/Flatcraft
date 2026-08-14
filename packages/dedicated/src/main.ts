import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startDedicatedServer } from "./server.js";

/**
 * Dedicated server entry point. Configuration via environment:
 *   PORT              listen port                  (default 8080)
 *   DATA_DIR          world + accounts directory   (default ./data)
 *   CLIENT_DIR        built client to serve        (default: sibling packages/client/dist)
 *   SEED              world seed for new worlds    (default 1337)
 *   SERVER_NAME       name shown to clients        (default FlatCraft)
 *   OIDC_ISSUER       anfall-auth issuer URL, e.g. https://auth.anfall.net
 *   OIDC_CLIENT_ID    client registered at anfall-auth for this server
 *   OIDC_CLIENT_SECRET
 *   PUBLIC_URL        this server's own public origin, e.g. https://flatcraft.anfall.net
 *   OIDC_ALLOW_INSECURE  dev/test only: allows http:// issuer/publicUrl (default: HTTPS required)
 *   RESET_WORLD       "true" wipes the world on this boot (old save kept as a timestamped backup, not deleted)
 *   RESET_PLAYERS     "true" keeps the world but resets every player's saved state (position/inventory/health)
 * OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/PUBLIC_URL must all be set
 * together, or all omitted (login is disabled and /auth/* answer 501).
 * RESET_WORLD/RESET_PLAYERS only take effect for this one boot - remove
 * them again afterwards, or every restart wipes state again.
 */

const here = dirname(fileURLToPath(import.meta.url));
const defaultClientDir = resolve(here, "../../client/dist");

const clientDir = process.env["CLIENT_DIR"] ?? (existsSync(defaultClientDir) ? defaultClientDir : undefined);
if (!clientDir) {
  console.warn("no built client found (set CLIENT_DIR or run `npm run build`); serving API/WS only");
}

const oidcIssuer = process.env["OIDC_ISSUER"];
const oidcClientId = process.env["OIDC_CLIENT_ID"];
const oidcClientSecret = process.env["OIDC_CLIENT_SECRET"];
const publicUrl = process.env["PUBLIC_URL"];
const oidcVars = [oidcIssuer, oidcClientId, oidcClientSecret, publicUrl];
if (oidcVars.some(Boolean) && !oidcVars.every(Boolean)) {
  throw new Error(
    "OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and PUBLIC_URL must all be set together",
  );
}
if (!oidcIssuer) {
  console.warn("OIDC not configured (OIDC_ISSUER unset) - /auth/login will answer 501, nobody can log in");
}

const server = await startDedicatedServer({
  port: Number(process.env["PORT"] ?? 8080),
  dataDir: process.env["DATA_DIR"] ?? "./data",
  clientDir,
  seed: process.env["SEED"] !== undefined ? Number(process.env["SEED"]) : undefined,
  serverName: process.env["SERVER_NAME"],
  resetWorld: process.env["RESET_WORLD"] === "true",
  resetPlayers: process.env["RESET_PLAYERS"] === "true",
  oidc:
    oidcIssuer && oidcClientId && oidcClientSecret && publicUrl
      ? {
          issuer: oidcIssuer,
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
          publicUrl,
          allowInsecure: process.env["OIDC_ALLOW_INSECURE"] === "true",
        }
      : undefined,
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
