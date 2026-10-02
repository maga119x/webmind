import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DOMParser } from "@xmldom/xmldom";
import { validateMap, type MindMap } from "../shared/model";
import { importMM, exportMM } from "../shared/freemind";
import { driveAuth } from "./drive-auth";
import { DriveStore, digest, validImage } from "./drive-store";
import {
  StorageError,
  verifyConditionalWrites,
  type DriveClient,
} from "./drive-client";
export type DriveFactory = (owner: string) => {
  client: DriveClient;
  subject: string;
  conditional: boolean;
};
export function registerStorage(
  app: FastifyInstance,
  db: Database.Database,
  dataDir: string,
  secret: string,
  baseURL: string,
  session: (req: any, reply: any) => Promise<string | null>,
  sessionId: (req: any) => Promise<string>,
  testFactory?: DriveFactory,
  emailAuthEnabled = true,
) {
  const auth = driveAuth(db, secret, baseURL);
  db.exec(`CREATE TABLE IF NOT EXISTS drive_cache(owner TEXT NOT NULL,subject TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,revision TEXT NOT NULL,updatedAt TEXT NOT NULL,PRIMARY KEY(owner,subject,id));
    CREATE TABLE IF NOT EXISTS drive_operations(owner TEXT NOT NULL,subject TEXT NOT NULL,key TEXT NOT NULL,fileId TEXT NOT NULL,PRIMARY KEY(owner,subject,key));
    CREATE TABLE IF NOT EXISTS drive_migrations(owner TEXT NOT NULL,legacyId TEXT NOT NULL,driveId TEXT NOT NULL,subject TEXT NOT NULL,verifiedAt TEXT NOT NULL,PRIMARY KEY(owner,legacyId));
    PRAGMA user_version=2;`);
  const locks = new Map<string, Promise<unknown>>();
  async function serial<T>(owner: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(owner) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    locks.set(owner, next);
    try {
      return await next;
    } finally {
      if (locks.get(owner) === next) locks.delete(owner);
    }
  }
  const owned = (id: string, owner: string) =>
    db
      .prepare("SELECT * FROM maps WHERE id=? AND owner=?")
      .get(id, owner) as any;
  const legacy = (r: any) => ({
    id: r.id,
    storage: "legacy" as const,
    title: r.title,
    revision: String(r.revision),
    updatedAt: r.updatedAt,
    document: JSON.parse(r.document),
    readOnly: true,
  });
  async function oldAsset(owner: string, url: string) {
    const match = url.match(/^\/api\/maps\/([^/]+)\/assets\/([\w-]+)$/);
    const a = match
      ? (db
          .prepare(
            "SELECT a.* FROM assets a JOIN maps m ON m.id=a.mapId WHERE a.id=? AND a.mapId=? AND m.owner=?",
          )
          .get(match[2], match[1], owner) as any)
      : null;
    if (!a)
      throw new StorageError(404, "missing", "첨부파일을 찾을 수 없습니다.");
    return { bytes: readFileSync(join(dataDir, "assets", a.id)), mime: a.mime };
  }
  function store(owner: string) {
    const test = testFactory?.(owner),
      c = test
        ? { subject: test.subject, conditional: test.conditional ? 1 : 0 }
        : auth.connection(owner);
    if (!c)
      throw new StorageError(
        428,
        "drive_connect",
        "Google Drive를 연결하거나 로컬 문서로 저장하세요.",
      );
    return new DriveStore(
      db,
      owner,
      test?.client ?? auth.client(owner),
      c,
      (url) => oldAsset(owner, url),
    );
  }
  const body = z.object({
    title: z.string().trim().min(1).max(200),
    document: z.unknown(),
    revision: z.union([z.string(), z.number()]).optional(),
    requestId: z.string().uuid().optional(),
  });
  function parsed(value: unknown) {
    const b = body.parse(value);
    try {
      return {
        ...b,
        document: validateMap(b.document),
        requestId: b.requestId ?? randomUUID(),
      };
    } catch {
      throw new StorageError(
        400,
        "invalid_document",
        "잘못된 문서 트리입니다.",
      );
    }
  }
  app.get("/api/drive/status", async (req, reply) => {
    // Configuration can be shown before sign-in, but identity requires a session.
    const owner = await session(req, reply);
    if (!owner) return;
    const c = auth.connection(owner),
      test = testFactory?.(owner);
    return {
      configured: auth.configured,
      googleLogin: auth.configured,
      pickerConfigured: !!(
        process.env.GOOGLE_PICKER_API_KEY && process.env.GOOGLE_PROJECT_NUMBER
      ),
      connected: !!(c || test),
      email: c?.email ?? (test ? "Test Drive" : undefined),
      conditionalVerified: !!(c?.conditional || test?.conditional),
    };
  });
  app.get("/api/config", async () => ({
    googleLogin: auth.configured,
    emailAuthEnabled,
  }));
  app.post("/api/drive/connect", async (req, reply) => {
    const owner = await session(req, reply);
    if (owner) return { url: auth.start(owner, await sessionId(req)) };
  });
  app.get("/api/drive/callback", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    const q = req.query as any;
    try {
      if (q.error) {
        auth.cancel(owner, await sessionId(req), String(q.state ?? ""));
        return reply.redirect("/?driveError=permission_denied");
      }
      await serial(owner, async () => {
        await auth.finish(
          owner,
          await sessionId(req),
          String(q.state ?? ""),
          String(q.code ?? ""),
        );
        const s = store(owner),
          folder = await s.folder();
        const verified = await verifyConditionalWrites(s.client, folder);
        db.prepare(
          "UPDATE drive_connections SET conditional=? WHERE owner=?",
        ).run(verified ? 1 : 0, owner);
      });
      return reply.redirect("/?driveConnected=1");
    } catch (e) {
      app.log.warn(
        { code: e instanceof StorageError ? e.code : "oauth_failed" },
        "Drive connection failed",
      );
      return reply.redirect("/?driveError=connection_failed");
    }
  });
  app.post("/api/drive/disconnect", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    return serial(owner, async () => {
      auth.disconnect(owner);
      db.prepare("DELETE FROM drive_cache WHERE owner=?").run(owner);
      return { connected: false };
    });
  });
  app.post("/api/drive/picker-token", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    if (
      !process.env.GOOGLE_PICKER_API_KEY ||
      !process.env.GOOGLE_PROJECT_NUMBER
    )
      throw new StorageError(
        503,
        "picker_unconfigured",
        "Google Picker 설정이 필요합니다.",
      );
    return {
      accessToken: await auth.token(owner),
      apiKey: process.env.GOOGLE_PICKER_API_KEY,
      appId: process.env.GOOGLE_PROJECT_NUMBER,
    };
  });
  app.post("/api/drive/open", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    const b = z
      .object({ fileId: z.string().regex(/^[\w-]+$/) })
      .parse(req.body);
    return serial(owner, () => store(owner).open(b.fileId));
  });
  app.get("/api/maps", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    const old = (
      db
        .prepare("SELECT id,title,revision,updatedAt FROM maps WHERE owner=?")
        .all(owner) as any[]
    ).map((r) => ({
      ...r,
      storage: "legacy",
      revision: String(r.revision),
      readOnly: true,
    }));
    if (!auth.connection(owner) && !testFactory) return old;
    return [...(await store(owner).list()), ...old];
  });
  app.post("/api/maps", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    const b = parsed(req.body);
    const r = await serial(owner, () =>
      store(owner).create(b.title, b.document, b.requestId),
    );
    return reply.code(201).send(r);
  });
  app.get<{ Params: { id: string } }>("/api/maps/:id", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    if (req.params.id.startsWith("g_")) return store(owner).get(req.params.id);
    const r = owned(req.params.id, owner);
    if (!r) throw new StorageError(404, "missing", "문서를 찾을 수 없습니다.");
    return legacy(r);
  });
  app.put<{ Params: { id: string } }>("/api/maps/:id", async (req, reply) => {
    const owner = await session(req, reply);
    if (!owner) return;
    if (!req.params.id.startsWith("g_"))
      throw new StorageError(
        409,
        "legacy_readonly",
        "이전 서버 문서는 읽기 전용입니다. Drive로 이전하거나 로컬 복사본을 만드세요.",
      );
    const b = parsed(req.body);
    return serial(owner, () =>
      store(owner).save(
        req.params.id,
        b.title,
        b.document,
        String(b.revision ?? ""),
        b.requestId,
      ),
    );
  });
  app.delete<{ Params: { id: string } }>(
    "/api/maps/:id",
    async (req, reply) => {
      const owner = await session(req, reply);
      if (!owner) return;
      if (!req.params.id.startsWith("g_"))
        throw new StorageError(
          409,
          "legacy_readonly",
          "보관 중인 서버 원본은 삭제하지 않습니다.",
        );
      await serial(owner, () => store(owner).trash(req.params.id));
      return reply.code(204).send();
    },
  );
  app.addContentTypeParser(
    ["image/png", "image/jpeg", "image/webp", "image/gif"],
    { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
  app.post<{ Params: { id: string } }>(
    "/api/maps/:id/assets",
    async (req, reply) => {
      const owner = await session(req, reply);
      if (!owner) return;
      const mime = String(req.headers["content-type"] ?? "").split(";")[0],
        b = req.body;
      if (!Buffer.isBuffer(b) || !validImage(b, mime))
        throw new StorageError(400, "image", "지원하지 않는 이미지입니다.");
      if (!req.params.id.startsWith("g_"))
        throw new StorageError(
          409,
          "legacy_readonly",
          "서버 원본은 읽기 전용입니다.",
        );
      const result = await serial(owner, () =>
        store(owner).upload(req.params.id, b, mime),
      );
      return reply.code(201).send(result);
    },
  );
  app.get<{ Params: { id: string; asset: string } }>(
    "/api/maps/:id/assets/:asset",
    async (req, reply) => {
      const owner = await session(req, reply);
      if (!owner) return;
      const r = req.params.id.startsWith("g_")
        ? await store(owner).asset(req.params.id, req.params.asset)
        : await oldAsset(
            owner,
            `/api/maps/${req.params.id}/assets/${req.params.asset}`,
          );
      return reply.type(r.mime).send(r.bytes);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/maps/:id/assets/relink",
    async (req, reply) => {
      const owner = await session(req, reply);
      if (!owner) return;
      const b = z
        .object({ fileId: z.string().regex(/^[\w-]+$/) })
        .parse(req.body);
      return serial(owner, async () => {
        const s = store(owner),
          file = await s.file(b.fileId),
          bytes = await s.client.bytes(file.id, 5 * 1024 * 1024);
        return s.upload(req.params.id, bytes, file.mimeType);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/maps/:id/migrate",
    async (req, reply) => {
      const owner = await session(req, reply);
      if (!owner) return;
      return serial(owner, async () => {
        const original = owned(req.params.id, owner);
        if (!original)
          throw new StorageError(
            404,
            "missing",
            "이전할 서버 문서가 없습니다.",
          );
        const s = store(owner);
        const subject =
          testFactory?.(owner).subject ?? auth.connection(owner).subject;
        const migrated = db
          .prepare(
            "SELECT driveId FROM drive_migrations WHERE owner=? AND legacyId=? AND subject=?",
          )
          .get(owner, original.id, subject) as { driveId: string } | undefined;
        if (migrated) return s.get(migrated.driveId);
        const record = await s.create(
          original.title,
          JSON.parse(original.document),
          "migration-" + original.id,
          original.id,
        );
        const expected = JSON.parse(original.document) as MindMap,
          actual = structuredClone(record.document);
        async function fingerprint(m: MindMap) {
          for (const n of Object.values(m.nodes))
            if (n.image?.startsWith("/api/maps/")) {
              const match = n.image.match(
                /^\/api\/maps\/([^/]+)\/assets\/([\w-]+)$/,
              )!;
              const data = match[1].startsWith("g_")
                ? await s.asset(match[1], match[2])
                : await oldAsset(owner!, n.image);
              n.image = "hash:" + digest(data.bytes);
            }
          const normalized = importMM(exportMM(m));
          const xml = (source?: string) => {
            if (!source) return null;
            const element = new DOMParser().parseFromString(
              source,
              "application/xml",
            ).documentElement;
            const known: Record<string, string[]> = {
              node: [
                "ID",
                "TEXT",
                "POSITION",
                "FOLDED",
                "WEBMIND_DX",
                "WEBMIND_DY",
                "COLOR",
                "BACKGROUND_COLOR",
                "STYLE",
                "LINK",
              ],
              font: ["NAME", "SIZE", "BOLD", "ITALIC"],
              edge: ["COLOR", "WIDTH", "STYLE"],
              arrowlink: ["ID", "DESTINATION", "COLOR"],
              icon: ["BUILTIN"],
            };
            const tree = (n: any): unknown =>
              n.nodeType === 1
                ? [
                    n.nodeName,
                    Array.from(n.attributes as ArrayLike<any>)
                      .filter((a) => !known[n.nodeName]?.includes(a.name))
                      .map((a) => [a.name, a.value])
                      .sort(([a], [b]) => a.localeCompare(b)),
                    Array.from(n.childNodes as ArrayLike<any>)
                      .filter((c) => c.nodeType === 1 || !!c.nodeValue?.trim())
                      .map(tree),
                  ]
                : [n.nodeType, n.nodeValue];
            return tree(element);
          };
          return JSON.stringify({
            root: normalized.root,
            extensions: xml(normalized.sourceXml),
            nodes: Object.keys(normalized.nodes)
              .sort()
              .map((id) => {
                const { sourceXml, ...n } = normalized.nodes[id];
                return { ...n, extensions: xml(sourceXml) };
              }),
            arrows: normalized.arrows,
          });
        }
        if ((await fingerprint(expected)) !== (await fingerprint(actual)))
          throw new StorageError(
            409,
            "migration_verify",
            "복사본 검증에 실패했습니다. 서버 원본이 보존되어 있습니다.",
          );
        db.prepare(
          "INSERT INTO drive_migrations VALUES(?,?,?,?,?) ON CONFLICT(owner,legacyId) DO UPDATE SET driveId=excluded.driveId,subject=excluded.subject,verifiedAt=excluded.verifiedAt",
        ).run(owner, original.id, record.id, subject, new Date().toISOString());
        return record;
      });
    },
  );
  return { store, auth };
}
