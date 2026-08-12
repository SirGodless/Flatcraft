import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthRequest } from "@flatcraft/server";

/**
 * Flat-file account store: name -> scrypt password hash + session token.
 * First login with an unknown name registers the account ("register or
 * login", like most private game servers). Tokens let the browser
 * re-login without retyping the password; they stay valid until the
 * password changes (which we don't support yet) or the file is wiped.
 */

const NAME_PATTERN = /^[A-Za-z0-9_]{2,16}$/;
const MIN_PASSWORD_LENGTH = 4;

interface AccountRecord {
  salt: string;
  hash: string;
  token: string;
}

export type AuthResult =
  | { ok: true; name: string; token: string }
  | { ok: false; reason: string };

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
    const account = this.accounts.get(name);

    if (typeof request.token === "string" && request.token.length > 0) {
      if (account && safeEqual(account.token, request.token)) {
        return { ok: true, name, token: account.token };
      }
      return { ok: false, reason: "invalid session, log in again" };
    }

    const password = request.password;
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, reason: `password too short (min ${MIN_PASSWORD_LENGTH})` };
    }

    if (!account) {
      // Unknown name: register it with this password.
      const salt = randomBytes(16).toString("hex");
      const record: AccountRecord = {
        salt,
        hash: hashPassword(password, salt),
        token: randomBytes(24).toString("hex"),
      };
      this.accounts.set(name, record);
      this.save();
      return { ok: true, name, token: record.token };
    }

    if (!safeEqual(account.hash, hashPassword(password, account.salt))) {
      return { ok: false, reason: "wrong password" };
    }
    return { ok: true, name, token: account.token };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const data = JSON.stringify(Object.fromEntries(this.accounts), null, 2);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, this.file);
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
