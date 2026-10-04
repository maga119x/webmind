export class StorageError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  modifiedTime: string;
  ownedByMe: boolean;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
  etag?: string;
  md5Checksum?: string;
  size?: string;
};
export interface DriveClient {
  list(query: string): Promise<DriveFile[]>;
  stat(id: string): Promise<DriveFile>;
  bytes(id: string, limit?: number): Promise<Buffer>;
  generateId(): Promise<string>;
  create(
    id: string,
    metadata: Partial<DriveFile>,
    bytes?: Buffer,
  ): Promise<DriveFile>;
  update(
    id: string,
    metadata: Partial<DriveFile>,
    bytes?: Buffer,
    etag?: string,
  ): Promise<DriveFile>;
}
export const FOLDER = "application/vnd.google-apps.folder";
const fields =
  "id,name,mimeType,version,modifiedTime,ownedByMe,trashed,parents,appProperties,size,md5Checksum";
export const escapeQuery = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const propertyQuery = (key: string, value: string) =>
  `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' }`;

// The transport is injected in tests. Production endpoints are fixed; no user URLs.
export class GoogleDriveClient implements DriveClient {
  constructor(
    private token: () => Promise<string>,
    private transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, init: RequestInit = {}, upload = false) {
    const response = await this.transport(
      `https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(30000),
        headers: {
          ...init.headers,
          Authorization: `Bearer ${await this.token()}`,
        },
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as any;
      const reason = body.error?.errors?.[0]?.reason;
      if (response.status === 412)
        throw new StorageError(
          409,
          "conflict",
          "Drive 파일이 다른 곳에서 변경되었습니다.",
        );
      if (response.status === 401)
        throw new StorageError(
          428,
          "drive_reconnect",
          "Google Drive를 다시 연결하세요.",
        );
      if (reason === "storageQuotaExceeded")
        throw new StorageError(507, "quota", "Google Drive 용량이 부족합니다.");
      if (
        response.status === 429 ||
        ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason)
      )
        throw new StorageError(
          429,
          "rate_limit",
          "Drive 요청 제한입니다. 잠시 후 재시도합니다.",
        );
      if (response.status === 404)
        throw new StorageError(
          404,
          "missing",
          "파일이 없거나 접근 권한이 없습니다.",
        );
      if (response.status === 403)
        throw new StorageError(
          403,
          "drive_permission",
          "Drive 파일 접근 권한을 확인하세요.",
        );
      throw new StorageError(
        503,
        "drive_unavailable",
        "Google Drive 요청을 완료하지 못했습니다.",
      );
    }
    return response;
  }
  async list(query: string) {
    const files: DriveFile[] = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        q: `trashed=false and (${query})`,
        fields: `nextPageToken,files(${fields})`,
        pageSize: "100",
        spaces: "drive",
        ...(pageToken ? { pageToken } : {}),
      });
      const result = (await (await this.request(`files?${q}`)).json()) as any;
      files.push(...result.files);
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }
  async stat(id: string) {
    const r = await this.request(
      `files/${encodeURIComponent(id)}?fields=${fields}`,
    );
    return {
      ...((await r.json()) as DriveFile),
      etag: r.headers.get("etag") ?? undefined,
    };
  }
  async bytes(id: string, limit = 8 * 1024 * 1024) {
    const r = await this.request(`files/${encodeURIComponent(id)}?alt=media`);
    if (Number(r.headers.get("content-length")) > limit) {
      await r.body?.cancel();
      throw new StorageError(413, "size", "파일이 너무 큽니다.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = r.body!.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new StorageError(413, "size", "파일이 너무 큽니다.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  async generateId() {
    return (
      (await (
        await this.request("files/generateIds?count=1&space=drive&type=files")
      ).json()) as any
    ).ids[0] as string;
  }
  private async write(
    id: string,
    metadata: Partial<DriveFile>,
    bytes: Buffer | undefined,
    etag: string | undefined,
    create: boolean,
  ) {
    let body: BodyInit,
      headers: Record<string, string> = {};
    const data = create ? { ...metadata, id } : metadata;
    if (bytes) {
      const boundary = `webmind_${crypto.randomUUID()}`;
      body = new Uint8Array(
        Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType ?? "application/octet-stream"}\r\n\r\n`,
          ),
          bytes,
          Buffer.from(`\r\n--${boundary}--`),
        ]),
      );
      headers["Content-Type"] = `multipart/related; boundary=${boundary}`;
    } else {
      body = JSON.stringify(data);
      headers["Content-Type"] = "application/json";
    }
    if (etag) headers["If-Match"] = etag;
    const r = await this.request(
      `files${create ? "" : "/" + encodeURIComponent(id)}?fields=${fields}${bytes ? "&uploadType=multipart" : ""}`,
      { method: create ? "POST" : "PATCH", headers, body },
      !!bytes,
    );
    return {
      ...((await r.json()) as DriveFile),
      etag: r.headers.get("etag") ?? undefined,
    };
  }
  create(id: string, metadata: Partial<DriveFile>, bytes?: Buffer) {
    return this.write(id, metadata, bytes, undefined, true);
  }
  update(
    id: string,
    metadata: Partial<DriveFile>,
    bytes?: Buffer,
    etag?: string,
  ) {
    return this.write(id, metadata, bytes, etag, false);
  }
}

export async function verifyConditionalWrites(
  client: DriveClient,
  folder: string,
) {
  const id = await client.generateId();
  try {
    await client.create(
      id,
      {
        name: ".webmind-conditional-check",
        mimeType: "application/octet-stream",
        parents: [folder],
      },
      Buffer.from("one"),
    );
    const first = await client.stat(id);
    if (!first.etag) return false;
    await client.update(
      id,
      { mimeType: "application/octet-stream" },
      Buffer.from("two"),
      first.etag,
    );
    try {
      await client.update(
        id,
        { mimeType: "application/octet-stream" },
        Buffer.from("stale"),
        first.etag,
      );
      return false;
    } catch (e) {
      return (
        e instanceof StorageError &&
        e.code === "conflict" &&
        (await client.bytes(id)).toString() === "two"
      );
    }
  } catch {
    return false;
  } finally {
    await client.update(id, { trashed: true }).catch(() => {});
  }
}
