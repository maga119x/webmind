import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { importMM, exportMM } from "../shared/freemind";
import {
  validateMap,
  emptyMap,
  type MapRecord,
  type MindMap,
} from "../shared/model";
import {
  FOLDER,
  StorageError,
  propertyQuery,
  escapeQuery,
  type DriveClient,
  type DriveFile,
} from "./drive-client";
export const driveId = (id: string) => {
  if (!/^g_[\w-]+$/.test(id))
    throw new StorageError(404, "missing", "문서를 찾을 수 없습니다.");
  return id.slice(2);
};
export const publicId = (id: string) => "g_" + id;
export const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export const imageExt = (mime: string) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  })[mime] ?? "bin";
export function validImage(b: Buffer, mime: string) {
  return (
    b.length <= 5 * 1024 * 1024 &&
    (mime === "image/png"
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : mime === "image/gif"
          ? /^GIF8[79]a/.test(b.subarray(0, 6).toString())
          : mime === "image/webp"
            ? b.subarray(0, 4).toString() === "RIFF" &&
              b.subarray(8, 12).toString() === "WEBP"
            : false)
  );
}
const revision = (f: DriveFile) => JSON.stringify([f.version, f.etag ?? ""]);
const title = (s: string) => s.replace(/\.mm$/i, "");
const filename = (s: string) =>
  s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 200) + ".mm";
