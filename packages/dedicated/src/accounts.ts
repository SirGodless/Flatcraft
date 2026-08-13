import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthRequest } from "@flatcraft/server";

/**
 * Flat-file account store: name -> session token. Accounts are only ever
 * created by establishSession(), which is called after a verified
 * anfall-auth login (see oidc.ts) - identity lives at anfall-auth, this is
 * just the token that lets a WebSocket connection prove it. The wire
 * protocol's `authenticate` never creates an account, only checks one.
 */

const NAME_PATTERN = /^[A-Za-z0-9_]{2,16}$/;

interface AccountRecord {
  token: string;
}

export type AuthResult = { ok: true; name: string; token: string } | { ok: false; reason: string };

export class Accounts {
  private readonly accounts = new Map<string, AccountRecord>();

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, AccountRecord>;
      for (const [name, record] of Object.entries(parsed)) {
        this.accounts.set(name, record);
      }
    }
  }

  get count(): number {
    return this.accounts.size;
  }

  authenticate(request: AuthRequest): AuthResult {
    const name = request.name;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      return { ok: false, reason: "invalid name (2-16 letters, digits, _)" };
    }
    const token = request.token;
    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, reason: "no session - log in at /auth/login" };
    }
    const account = this.accounts.get(name);
    if (!account || !safeEqual(account.token, token)) {
      return { ok: false, reason: "invalid session, log in again" };
    }
    return { ok: true, name, token: account.token };
  }

  /**
   * Issues a fresh session token for `name`, creating the account if it's
   * new. Called only after a verified anfall-auth login (oidc.ts) - never
   * reachable from the wire protocol. Tests use this directly to bootstrap
   * a session without going through a real OIDC round trip.
   */
  establishSession(name: string): { name: string; token: string } {
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`invalid account name: ${name}`);
    }
    const token = randomBytes(24).toString("hex");
    this.accounts.set(name, { token });
    this.save();
    return { name, token };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const data = JSON.stringify(Object.fromEntries(this.accounts), null, 2);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, this.file);
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
