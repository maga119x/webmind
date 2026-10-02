import { it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
it("serves the production build with CSP and never exposes the development mailbox", async () => {
  const before = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "webmind-prod-"));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      AUTH_SECRET: "test-only-production-secret-01234567890123456789",
      SMTP_HOST: "localhost",
      APP_URL: "https://mind.example.com",
    });
    app = await createApp({ dataDir: dir, test: true });
    const health = await app.app.inject("/api/health");
    expect(health.statusCode).toBe(200);
    expect(health.headers["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    expect((await app.app.inject("/api/dev/mailbox")).statusCode).toBe(404);
    expect((await app.app.inject("/api/maps")).statusCode).toBe(401);
    const root = await app.app.inject("/");
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("WebMind");
  } finally {
    await app?.app.close();
    process.env = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
it("runs without SMTP only when email auth is explicitly disabled, and never writes development mail", async () => {
  const before = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "webmind-local-only-"));
  let ctx: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      AUTH_SECRET: "test-production-local-secret-01234567890123456789",
      APP_URL: "https://mind.example.com",
      EMAIL_AUTH_ENABLED: "false",
    });
    delete process.env.SMTP_HOST;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    ctx = await createApp({ dataDir: dir, test: true });
    expect((await ctx.app.inject("/api/config")).json()).toEqual({
      googleLogin: false,
      emailAuthEnabled: false,
    });
    for (const url of [
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email",
      "/api/auth/request-password-reset",
    ]) {
      const response = await ctx.app.inject({
        method: "POST",
        url,
        payload: {
          email: "disabled@example.com",
          password: "never-created-123",
          name: "Disabled",
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("email_auth_disabled");
    }
    expect((await ctx.app.inject("/api/dev/mailbox")).statusCode).toBe(404);
    expect(existsSync(join(dir, "mailbox.jsonl"))).toBe(false);
    expect(ctx.db.prepare("SELECT count(*) n FROM user").get()).toEqual({
      n: 0,
    });
    process.env.EMAIL_AUTH_ENABLED = "true";
    await expect(createApp({ dataDir: dir, test: true })).rejects.toThrow(
      "SMTP_HOST",
    );
  } finally {
    await ctx?.app.close();
    process.env = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
