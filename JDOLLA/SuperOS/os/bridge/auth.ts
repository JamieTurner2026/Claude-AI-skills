// Signed session tokens. The secret lives in os/.cache/secret (git-ignored) so `npm run open`
// can mint a session for a server that is already running. Sessions last 24 hours.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Paths } from "./config.ts";

export const SESSION_MS = 24 * 60 * 60 * 1000;
export const COOKIE = "superos_session";

export function loadOrCreateSecret(p: Paths): string {
  const file = path.join(p.cache, "secret");
  if (existsSync(file)) {
    const s = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(s)) return s;
  }
  mkdirSync(p.cache, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret + "\n", { mode: 0o600 });
  return secret;
}

function mac(secret: string, exp: string): Buffer {
  return createHmac("sha256", secret).update("superos-session-v1:" + exp).digest();
}

export function mintToken(secret: string, now: number = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${mac(secret, exp).toString("base64url")}`;
}

export function verifyToken(secret: string, token: unknown, now: number = Date.now()): boolean {
  if (typeof token !== "string" || token.length > 120) return false;
  const m = /^(\d{13,14})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m?.[1] || !m[2]) return false;
  const given = Buffer.from(m[2], "base64url");
  const want = mac(secret, m[1]);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
  return Number(m[1]) > now;
}