export type Connection = {
  subject: string;
  folder?: string;
  conditional: number;
};
export class DriveStore {
  constructor(
    private db: Database.Database,
    private owner: string,
    readonly client: DriveClient,
    private connection: Connection,
    private legacyAsset: (
      url: string,
    ) => Promise<{ bytes: Buffer; mime: string }>,
  ) {}
  async file(id: string) {
    const f = await this.client.stat(id);
    if (!f.ownedByMe || f.trashed)
      throw new StorageError(
        404,
        "missing",
        "본인 소유의 사용 가능한 파일만 열 수 있습니다.",
      );
    return f;
  }
  async folder() {
    if (this.connection.folder) {
      const f = await this.file(this.connection.folder);
      if (f.mimeType !== FOLDER)
        throw new StorageError(409, "folder", "저장 폴더가 변경되었습니다.");
      return f.id;
    }
    const found = (
      await this.client.list(propertyQuery("webmind", "root"))
    ).find((f) => f.ownedByMe);
    const f =
      found ??
      (await this.client.create(await this.client.generateId(), {
        name: "WebMind",
        mimeType: FOLDER,
        appProperties: { webmind: "root" },
      }));
    this.connection.folder = f.id;
    this.db
      .prepare(
        "UPDATE drive_connections SET folder=? WHERE owner=? AND subject=?",
      )
      .run(f.id, this.owner, this.connection.subject);
    return f.id;
  }
  private remember(f: DriveFile) {
    this.db
      .prepare(
        "INSERT INTO drive_cache(owner,subject,id,title,revision,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,subject,id) DO UPDATE SET title=excluded.title,revision=excluded.revision,updatedAt=excluded.updatedAt",
      )
      .run(
        this.owner,
        this.connection.subject,
        publicId(f.id),
        title(f.name),
        revision(f),
        f.modifiedTime,
      );
  }
  async list() {
    const files = await this.client.list(
      `${propertyQuery("webmind", "map")} or ${propertyQuery("webmind", "opened")}`,
    );
    const rows = files
      .filter((f) => f.ownedByMe && f.name.toLowerCase().endsWith(".mm"))
      .map((f) => {
        this.remember(f);
        return {
          id: publicId(f.id),
          storage: "drive" as const,
          title: title(f.name),
          revision: revision(f),
          updatedAt: f.modifiedTime,
        };
      });
    this.db
      .prepare("DELETE FROM drive_cache WHERE owner=? AND subject=?")
      .run(this.owner, this.connection.subject);
    for (const f of files.filter((f) => f.ownedByMe)) this.remember(f);
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async open(fileId: string) {
    const f = await this.file(fileId);
    if (!f.name.toLowerCase().endsWith(".mm"))
      throw new StorageError(
        400,
        "file_type",
        "FreeMind .mm 파일을 선택하세요.",
      );
    await this.get(publicId(fileId)); // Parse before registering an external file.
    await this.client.update(fileId, {
      appProperties: {
        ...f.appProperties,
        webmind: f.appProperties?.webmind === "map" ? "map" : "opened",
      },
    });
    return this.get(publicId(fileId));
  }
  async assets(fileId: string) {
    return (await this.client.list(propertyQuery("map", fileId))).filter(
      (f) => f.ownedByMe && f.appProperties?.webmind === "asset",
    );
  }
  private async externalImages(file: DriveFile, document: MindMap) {
    const paths = [
      ...new Set(
        Object.values(document.nodes)
          .map((n) => n.image)
          .filter((p): p is string => !!p),
      ),
    ];
    const result = new Map<string, DriveFile>();
    const lookups = new Map<string, DriveFile[]>();
    for (const path of paths.slice(0, 100)) {
      if (
        !file.parents?.[0] ||
        path.length > 1024 ||
        /^([a-z][a-z0-9+.-]*:|[/\\])/i.test(path)
      )
        continue;
      const parts = path
        .replace(/\\/g, "/")
        .split("/")
        .filter((p) => p && p !== ".");
      if (!parts.length || parts.length > 16 || parts.includes("..")) continue;
      let parent = file.parents[0];
      for (let i = 0; i < parts.length; i++) {
        const query = `'${escapeQuery(parent)}' in parents and name='${escapeQuery(parts[i])}'`;
        if (!lookups.has(query))
          lookups.set(query, await this.client.list(query));
        const matches = lookups.get(query)!.filter((f) => f.ownedByMe);
        // Ambiguous filenames need an explicit Picker selection.
        if (matches.length !== 1) break;
        const match = matches[0];
        if (i === parts.length - 1) {
          if (
            ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              match.mimeType,
            )
          )
            result.set(path, match);
        } else if (match.mimeType === FOLDER) parent = match.id;
        else break;
      }
    }
    return result;
  }
  async get(id: string): Promise<MapRecord> {
    const raw = driveId(id),
      first = await this.file(raw);
    const bytes = await this.client.bytes(raw),
      f = await this.file(raw);
    if (first.version !== f.version)
      throw new StorageError(
        409,
        "conflict",
        "읽는 동안 파일이 변경되었습니다. 다시 여세요.",
      );
    const document = importMM(bytes.toString("utf8"));
    const assets = await this.assets(raw),
      byPath = new Map(assets.map((a) => [a.appProperties?.path, a]));
    if (
      Object.values(document.nodes).some((n) => n.image && !byPath.has(n.image))
    ) {
      const external = await this.externalImages(f, document);
      for (const [path, asset] of external)
        if (!byPath.has(path)) byPath.set(path, asset);
    }
    for (const n of Object.values(document.nodes)) {
      const a = n.image ? byPath.get(n.image) : undefined;
      if (a) n.image = `/api/maps/${id}/assets/${a.id}`;
    }
    this.remember(f);
    return {
      id,
      storage: "drive",
      title: title(f.name),
      document,
      revision: revision(f),
      updatedAt: f.modifiedTime,
    };
  }
  async asset(id: string, asset: string) {
    const raw = driveId(id);
    const map = await this.file(raw);
    const a = await this.file(asset);
    if (a.appProperties?.webmind !== "asset" || a.appProperties?.map !== raw) {
      const document = importMM(
        (await this.client.bytes(raw)).toString("utf8"),
      );
      const images = await this.externalImages(map, document);
      if (![...images.values()].some((f) => f.id === asset))
        throw new StorageError(
          404,
          "missing",
          "이 문서에 연결된 첨부파일이 아닙니다.",
        );
    }
    const bytes = await this.client.bytes(asset, 5 * 1024 * 1024);
    if (!validImage(bytes, a.mimeType))
      throw new StorageError(400, "image", "지원하지 않는 이미지입니다.");
    return { bytes, mime: a.mimeType };
  }
  private async assetFolder(raw: string) {
    const existing = (
      await this.client.list(propertyQuery("assetFolder", raw))
    ).find((f) => f.ownedByMe && f.mimeType === FOLDER);
    if (existing) return existing.id;
    const root = (await this.file(raw)).parents?.[0] ?? (await this.folder());
    let assets = (
      await this.client.list(
        `'${escapeQuery(root)}' in parents and ${propertyQuery("webmind", "assets")}`,
      )
    ).find((f) => f.ownedByMe);
    if (!assets)
      assets = await this.client.create(await this.client.generateId(), {
        name: "assets",
        mimeType: FOLDER,
        parents: [root],
        appProperties: { webmind: "assets" },
      });
    return (
      await this.client.create(await this.client.generateId(), {
        name: raw,
        mimeType: FOLDER,
        parents: [assets.id],
        appProperties: { assetFolder: raw },
      })
    ).id;
  }
  async upload(id: string, bytes: Buffer, mime: string, key?: string) {
    const raw = driveId(id);
    await this.file(raw);
    if (!validImage(bytes, mime))
      throw new StorageError(
        400,
        "image",
        "PNG, JPEG, WebP, GIF (5MB 이하)만 지원합니다.",
      );
    const hash = digest(bytes);
    const existing = (await this.assets(raw)).find(
      (a) => a.appProperties?.hash === hash,
    );
    if (
      existing &&
      digest(await this.client.bytes(existing.id, 5 * 1024 * 1024)) === hash
    )
      return { url: `/api/maps/${id}/assets/${existing.id}` };
    const aid = await this.client.generateId(),
      path = `assets/${raw}/${aid}.${imageExt(mime)}`;
    await this.client.create(
      aid,
      {
        name: `${aid}.${imageExt(mime)}`,
        mimeType: mime,
        parents: [await this.assetFolder(raw)],
        appProperties: {
          webmind: "asset",
          map: raw,
          path,
          hash,
          ...(key ? { operation: key } : {}),
        },
      },
      bytes,
    );
    return { url: `/api/maps/${id}/assets/${aid}` };
  }
  private async encoded(document: MindMap, id: string, copy: boolean) {
    const m = validateMap(document),
      paths: Record<string, string> = {},
      remap = new Map<string, string>();
    for (const n of Object.values(m.nodes)) {
      if (!n.image?.startsWith("/api/maps/")) {
        if (n.image?.startsWith("local-asset:"))
          throw new StorageError(
            400,
            "local_asset",
            "로컬 이미지를 먼저 업로드하세요.",
          );
        continue;
      }
      if (remap.has(n.image)) {
        n.image = remap.get(n.image)!;
        continue;
      }
      const source = n.image,
        match = source.match(/^\/api\/maps\/([^/]+)\/assets\/([\w-]+)$/);
      if (!match)
        throw new StorageError(400, "asset", "잘못된 첨부파일 참조입니다.");
      const ownedAttachment =
        match[1] === id &&
        (await this.file(match[2])).appProperties?.map === driveId(id);
      if (copy || !ownedAttachment) {
        const data = match[1].startsWith("g_")
          ? await this.asset(match[1], match[2])
          : await this.legacyAsset(source);
        n.image = (await this.upload(id, data.bytes, data.mime)).url;
      } else await this.asset(id, match[2]);
      remap.set(source, n.image);
    }
    const assets = await this.assets(driveId(id));
    for (const a of assets)
      paths[`/api/maps/${id}/assets/${a.id}`] = a.appProperties!.path;
    const xml = exportMM(m, paths);
    if (Buffer.byteLength(xml) > 8 * 1024 * 1024)
      throw new StorageError(413, "size", "문서 최대 크기는 8MB입니다.");
    return Buffer.from(xml);
  }
  private operation(key: string) {
    let row = this.db
      .prepare(
        "SELECT * FROM drive_operations WHERE owner=? AND subject=? AND key=?",
      )
      .get(this.owner, this.connection.subject, key) as any;
    return row;
  }
  async create(
    name: string,
    document: MindMap,
    key: string,
    source?: string,
  ): Promise<MapRecord> {
    const requestHash = digest(JSON.stringify({ name, document }));
    let operation = this.operation(key);
    if (!operation) {
      const id = await this.client.generateId();
      this.db
        .prepare(
          "INSERT INTO drive_operations(owner,subject,key,fileId) VALUES(?,?,?,?)",
        )
        .run(this.owner, this.connection.subject, key, id);
      operation = { fileId: id };
    }
    const raw = operation.fileId,
      id = publicId(raw);
    let f: DriveFile | undefined;
    try {
      f = await this.file(raw);
    } catch (e) {
      if (!(e instanceof StorageError) || e.statusCode !== 404) throw e;
    }
    if (
      f?.appProperties?.operation === key &&
      f.appProperties.ready === "yes"
    ) {
      if (
        f.appProperties.createRequest !== requestHash ||
        f.appProperties.createHash !== digest(await this.client.bytes(raw))
      )
        throw new StorageError(
          409,
          "conflict",
          "생성된 파일이 변경되었습니다. 목록에서 확인하거나 새 복사본으로 저장하세요.",
        );
      const result = await this.get(id);
      if (result.revision !== revision(f))
        throw new StorageError(
          409,
          "conflict",
          "확인 중 파일이 변경되었습니다.",
        );
      return result;
    }
    if (!f)
      await this.client.create(
        raw,
        {
          name: filename(name),
          mimeType: "application/x-freemind",
          parents: [await this.folder()],
          appProperties: {
            webmind: "pending",
            operation: key,
            ...(source ? { source } : {}),
          },
        },
        Buffer.from(exportMM(emptyMap("WebMind · 이미지 준비 중"))),
      );
    const bytes = await this.encoded(document, id, true);
    await this.client.update(
      raw,
      {
        name: filename(name),
        mimeType: "application/x-freemind",
        appProperties: {
          webmind: "map",
          operation: key,
          createRequest: requestHash,
          createHash: digest(bytes),
          ready: "yes",
          ...(source ? { source } : {}),
        },
      },
      bytes,
    );
    return this.get(id);
  }
  async save(
    id: string,
    name: string,
    document: MindMap,
    base: string,
    key: string,
  ) {
    const raw = driveId(id),
      current = await this.file(raw);
    const requestHash = digest(JSON.stringify({ name, document }));
    if (current.appProperties?.saveOperation === key) {
      if (
        current.appProperties.saveRequest !== requestHash ||
        current.name !== filename(name) ||
        current.appProperties.saveHash !== digest(await this.client.bytes(raw))
      )
        throw new StorageError(
          409,
          "conflict",
          "저장 이후 파일이 변경되었습니다. 로컬 작업을 복사본으로 보존하세요.",
        );
      const result = await this.get(id);
      if (result.revision !== revision(current))
        throw new StorageError(
          409,
          "conflict",
          "확인 중 파일이 변경되었습니다.",
        );
      return result;
    }
    if (revision(current) !== base)
      throw new StorageError(
        409,
        "conflict",
        "다른 기기 또는 FreeMind에서 변경되었습니다.",
      );
    if (!this.connection.conditional || !current.etag) {
      const copy = await this.create(
        name.endsWith(" 변경본") ? name : name + " 변경본",
        document,
        key,
        raw,
      );
      return { ...copy, safeCopy: true };
    }
    const bytes = await this.encoded(document, id, false);
    const written = await this.client.update(
      raw,
      {
        name: filename(name),
        mimeType: "application/x-freemind",
        appProperties: {
          ...current.appProperties,
          webmind: "map",
          saveOperation: key,
          saveRequest: requestHash,
          saveHash: digest(bytes),
        },
      },
      bytes,
      current.etag,
    );
    const result = await this.get(id);
    if (JSON.parse(result.revision)[0] !== written.version)
      throw new StorageError(
        409,
        "conflict",
        "저장 직후 외부 파일이 변경되었습니다. 로컬 작업을 보존합니다.",
      );
    return result;
  }
  async trash(id: string) {
    const raw = driveId(id),
      f = await this.file(raw);
    if (!["map", "opened"].includes(f.appProperties?.webmind ?? ""))
      throw new StorageError(
        403,
        "permission",
        "WebMind에서 연 문서만 삭제할 수 있습니다.",
      );
    await this.client.update(raw, { trashed: true });
    for (const a of await this.assets(raw))
      await this.client.update(a.id, { trashed: true });
    for (const folder of await this.client.list(
      propertyQuery("assetFolder", raw),
    ))
      if (folder.ownedByMe)
        await this.client.update(folder.id, { trashed: true });
    this.db
      .prepare("DELETE FROM drive_cache WHERE owner=? AND subject=? AND id=?")
      .run(this.owner, this.connection.subject, id);
  }
}
