import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import * as client from "openid-client";

/**
 * Server-side (confidential-client) Authorization Code + PKCE flow against
 * anfall-auth. Two routes in server.ts drive this:
 *   GET /auth/login    -> redirect to anfall-auth's authorization endpoint
 *   GET /auth/callback -> exchange the code, hand back the anfall-auth
 *                          username on success
 * No cookies/sessions needed on this server: the PKCE verifier lives in an
 * in-memory map keyed by the OAuth `state` value, single-use, short TTL.
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** This server's own public origin, e.g. https://flatcraft.anfall.net */
  publicUrl: string;
  /** Dev/test only: allows discovery + token requests over plain HTTP.
   * Never set this in production - anfall-auth and this server are always
   * HTTPS there. */
  allowInsecure?: boolean;
}

interface Expiring {
  expiresAt: number;
}

interface PendingAuth extends Expiring {
  codeVerifier: string;
}

interface PendingSession extends Expiring {
  name: string;
  token: string;
}

const PENDING_AUTH_TTL_MS = 5 * 60_000;
const PENDING_SESSION_TTL_MS = 60_000;

export class OidcLogin {
  private config: client.Configuration | null = null;
  private readonly pendingAuth = new Map<string, PendingAuth>();
  private readonly pendingSessions = new Map<string, PendingSession>();

  constructor(private readonly options: OidcConfig) {}

  private async getConfig(): Promise<client.Configuration> {
    // anfall-auth registers clients for client_secret_basic only (see
    // client/Client.kt's default) - openid-client defaults to
    // client_secret_post, which anfall-auth then rejects as invalid_client.
    this.config ??= await client.discovery(
      new URL(this.options.issuer),
      this.options.clientId,
      this.options.clientSecret,
      client.ClientSecretBasic(this.options.clientSecret),
      this.options.allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
    );
    return this.config;
  }

  /** Builds the URL to redirect the browser to for /auth/login. */
  async buildAuthorizationRedirect(): Promise<URL> {
    const config = await this.getConfig();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    sweepExpired(this.pendingAuth);
    this.pendingAuth.set(state, { codeVerifier, expiresAt: Date.now() + PENDING_AUTH_TTL_MS });

    return client.buildAuthorizationUrl(config, {
      redirect_uri: `${this.options.publicUrl}/auth/callback`,
      scope: "openid profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
  }

  /** Exchanges the callback's code for tokens and returns the anfall-auth
   * username (preferred_username claim). Throws with a message safe to
   * show the end user on any failure. */
  async handleCallback(request: IncomingMessage): Promise<{ name: string }> {
    const config = await this.getConfig();
    const currentUrl = new URL(request.url ?? "/", this.options.publicUrl);
    const state = currentUrl.searchParams.get("state");
    const pending = state ? this.pendingAuth.get(state) : undefined;
    if (!pending || pending.expiresAt < Date.now()) {
      throw new Error("login expired, please try again");
    }
    this.pendingAuth.delete(state!);

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: state!,
    });
    const claims = tokens.claims() as Record<string, unknown> | undefined;
    const name = claims?.["preferred_username"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("anfall-auth did not return a username");
    }
    return { name };
  }

  /**
   * Stashes name+token behind a one-time code the client exchanges via
   * /auth/session, so the real session token never sits in the URL, browser
   * history, or referrer headers.
   */
  issuePendingSession(name: string, token: string): string {
    sweepExpired(this.pendingSessions);
    const code = randomBytes(16).toString("hex");
    this.pendingSessions.set(code, { name, token, expiresAt: Date.now() + PENDING_SESSION_TTL_MS });
    return code;
  }

  claimPendingSession(code: string): { name: string; token: string } | null {
    const pending = this.pendingSessions.get(code);
    if (!pending) return null;
    this.pendingSessions.delete(code);
    return pending.expiresAt < Date.now() ? null : { name: pending.name, token: pending.token };
  }
}

function sweepExpired(map: Map<string, Expiring>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt < now) map.delete(key);
  }
}
