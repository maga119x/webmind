import { get, set, del, keys, getMany } from "idb-keyval";
import { emptyMap, uid, type MapRecord, type MindMap } from "../shared/model";
import { api } from "./api";
export const localKey = (user: string, id: string) => `local-map:${user}:${id}`;
export function normalizeRecord(r: any): MapRecord {
  return {
    ...r,
    storage:
      r.storage ??
      (r.id === "demo" || r.id?.startsWith("local-") ? "local" : "legacy"),
    revision: String(r.revision ?? "0"),
  };
}
export async function localMaps(user: string) {
  const prefix = `local-map:${user}:`,
    found = (await keys()).filter(
      (k) => typeof k === "string" && k.startsWith(prefix),
    );
  return (await getMany<MapRecord>(found))
    .filter((r): r is MapRecord => !!r)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function putLocal(user: string, r: MapRecord) {
  await set(localKey(user, r.id), r);
}
export const putRemote = (user: string, r: MapRecord) =>
  set(`remote-map:${user}:${r.id}`, r);
export const readRemote = (user: string, id: string) =>
  get<MapRecord>(`remote-map:${user}:${id}`);
export async function cachedRemoteMaps(user: string) {
  const found = (await keys()).filter(
    (k) => typeof k === "string" && k.startsWith(`remote-map:${user}:`),
  );
  return (await getMany<MapRecord>(found)).filter((r): r is MapRecord => !!r);
}
export async function readLocal(user: string, id: string) {
  const r = await get<MapRecord>(localKey(user, id));
  if (!r) throw Error("로컬 문서를 찾을 수 없습니다.");
  return normalizeRecord(r);
}
export async function newLocal(
  user: string,
  title: string,
  document: MindMap = emptyMap(title),
): Promise<MapRecord> {
  const r: MapRecord = {
    id: "local-" + uid(),
    storage: "local",
    revision: "0",
    title,
    document: structuredClone(document),
    updatedAt: new Date().toISOString(),
  };
  await putLocal(user, r);
  return r;
}
export async function deleteLocal(user: string, id: string) {
  await del(localKey(user, id));
  const drafts = (await keys()).filter(
    (k) =>
      typeof k === "string" &&
      (k === `webmind:${user}:${id}` || k.startsWith(`webmind:${user}:${id}:`)),
  );
  await Promise.all(drafts.map((k) => del(k)));
  // Other tabs, unsynced Drive drafts and undo history may still reference blobs.
  // Retain them; deleting a document must not destroy another draft's images.
}
export function managedImage(url?: string): url is string {
  return (
    !!url &&
    (url.startsWith("local-asset:") ||
      /^\/api\/maps\/[^/]+\/assets\/[\w-]+$/.test(url))
  );
}
type StoredImage = { bytes: ArrayBuffer; mime: string };
function asBlob(value: Blob | StoredImage) {
  return value instanceof Blob
    ? value
    : new Blob([value.bytes], { type: value.mime });
}
async function storeBlob(key: string, blob: Blob) {
  // ArrayBuffer is portable across IndexedDB implementations, including WebKit.
  await set(key, {
    bytes: await blob.arrayBuffer(),
    mime: blob.type,
  } satisfies StoredImage);
}
export async function imageBlob(user: string, url: string): Promise<Blob> {
  if (url.startsWith("local-asset:")) {
    const b = await get<Blob | StoredImage>(
      `local-blob:${user}:${url.slice(12)}`,
    );
    if (!b)
      throw Error("이 기기에 이미지가 없습니다. 이미지를 다시 연결하세요.");
    return asBlob(b);
  }
  if (!managedImage(url)) throw Error("이미지를 직접 연결하세요.");
  const key = `remote-blob:${user}:${url}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw Error("이미지를 불러오지 못했습니다.");
    const blob = await r.blob();
    await storeBlob(key, blob).catch(() => {});
    return blob;
  } catch (e) {
    const cached = await get<Blob | StoredImage>(key);
    if (cached) return asBlob(cached);
    throw e;
  }
}
export async function storeImage(user: string, file: Blob) {
  if (
    file.size > 5 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw Error("PNG, JPEG, WebP, GIF (5MB 이하)만 지원합니다.");
  const id = uid();
  await storeBlob(`local-blob:${user}:${id}`, file);
  return "local-asset:" + id;
}
export async function localize(
  user: string,
  document: MindMap,
  sourceUser = user,
) {
  const next = structuredClone(document),
    images = new Map<string, string>();
  for (const n of Object.values(next.nodes))
    if (managedImage(n.image)) {
      if (!images.has(n.image))
        images.set(
          n.image,
          await storeImage(user, await imageBlob(sourceUser, n.image)),
        );
      n.image = images.get(n.image)!;
    }
  return next;
}
export async function saveToDrive(
  user: string,
  title: string,
  document: MindMap,
  requestId: string,
) {
  // Reserve the document before uploading local attachments. The request ID makes retry safe.
  const shell = structuredClone(document),
    local = new Map<string, string>();
  for (const n of Object.values(shell.nodes))
    if (n.image?.startsWith("local-asset:")) {
      local.set(n.id, n.image);
      delete n.image;
    }
  const created = await api<MapRecord>("/api/maps", {
    method: "POST",
    body: JSON.stringify({ title, document: shell, requestId }),
  });
  if (!local.size) return created;
  const next = structuredClone(created.document),
    uploaded = new Map<string, string>();
  for (const [id, reference] of local) {
    if (!uploaded.has(reference)) {
      const blob = await imageBlob(user, reference),
        result = await api<{ url: string }>(`/api/maps/${created.id}/assets`, {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        });
      uploaded.set(reference, result.url);
    }
    next.nodes[id].image = uploaded.get(reference)!;
  }
  // Finalization has its own idempotency key and goes through the safe save policy.
  return api<MapRecord>(`/api/maps/${created.id}`, {
    method: "PUT",
    body: JSON.stringify({
      title,
      document: next,
      revision: created.revision,
      requestId: await derivedId(requestId),
    }),
  });
}
async function derivedId(id: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(id + ":assets"),
    ),
  );
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const s = [...bytes.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
