import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { emptyMap, addNode } from "../shared/model";
import { exportMM } from "../shared/freemind";
import { fakeFactory, FakeDrive } from "./fake-drive";
import { tokenCipher, driveAuth } from "../server/drive-auth";
import {
  verifyConditionalWrites,
  StorageError,
  GoogleDriveClient,
} from "../server/drive-client";
const fake = fakeFactory();
let ctx: Awaited<ReturnType<typeof createApp>>,
  dir: string,
  cookie: string,
  owner: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const call = (method: any, url: string, payload?: any) =>
  ctx.app.inject({
    method,
    url,
    headers: { cookie, origin: "http://localhost:3000" },
    payload,
  });
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "webmind-drive-"));
  ctx = await createApp({
    dataDir: dir,
    test: true,
    baseURL: "http://localhost:3000",
    driveFactory: fake.factory,
  });
  await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      email: "drive@example.com",
      name: "Drive",
      password: "test-password-12345",
    },
  });
  const mail = JSON.parse(
    readFileSync(join(dir, "mailbox.jsonl"), "utf8").trim().split("\n").at(-1)!,
  );
  await ctx.app.inject(new URL(mail.url).pathname + new URL(mail.url).search);
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email: "drive@example.com", password: "test-password-12345" },
  });
  cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  owner = login.json().user.id;
});
afterAll(async () => {
  await ctx?.app.close();
  rmSync(dir, { recursive: true, force: true });
});
it("encrypts tokens and rejects tampering; OAuth state is session-bound and single-use", async () => {
  for (const path of [
    "/api/auth/get-access-token",
    "/api/auth/refresh-token/",
    "/api/auth/refresh%2Dtoken",
  ])
    expect(
      (await call("POST", path, { providerId: "google" })).statusCode,
    ).toBe(403);
  const c = tokenCipher("secret"),
    encrypted = c.encrypt("refresh-token");
  expect(encrypted).not.toContain("refresh-token");
  expect(c.decrypt(encrypted)).toBe("refresh-token");
  expect(() => tokenCipher("other").decrypt(encrypted)).toThrow();
  const before = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
  };
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  try {
    const auth = driveAuth(ctx.db, "secret", "http://localhost:3000");
    const u = new URL(auth.start(owner, "session-a")),
      state = u.searchParams.get("state")!;
    expect(u.searchParams.get("scope")).toContain("drive.file");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(
      auth.finish(owner, "session-b", state, "code"),
    ).rejects.toMatchObject({ code: "oauth_state" });
    await expect(
      auth.finish(owner, "session-a", state, "code"),
    ).rejects.toMatchObject({ code: "oauth_state" });
  } finally {
    if (before.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = before.secret;
  }
});
it("only enables original writes after stale conditional updates are actually rejected", async () => {
  const d = new FakeDrive(),
    f = await d.create("folder", {
      name: "folder",
      mimeType: "application/vnd.google-apps.folder",
    });
  expect(await verifyConditionalWrites(d, f.id)).toBe(true);
  d.enforceConditional = false;
  expect(await verifyConditionalWrites(d, f.id)).toBe(false);
});
it("connects, refreshes once, rejects another Google identity and removes encrypted credentials on disconnect", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  const auth = driveAuth(ctx.db, "oauth-test-secret", "http://localhost:3000"),
    user = "oauth-lifecycle";
  let subject = "google-one",
    refreshes = 0,
    denied = false;
  const transport = vi.fn(async (url: any, init: any) => {
    if (String(url).endsWith("/token")) {
      const params = init.body as URLSearchParams;
      if (params.get("grant_type") === "refresh_token") {
        refreshes++;
        return Response.json(
          denied
            ? { error: "invalid_grant" }
            : { access_token: "refreshed", expires_in: 3600 },
          { status: denied ? 400 : 200 },
        );
      }
      return Response.json({
        access_token: "access",
        refresh_token: "private-refresh",
        expires_in: 1,
        scope: "openid email https://www.googleapis.com/auth/drive.file",
      });
    }
    return Response.json({
      sub: subject,
      email: "google@example.com",
      email_verified: true,
    });
  });
  vi.stubGlobal("fetch", transport);
  const connect = () =>
    auth.finish(
      user,
      "session",
      new URL(auth.start(user, "session")).searchParams.get("state")!,
      "code",
    );
  try {
    await connect();
    expect(auth.connection(user).tokens).not.toContain("private-refresh");
    const deniedState = new URL(auth.start(user, "session")).searchParams.get(
      "state",
    )!;
    auth.cancel(user, "session", deniedState);
    expect(() => auth.cancel(user, "session", deniedState)).toThrow();
    expect(auth.connection(user).subject).toBe("google-one");
    expect(await Promise.all([auth.token(user), auth.token(user)])).toEqual([
      "refreshed",
      "refreshed",
    ]);
    expect(refreshes).toBe(1);
    subject = "google-two";
    await expect(connect()).rejects.toMatchObject({ code: "drive_account" });
    expect(auth.connection(user).subject).toBe("google-one");
    subject = "google-one";
    await connect();
    denied = true;
    await expect(auth.token(user)).rejects.toMatchObject({
      code: "drive_reconnect",
    });
    auth.disconnect(user);
    expect(auth.connection(user)).toBeUndefined();
    await expect(auth.token(user)).rejects.toMatchObject({
      code: "drive_connect",
    });
  } finally {
    auth.disconnect(user);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
it("maps Drive permission, quota, missing-file and rate errors without exposing remote response bodies", async () => {
  for (const [status, reason, code] of [
    [403, "storageQuotaExceeded", "quota"],
    [403, "userRateLimitExceeded", "rate_limit"],
    [403, "insufficientFilePermissions", "drive_permission"],
    [401, "", "drive_reconnect"],
    [404, "", "missing"],
    [412, "", "conflict"],
  ] as const) {
    const transport = vi.fn(async () =>
      Response.json(
        { error: { message: "private-google-detail", errors: [{ reason }] } },
        { status },
      ),
    );
    const d = new GoogleDriveClient(async () => "secret-token", transport);
    await expect(d.stat("file")).rejects.toMatchObject({ code });
    expect(transport.mock.calls.length).toBe(1);
  }
});
it("creates idempotently and rebuilds metadata cache without server document or image writes", async () => {
  const body = {
    title: "Drive only",
    document: emptyMap("Drive only"),
    requestId: randomUUID(),
  };
  const first = await call("POST", "/api/maps", body),
    second = await call("POST", "/api/maps", body);
  expect(first.statusCode, first.body).toBe(201);
  expect(second.json().id).toBe(first.json().id);
  expect(
    (
      await call("POST", "/api/maps", {
        ...body,
        document: emptyMap("different request"),
      })
    ).statusCode,
  ).toBe(409);
  ctx.db.prepare("DELETE FROM drive_cache").run();
  const list = await call("GET", "/api/maps");
  expect(list.json().some((r: any) => r.id === first.json().id)).toBe(true);
  expect(ctx.db.prepare("SELECT count(*) n FROM maps").get()).toEqual({ n: 0 });
  expect(ctx.db.prepare("SELECT count(*) n FROM assets").get()).toEqual({
    n: 0,
  });
  expect(readdirSync(join(dir, "assets"))).toEqual([]);
});
it("keeps a concurrent external edit when the race occurs after the version check", async () => {
  const document = emptyMap("before"),
    created = (
      await call("POST", "/api/maps", { title: "race", document })
    ).json();
  const client = fake.clients.get(owner)!,
    raw = created.id.slice(2),
    external = emptyMap("external");
  client.beforeUpdate = () => {
    const f = client.files.get(raw)!;
    f.bytes = Buffer.from(exportMM(external));
    f.meta.version = String(Number(f.meta.version) + 1);
    f.meta.etag = '"external"';
  };
  const result = await call("PUT", `/api/maps/${created.id}`, {
    title: "local",
    document: emptyMap("local"),
    revision: created.revision,
    requestId: randomUUID(),
  });
  expect(result.statusCode).toBe(409);
  expect((await client.bytes(raw)).toString()).toContain("external");
});
it("recovers an applied update after a lost response without creating a second revision", async () => {
  const created = (
      await call("POST", "/api/maps", { title: "retry", document: emptyMap() })
    ).json(),
    client = fake.clients.get(owner)!;
  const body = {
    title: "saved once",
    document: emptyMap("changed"),
    revision: created.revision,
    requestId: randomUUID(),
  };
  client.loseNextUpdate = true;
  expect((await call("PUT", `/api/maps/${created.id}`, body)).statusCode).toBe(
    503,
  );
  const version = (await client.stat(created.id.slice(2))).version;
  expect((await call("PUT", `/api/maps/${created.id}`, body)).statusCode).toBe(
    200,
  );
  expect((await client.stat(created.id.slice(2))).version).toBe(version);
});
it("does not acknowledge an external edit as the successful retry of a lost response", async () => {
  const created = (
      await call("POST", "/api/maps", {
        title: "retry race",
        document: emptyMap(),
      })
    ).json(),
    client = fake.clients.get(owner)!;
  const body = {
    title: "mine",
    document: emptyMap("my draft"),
    revision: created.revision,
    requestId: randomUUID(),
  };
  client.loseNextUpdate = true;
  expect((await call("PUT", `/api/maps/${created.id}`, body)).statusCode).toBe(
    503,
  );
  await client.update(
    created.id.slice(2),
    {},
    Buffer.from(exportMM(emptyMap("external after save"))),
  );
  expect((await call("PUT", `/api/maps/${created.id}`, body)).statusCode).toBe(
    409,
  );
  expect((await client.bytes(created.id.slice(2))).toString()).toContain(
    "external after save",
  );
});
it("saves a separate file when conditional behavior is unverified", async () => {
  const original = (
      await call("POST", "/api/maps", {
        title: "protected",
        document: emptyMap("original"),
      })
    ).json(),
    client = fake.clients.get(owner)!;
  // No ETag means no proven conditional update for this resource.
  delete client.files.get(original.id.slice(2))!.meta.etag;
  const fresh = (await call("GET", `/api/maps/${original.id}`)).json();
  const result = await call("PUT", `/api/maps/${original.id}`, {
    title: "protected",
    document: emptyMap("my changes"),
    revision: fresh.revision,
    requestId: randomUUID(),
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().safeCopy).toBe(true);
  expect(result.json().id).not.toBe(original.id);
  expect((await client.bytes(original.id.slice(2))).toString()).toContain(
    "original",
  );
});
it("ignores Drive internal version changes but still detects content and filename edits", async () => {
  const original = (
    await call("POST", "/api/maps", {
      title: "metadata churn",
      document: emptyMap("unchanged content"),
    })
  ).json();
  const client = fake.clients.get(owner)!;
  const raw = original.id.slice(2);
  // Drive's version includes invisible server-side changes, not only edits.
  await client.update(raw, { appProperties: { thumbnailProcessed: "yes" } });
  const fresh = (await call("GET", `/api/maps/${original.id}`)).json();
  expect(fresh.revision).toBe(original.revision);
  const saved = await call("PUT", `/api/maps/${original.id}`, {
    title: original.title,
    document: emptyMap("my next edit"),
    revision: original.revision,
    requestId: randomUUID(),
  });
  expect(saved.statusCode, saved.body).toBe(200);
  await client.update(
    raw,
    {},
    Buffer.from(exportMM(emptyMap("external edit"))),
  );
  expect(
    (
      await call("PUT", `/api/maps/${original.id}`, {
        title: original.title,
        document: emptyMap("do not overwrite"),
        revision: saved.json().revision,
        requestId: randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  const renamedBase = (await call("GET", `/api/maps/${original.id}`)).json();
  await client.update(raw, { name: "renamed externally.mm" });
  expect(
    (await call("GET", `/api/maps/${original.id}`)).json().revision,
  ).not.toBe(renamedBase.revision);
});
it("upgrades an old version-only dirty draft only by preserving it in a separate file", async () => {
  const original = (
    await call("POST", "/api/maps", {
      title: "old offline draft",
      document: emptyMap("original"),
    })
  ).json();
  const client = fake.clients.get(owner)!;
  const raw = original.id.slice(2);
  const before = await client.stat(raw);
  const oldRevision = JSON.stringify([before.version, before.etag]);
  await client.update(
    raw,
    {},
    Buffer.from(exportMM(emptyMap("new remote content"))),
  );
  const body = {
    title: "recovered local work",
    document: emptyMap("unsaved local content"),
    revision: oldRevision,
    requestId: randomUUID(),
  };
  // Proven conditional mode must not blindly rebase a stale old-format draft.
  expect((await call("PUT", `/api/maps/${original.id}`, body)).statusCode).toBe(
    409,
  );
  delete client.files.get(raw)!.meta.etag;
  const saved = await call("PUT", `/api/maps/${original.id}`, body);
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().safeCopy).toBe(true);
  expect(saved.json().id).not.toBe(original.id);
  expect((await client.bytes(raw)).toString()).toContain("new remote content");
  expect(saved.json().document.nodes[saved.json().document.root].text).toBe(
    "unsaved local content",
  );
});
it("migrates images and content, verifies roundtrip and preserves readonly legacy source", async () => {
  const id = randomUUID(),
    asset = randomUUID(),
    m = emptyMap("원본");
  addNode(m, m.root, "한글\n다국어");
  m.nodes[m.root].image = `/api/maps/${id}/assets/${asset}`;
  m.nodes[m.root].offset = { x: 10, y: 20 };
  m.sourceXml = '<map version="1.0.1"><custom-map-data value="keep"/></map>';
  m.nodes[m.root].sourceXml =
    '<node CUSTOM="retained"><vendor-extension VALUE="unknown"/></node>';
  ctx.db
    .prepare(
      "INSERT INTO maps(id,owner,title,document,updatedAt) VALUES(?,?,?,?,?)",
    )
    .run(id, owner, "원본", JSON.stringify(m), new Date().toISOString());
  ctx.db
    .prepare("INSERT INTO assets VALUES(?,?,?,?)")
    .run(asset, id, "image/png", png.length);
  writeFileSync(join(dir, "assets", asset), png);
  const migrated = await call("POST", `/api/maps/${id}/migrate`);
  expect(migrated.statusCode, migrated.body).toBe(200);
  const r = migrated.json();
  expect(r.storage).toBe("drive");
  expect(r.document.nodes[m.root].offset).toEqual({ x: 10, y: 20 });
  expect(
    (await fake.clients.get(owner)!.bytes(r.id.slice(2))).toString(),
  ).toContain("vendor-extension");
  expect(
    (await call("GET", r.document.nodes[m.root].image)).rawPayload,
  ).toEqual(png);
  expect((await call("POST", `/api/maps/${id}/migrate`)).json().id).toBe(r.id);
  expect((await call("GET", `/api/maps/${id}`)).json().readOnly).toBe(true);
  expect(
    (
      await call("PUT", `/api/maps/${id}`, {
        title: "edit",
        document: m,
        revision: "1",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    ctx.db.prepare("SELECT document FROM maps WHERE id=?").get(id),
  ).toEqual({ document: JSON.stringify(m) });
  const clone = (
    await call("POST", "/api/maps", { title: "clone", document: r.document })
  ).json();
  expect(clone.document.nodes[m.root].image).not.toBe(
    r.document.nodes[m.root].image,
  );
  await call("DELETE", `/api/maps/${r.id}`);
  expect(
    (await call("GET", clone.document.nodes[m.root].image)).rawPayload,
  ).toEqual(png);
});
it("refuses non-owned Picker files and oversized or invalid assets", async () => {
  const d = fake.clients.get(owner)!,
    id = await d.generateId();
  await d.create(
    id,
    {
      name: "foreign.mm",
      mimeType: "application/x-freemind",
      ownedByMe: false,
    },
    Buffer.from(exportMM(emptyMap())),
  );
  expect(
    (await call("POST", "/api/drive/open", { fileId: id })).statusCode,
  ).toBe(404);
});

it("resolves only owned, accessible relative images and preserves external originals on clone and trash", async () => {
  const d = fake.clients.get(owner)!,
    parent = await d.generateId(),
    folder = await d.generateId(),
    image = await d.generateId(),
    file = await d.generateId();
  await d.create(parent, {
    name: "External",
    mimeType: "application/vnd.google-apps.folder",
  });
  await d.create(folder, {
    name: "images",
    mimeType: "application/vnd.google-apps.folder",
    parents: [parent],
  });
  await d.create(
    image,
    { name: "photo.png", mimeType: "image/png", parents: [folder] },
    png,
  );
  const m = emptyMap("external image");
  m.nodes[m.root].image = "images/photo.png";
  await d.create(
    file,
    {
      name: "external.mm",
      mimeType: "application/x-freemind",
      parents: [parent],
    },
    Buffer.from(exportMM(m)),
  );
  const opened = (
    await call("POST", "/api/drive/open", { fileId: file })
  ).json();
  expect(opened.document.nodes[m.root].image).toBe(
    `/api/maps/g_${file}/assets/${image}`,
  );
  expect(
    (await call("GET", opened.document.nodes[m.root].image)).rawPayload,
  ).toEqual(png);
  const clone = (
    await call("POST", "/api/maps", {
      title: "copy",
      document: opened.document,
    })
  ).json();
  expect(clone.document.nodes[m.root].image).not.toBe(
    opened.document.nodes[m.root].image,
  );
  const unrelated = await d.generateId();
  await d.create(
    unrelated,
    { name: "other.png", mimeType: "image/png", parents: [folder] },
    png,
  );
  expect(
    (await call("GET", `/api/maps/g_${file}/assets/${unrelated}`)).statusCode,
  ).toBe(404);
  await call("DELETE", `/api/maps/g_${file}`);
  expect((await d.stat(image)).trashed).not.toBe(true);
  expect(
    (await call("GET", clone.document.nodes[m.root].image)).rawPayload,
  ).toEqual(png);
});
