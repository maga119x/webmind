import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { fakeFactory } from "./fake-drive";
import { emptyMap } from "../shared/model";
describe("accounts and private storage", () => {
  let ctx: Awaited<ReturnType<typeof createApp>>, dir: string;
  const fake = fakeFactory();
  let revision = "";
  let cookieA = "",
    cookieB = "",
    mapId = "",
    assetURL = "";
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "webmind-test-"));
    ctx = await createApp({
      dataDir: dir,
      baseURL: "http://localhost:3000",
      test: true,
      driveFactory: fake.factory,
    });
    await ctx.app.ready();
  });
  afterAll(async () => {
    await ctx?.app.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const call = (method: any, url: string, cookie = "", payload?: any) =>
    ctx.app.inject({
      method,
      url,
      headers: {
        origin: "http://localhost:3000",
        cookie,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      payload,
    });
  async function account(email: string) {
    const res = await call("POST", "/api/auth/sign-up/email", "", {
      email,
      password: "test-password-12345",
      name: "Tester",
      callbackURL: "http://localhost:3000",
    });
    expect(res.statusCode, res.body).toBe(200);
    const mails = readFileSync(join(dir, "mailbox.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    const mail = mails.findLast((x) => x.to === email);
    const verify = await call(
      "GET",
      new URL(mail.url).pathname + new URL(mail.url).search,
    );
    expect(verify.statusCode).toBe(302);
    const login = await call("POST", "/api/auth/sign-in/email", "", {
      email,
      password: "test-password-12345",
    });
    expect(login.statusCode, login.body).toBe(200);
    return login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }
  it("rejects anonymous requests and unverified sign-in", async () => {
    expect((await call("GET", "/api/maps")).statusCode).toBe(401);
    await call("POST", "/api/auth/sign-up/email", "", {
      email: "unverified@example.com",
      password: "test-password-12345",
      name: "Unverified",
    });
    expect(
      (
        await call("POST", "/api/auth/sign-in/email", "", {
          email: "unverified@example.com",
          password: "test-password-12345",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("verifies emails and establishes separate sessions", async () => {
    cookieA = await account("alice@example.com");
    cookieB = await account("bob@example.com");
    expect(cookieA).not.toBe(cookieB);
  });
  it("creates a map and hides it from another account", async () => {
    const res = await call("POST", "/api/maps", cookieA, {
      title: "Private",
      document: emptyMap("Private"),
    });
    expect(res.statusCode, res.body).toBe(201);
    mapId = res.json().id;
    revision = res.json().revision;
    expect((await call("GET", "/api/maps", cookieB)).json()).toEqual([]);
    expect((await call("GET", `/api/maps/${mapId}`, cookieB)).statusCode).toBe(
      404,
    );
  });
  it("updates with compare-and-swap and rejects stale revisions", async () => {
    const doc = emptyMap("Updated");
    expect(
      (
        await call("PUT", `/api/maps/${mapId}`, cookieA, {
          title: "Updated",
          document: doc,
          revision,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call("PUT", `/api/maps/${mapId}`, cookieA, {
          title: "Stale",
          document: doc,
          revision,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call("GET", `/api/maps/${mapId}`, cookieA)).json().title,
    ).toBe("Updated");
  });
  it("rejects invalid tree and cross-origin writes", async () => {
    const m = emptyMap();
    m.nodes[m.root].children.push("missing");
    expect(
      (await call("POST", "/api/maps", cookieA, { title: "Bad", document: m }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/maps",
          headers: { origin: "https://attacker.example", cookie: cookieA },
          payload: { title: "Bad", document: emptyMap() },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("protects image bytes and rejects spoofed uploads", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/maps/${mapId}/assets`,
      headers: { cookie: cookieA, "content-type": "image/png" },
      payload: png,
    });
    expect(res.statusCode, res.body).toBe(201);
    assetURL = res.json().url;
    expect((await call("GET", assetURL, cookieB)).statusCode).toBe(404);
    expect((await call("GET", assetURL, cookieA)).statusCode).toBe(200);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/api/maps/${mapId}/assets`,
          headers: { cookie: cookieA, "content-type": "image/png" },
          payload: Buffer.from("<script>bad</script>"),
        })
      ).statusCode,
    ).toBe(400);
  });
  it("resets password using a single-use email token", async () => {
    const res = await call("POST", "/api/auth/request-password-reset", "", {
      email: "alice@example.com",
      redirectTo: "http://localhost:3000",
    });
    expect(res.statusCode, res.body).toBe(200);
    const mail = readFileSync(join(dir, "mailbox.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x))
      .findLast((x) => x.to === "alice@example.com");
    const redirect = await call(
      "GET",
      new URL(mail.url).pathname + new URL(mail.url).search,
    );
    const token = new URL(redirect.headers.location as string).searchParams.get(
      "token",
    );
    const body = { token, newPassword: "replacement-password-123" };
    expect(
      (await call("POST", "/api/auth/reset-password", "", body)).statusCode,
    ).toBe(200);
    expect(
      (await call("POST", "/api/auth/reset-password", "", body)).statusCode,
    ).not.toBe(200);
  });
  it("deletes map and attached files for the owner only", async () => {
    expect(
      (await call("DELETE", `/api/maps/${mapId}`, cookieB)).statusCode,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/maps/${mapId}`, cookieA)).statusCode,
    ).toBe(204);
    expect((await call("GET", assetURL, cookieA)).statusCode).toBe(404);
  });
});
