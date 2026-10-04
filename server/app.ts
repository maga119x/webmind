import Fastify, { LogController } from "fastify";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import Database from "better-sqlite3";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import nodemailer from "nodemailer";
import {
  mkdirSync,
  existsSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  copyFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { registerStorage, type DriveFactory } from "./storage";
import { StorageError } from "./drive-client";

export async function createApp(
  opts: {
    dataDir?: string;
    baseURL?: string;
    test?: boolean;
    driveFactory?: DriveFactory;
  } = {},
) {
  const dataDir = resolve(opts.dataDir ?? process.env.DATA_DIR ?? "data");
  mkdirSync(join(dataDir, "assets"), { recursive: true });
  const prod = process.env.NODE_ENV === "production";
  const emailAuthEnabled = process.env.EMAIL_AUTH_ENABLED !== "false";
  const baseURL =
    opts.baseURL ?? process.env.APP_URL ?? "http://localhost:5173";
  if (
    prod &&
    (!process.env.AUTH_SECRET ||
      process.env.AUTH_SECRET.length < 32 ||
      process.env.AUTH_SECRET.startsWith("replace-") ||
      (emailAuthEnabled && !process.env.SMTP_HOST) ||
      !baseURL.startsWith("https://"))
  )
    throw Error(
      "Production requires HTTPS APP_URL, random AUTH_SECRET (32+ characters), and SMTP_HOST when email auth is enabled",
    );
  const secretFile = join(dataDir, ".dev-secret");
  if (!prod && !existsSync(secretFile))
    writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  const db = new Database(join(dataDir, "webmind.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;
  const sendMail = async (to: string, subject: string, url: string) => {
    if (prod && !transport) throw Error("Email delivery is disabled");
    if (transport)
      await transport.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text: `${subject}\n\n${url}`,
      });
    else
      appendFileSync(
        join(dataDir, "mailbox.jsonl"),
        JSON.stringify({ to, subject, url, time: new Date().toISOString() }) +
          "\n",
        { mode: 0o600 },
      );
  };
  const authOptions = {
    database: db,
    baseURL,
    secret: process.env.AUTH_SECRET ?? readFileSync(secretFile, "utf8"),
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: emailAuthEnabled,
      requireEmailVerification: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) =>
        sendMail(user.email, "WebMind 비밀번호 재설정", url),
    },
    emailVerification: {
      sendOnSignUp: emailAuthEnabled,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendMail(user.email, "WebMind 이메일 인증", url),
    },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    rateLimit: { enabled: !opts.test, window: 60, max: 20 },
    advanced: { cookiePrefix: "webmind" },
  } satisfies BetterAuthOptions;
  const migrations = await getMigrations(authOptions);
  await migrations.runMigrations();
  const auth = betterAuth(authOptions);
  db.exec(`CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, document TEXT NOT NULL, updatedAt TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS maps_owner_updated ON maps(owner,updatedAt);
 CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,mapId TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,mime TEXT NOT NULL,size INTEGER NOT NULL);
`);
  if (opts.driveFactory && !opts.test)
    throw Error("Injected Drive is test-only");
  const app = Fastify({
    logger: !opts.test,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof StorageError)
      return reply.code(e.statusCode).send({ error: e.message, code: e.code });
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        error: "Invalid document",
        details: e.issues.map((x) => x.message),
      });
    if (e.statusCode)
      return reply.code(e.statusCode).send({ error: e.message });
    app.log.error({ name: e?.name ?? "Error" }, "Request failed");
    return reply.code(400).send({ error: "Request could not be processed" });
  });
  await app.register(rateLimit, {
    max: opts.test ? 10000 : 180,
    timeWindow: "1 minute",
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      // Picker validates its website-restricted key against the embedding origin.
      // Cross-origin requests must include the origin, without paths or queries.
      .header("Referrer-Policy", "strict-origin-when-cross-origin")
      .header("X-Frame-Options", "DENY");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (prod)
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src https://docs.google.com https://drive.google.com https://accounts.google.com; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
      );
    return payload;
  });
  app.addHook("preHandler", async (req, reply) => {
    if (
      req.url.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      const origin = req.headers.origin;
      if (origin && origin !== new URL(baseURL).origin)
        return reply.code(403).send({ error: "Origin rejected" });
    }
  });
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const url = new URL(req.raw.url!, baseURL);
      const authPath = decodeURIComponent(url.pathname).replace(/\/+$/, "");
      if (
        !emailAuthEnabled &&
        /^\/api\/auth\/(sign-in\/email|sign-up\/email|request-password-reset|reset-password|send-verification-email|verify-email|change-password|set-password)$/.test(
          authPath,
        )
      )
        return reply
          .code(503)
          .send({
            error: "Email sign-in is not available",
            code: "email_auth_disabled",
          });
      if (
        ["/api/auth/get-access-token", "/api/auth/refresh-token"].includes(
          authPath,
        )
      )
        return reply
          .code(403)
          .send({ error: "Use the scoped Drive picker endpoint" });
      const headers = fromNodeHeaders(req.headers);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers,
          body: req.method === "GET" ? undefined : JSON.stringify(req.body),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((v, k) => {
        if (k !== "set-cookie") reply.header(k, v);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(await response.text());
    },
  });
  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));
  const session = async (req: any, reply: any) => {
    const s = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!s?.user.emailVerified) {
      reply.code(401).send({ error: "Sign in required" });
      return null;
    }
    return s.user.id;
  };
  registerStorage(
    app,
    db,
    dataDir,
    authOptions.secret,
    baseURL,
    session,
    async (req) => {
      const s = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      return s?.session.id ?? "";
    },
    opts.driveFactory,
    emailAuthEnabled,
  );
  if (!prod)
    app.get("/api/dev/mailbox", async () =>
      existsSync(join(dataDir, "mailbox.jsonl"))
        ? readFileSync(join(dataDir, "mailbox.jsonl"), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((x) => JSON.parse(x))
        : [],
    );
  const clientDir = resolve("dist/client");
  if (existsSync(clientDir)) {
    await app.register(serveStatic, { root: clientDir, index: ["index.html"] });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    transport?.close();
    db.close();
  });
  return { app, db, auth, dataDir };
}
