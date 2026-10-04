import { createHash, randomUUID } from "node:crypto";
import {
  StorageError,
  type DriveClient,
  type DriveFile,
} from "../server/drive-client";
export class FakeDrive implements DriveClient {
  files = new Map<string, { meta: DriveFile; bytes: Buffer }>();
  enforceConditional = true;
  exposeEtags = true;
  loseNextUpdate = false;
  beforeUpdate: (() => void) | undefined;
  async generateId() {
    return randomUUID();
  }
  async list(query: string) {
    return [...this.files.values()]
      .filter(
        ({ meta: m }) =>
          !m.trashed &&
          query.split(/\s+or\s+/).some((part) => {
            const props = [
              ...part.matchAll(/key='([^']+)' and value='([^']+)'/g),
            ];
            const parent = part.match(/'([^']+)' in parents/);
            const name = part.match(/\bname='([^']+)'/);
            return (
              props.every(([, k, v]) => m.appProperties?.[k] === v) &&
              (!parent || m.parents?.includes(parent[1])) &&
              (!name || m.name === name[1])
            );
          }),
      )
      .map((f) => structuredClone(f.meta));
  }
  async stat(id: string) {
    const f = this.files.get(id);
    if (!f) throw new StorageError(404, "missing", "Missing");
    const meta = structuredClone(f.meta);
    if (!this.exposeEtags) delete meta.etag;
    return meta;
  }
  async bytes(id: string) {
    await this.stat(id);
    return Buffer.from(this.files.get(id)!.bytes);
  }
  async create(id: string, meta: Partial<DriveFile>, bytes = Buffer.alloc(0)) {
    if (this.files.has(id)) throw new StorageError(409, "exists", "Exists");
    const f: DriveFile = {
      id,
      name: meta.name!,
      mimeType: meta.mimeType!,
      ownedByMe: true,
      version: "1",
      etag: '"1"',
      modifiedTime: new Date().toISOString(),
      md5Checksum: createHash("md5").update(bytes).digest("hex"),
      ...meta,
    };
    this.files.set(id, { meta: f, bytes: Buffer.from(bytes) });
    return this.stat(id);
  }
  async update(
    id: string,
    meta: Partial<DriveFile>,
    bytes?: Buffer,
    etag?: string,
  ) {
    const hook = this.beforeUpdate;
    this.beforeUpdate = undefined;
    hook?.();
    const previous = await this.stat(id);
    if (etag && this.enforceConditional && etag !== previous.etag)
      throw new StorageError(409, "conflict", "Conditional conflict");
    const version = String(Number(previous.version) + 1),
      f = this.files.get(id)!;
    f.meta = {
      ...previous,
      ...meta,
      appProperties: { ...previous.appProperties, ...meta.appProperties },
      version,
      etag: `"${version}"`,
      modifiedTime: new Date().toISOString(),
    };
    if (bytes) {
      f.bytes = Buffer.from(bytes);
      f.meta.md5Checksum = createHash("md5").update(bytes).digest("hex");
    }
    if (this.loseNextUpdate) {
      this.loseNextUpdate = false;
      throw new StorageError(503, "drive_unavailable", "Response lost");
    }
    return this.stat(id);
  }
}
export function fakeFactory() {
  const clients = new Map<string, FakeDrive>();
  const factory = (owner: string) => {
    if (!clients.has(owner)) clients.set(owner, new FakeDrive());
    return {
      client: clients.get(owner)!,
      subject: "google-" + owner,
      conditional: true,
    };
  };
  return { clients, factory };
}
