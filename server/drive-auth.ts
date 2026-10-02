import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type Database from "better-sqlite3";
import { GoogleDriveClient, StorageError } from "./drive-client";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export function tokenCipher(secret: string) {
  const key = createHash("sha256")
    .update("webmind-drive-token:" + secret)
    .digest();
  return {
    encrypt(value: string) {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([
        iv,
        c.update(value, "utf8"),
        c.final(),
        c.getAuthTag(),
      ]).toString("base64");
    },
    decrypt(value: string) {
      const b = Buffer.from(value, "base64"),
        c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      c.setAuthTag(b.subarray(-16));
      return Buffer.concat([
        c.update(b.subarray(12, -16)),
        c.final(),
      ]).toString();
    },
  };
}
export function driveAuth(
  db: Database.Database,
  secret: string,
  baseURL: string,
) {
  db.exec(`CREATE TABLE IF NOT EXISTS drive_connections(owner TEXT PRIMARY KEY,subject TEXT NOT NULL,email TEXT NOT NULL,tokens TEXT NOT NULL,folder TEXT,conditional INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS drive_oauth(state TEXT PRIMARY KEY,owner TEXT NOT NULL,sessionHash TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const cipher = tokenCipher(secret),
    callback = new URL("/api/drive/callback", baseURL).href;
  const configured = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
  const connection = (owner: string) =>
    db
      .prepare("SELECT * FROM drive_connections WHERE owner=?")
      .get(owner) as any;
  const refreshes = new Map<string, Promise<string>>();
  function consume(owner: string, sessionHash: string, state: string) {
    const pending = db
      .prepare("DELETE FROM drive_oauth WHERE state=? RETURNING *")
      .get(state) as any;
    if (
      !pending ||
      pending.owner !== owner ||
      pending.sessionHash !== sessionHash ||
      pending.expires < Date.now()
    )
      throw new StorageError(
        400,
        "oauth_state",
        "연결 요청이 만료되었거나 일치하지 않습니다.",
      );
    return pending;
  }
  async function exchange(params: Record<string, string>) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({
        ...params,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    });
    if (!r.ok)
      throw new StorageError(
        428,
        "drive_reconnect",
        "Google Drive를 다시 연결하세요.",
      );
    return (await r.json()) as any;
  }
  async function token(owner: string): Promise<string> {
    const c = connection(owner);
    if (!c)
      throw new StorageError(
        428,
        "drive_connect",
        "Google Drive 연결이 필요합니다.",
      );
    const t = JSON.parse(cipher.decrypt(c.tokens));
    if (t.expires > Date.now() + 60000) return t.access_token;
    if (refreshes.has(owner)) return refreshes.get(owner)!;
    const pending = (async () => {
      const fresh = await exchange({
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
      });
      const encoded = cipher.encrypt(
        JSON.stringify({
          ...t,
          ...fresh,
          expires: Date.now() + fresh.expires_in * 1000,
        }),
      );
      const result = db
        .prepare(
          "UPDATE drive_connections SET tokens=? WHERE owner=? AND subject=? AND tokens=?",
        )
        .run(encoded, owner, c.subject, c.tokens);
      if (!result.changes)
        throw new StorageError(
          428,
          "drive_reconnect",
          "연결이 변경되었습니다. 다시 연결하세요.",
        );
      return fresh.access_token as string;
    })();
    refreshes.set(owner, pending);
    try {
      return await pending;
    } finally {
      refreshes.delete(owner);
    }
  }
  return {
    configured,
    connection,
    token,
    client: (owner: string) => new GoogleDriveClient(() => token(owner)),
    cancel: (owner: string, sessionHash: string, state: string) => {
      consume(owner, sessionHash, state);
    },
    start(owner: string, sessionHash: string) {
      if (!configured)
        throw new StorageError(
          503,
          "drive_unconfigured",
          "운영자가 Google OAuth 설정을 등록해야 합니다.",
        );
      const state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(32).toString("base64url");
      db.prepare("DELETE FROM drive_oauth WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO drive_oauth VALUES(?,?,?,?,?)").run(
        state,
        owner,
        sessionHash,
        verifier,
        Date.now() + 600000,
      );
      return (
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: callback,
          response_type: "code",
          scope: `openid email ${DRIVE_SCOPE}`,
          access_type: "offline",
          prompt: "consent select_account",
          state,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        })
      );
    },
    async finish(
      owner: string,
      sessionHash: string,
      state: string,
      code: string,
    ) {
      const pending = consume(owner, sessionHash, state);
      const t = await exchange({
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        code_verifier: pending.verifier,
      });
      if (!String(t.scope).split(" ").includes(DRIVE_SCOPE))
        throw new StorageError(
          403,
          "drive_permission",
          "Drive 파일 권한에 동의해야 합니다.",
        );
      const profile = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${t.access_token}` },
        },
      );
      if (!profile.ok)
        throw new StorageError(
          403,
          "google_identity",
          "Google 계정을 확인하지 못했습니다.",
        );
      const identity = (await profile.json()) as any;
      if (!identity.sub || !identity.email_verified)
        throw new StorageError(
          403,
          "google_identity",
          "인증된 Google 계정이 필요합니다.",
        );
      const old = connection(owner);
      if (old && old.subject !== identity.sub)
        throw new StorageError(
          409,
          "drive_account",
          "다른 Google 계정을 사용하려면 기존 Drive 연결을 먼저 해제하세요.",
        );
      if (!t.refresh_token && old)
        t.refresh_token = JSON.parse(cipher.decrypt(old.tokens)).refresh_token;
      if (!t.refresh_token)
        throw new StorageError(
          428,
          "drive_reconnect",
          "지속적인 저장을 위해 다시 연결하고 동의하세요.",
        );
      db.prepare(
        "INSERT INTO drive_connections(owner,subject,email,tokens) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET email=excluded.email,tokens=excluded.tokens,conditional=0",
      ).run(
        owner,
        identity.sub,
        identity.email,
        cipher.encrypt(
          JSON.stringify({ ...t, expires: Date.now() + t.expires_in * 1000 }),
        ),
      );
    },
    disconnect(owner: string) {
      db.prepare("DELETE FROM drive_connections WHERE owner=?").run(owner);
      db.prepare("DELETE FROM drive_oauth WHERE owner=?").run(owner);
    },
  };
}
