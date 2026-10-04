import { useEffect, useRef, useState } from "react";
import { get, set, del, keys, getMany } from "idb-keyval";
import { api, ApiError } from "./api";
import {
  normalizeRecord,
  putLocal,
  putRemote,
  imageBlob,
  localize,
} from "./local-store";
import type { MapRecord, MindMap } from "../shared/model";
import { isLegacyDriveRevision } from "../shared/revision";
export type Draft = { record: MapRecord; dirty: boolean; time: number };
const tabId = (() => {
  try {
    const old = sessionStorage.getItem("webmind-tab");
    if (old) return old;
    const id = crypto.randomUUID();
    sessionStorage.setItem("webmind-tab", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();
export const draftKey = (user: string, id: string) =>
  `webmind:${user}:${id}:${tabId}`;
export async function recover(
  user: string,
  record: MapRecord,
): Promise<MapRecord> {
  record = normalizeRecord(record);
  try {
    const own = await get<Draft>(draftKey(user, record.id));
    if (own?.dirty)
      return { ...normalizeRecord(own.record), recoveredDraft: true };
    // This tab already settled its draft. Do not resurrect an older tab's work
    // over an explicitly accepted/saved document; that draft remains in storage.
    if (own) return record;
    const prefix = `webmind:${user}:${record.id}`;
    const candidates = (await keys()).filter(
      (k) =>
        typeof k === "string" && (k === prefix || k.startsWith(prefix + ":")),
    );
    const drafts = (await getMany<Draft>(candidates))
      .filter((d): d is Draft => !!d?.dirty)
      .sort((a, b) => b.time - a.time);
    if (drafts[0]) {
      const d = { ...drafts[0], record: normalizeRecord(drafts[0].record) };
      await set(draftKey(user, record.id), d);
      return { ...d.record, recoveredDraft: true };
    }
  } catch {}
  return record;
}
export function usePersistence(user: string, initial: MapRecord) {
  const first = normalizeRecord(initial);
  const [record, setRecord] = useState(first),
    [remoteEpoch, setRemoteEpoch] = useState(0),
    [status, setStatus] = useState(
      first.storage === "local"
        ? "local"
        : first.storage === "legacy"
          ? "readonly"
          : first.recoveredDraft
            ? "pending"
            : "saved",
    );
  const state = useRef({
    record: first,
    seq: first.recoveredDraft && first.storage === "drive" ? 1 : 0,
    saved: 0,
    busy: false,
    alive: true,
    conflict: false,
    blocked: false,
    retry: 0,
    epoch: 0,
    check: 0,
    pending: null as null | { seq: number; record: MapRecord; id: string },
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    writes = useRef(Promise.resolve());
  function persist(r: MapRecord, dirty: boolean) {
    let stored = false;
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        await set(draftKey(user, r.id), { record: r, dirty, time: Date.now() });
        if (r.storage === "local") await putLocal(user, r);
        if (r.storage === "drive") await putRemote(user, r);
        stored = true;
      })
      .catch(() => {
        if (state.current.alive) setStatus("storage-error");
      });
    return writes.current.then(() => stored);
  }
  async function flush() {
    const s = state.current;
    if (
      s.busy ||
      s.conflict ||
      s.blocked ||
      s.seq === s.saved ||
      s.record.storage !== "drive"
    )
      return;
    s.busy = true;
    s.epoch++;
    const pending = s.pending ?? {
      seq: s.seq,
      record: structuredClone(s.record),
      id: crypto.randomUUID(),
    };
    s.pending = pending;
    if (s.alive) setStatus("saving");
    try {
      const r = pending.record,
        wire = structuredClone(r.document),
        uploaded = new Map<string, string>();
      for (const n of Object.values(wire.nodes))
        if (n.image?.startsWith("local-asset:")) {
          if (!uploaded.has(n.image)) {
            const blob = await imageBlob(user, n.image),
              a = await api<{ url: string }>(`/api/maps/${r.id}/assets`, {
                method: "POST",
                headers: { "Content-Type": blob.type },
                body: blob,
              });
            uploaded.set(n.image, a.url);
          }
          n.image = uploaded.get(n.image)!;
        }
      const result = await api<MapRecord>(`/api/maps/${r.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: r.title,
          document: wire,
          revision: r.revision,
          requestId: pending.id,
        }),
      });
      const next =
        s.seq === pending.seq
          ? result
          : {
              ...s.record,
              id: result.id,
              revision: result.revision,
              updatedAt: result.updatedAt,
              safeCopy: result.safeCopy,
            };
      if (s.seq !== pending.seq) {
        const doc = structuredClone(next.document);
        for (const n of Object.values(doc.nodes))
          if (
            n.image === r.document.nodes[n.id]?.image &&
            result.document.nodes[n.id]
          )
            n.image = result.document.nodes[n.id].image;
        next.document = doc;
      }
      s.record = next;
      s.saved = pending.seq;
      s.pending = null;
      s.retry = 0;
      // Publish the acknowledgement before IndexedDB awaits. Edits made while
      // the local write settles must not be replaced by this older snapshot.
      if (s.alive) setRecord(next);
      const stored = await persist(next, s.seq !== s.saved);
      if (r.id !== next.id)
        await set(draftKey(user, r.id), {
          record: r,
          dirty: false,
          time: Date.now(),
        });
      if (s.alive) {
        setStatus(
          !stored
            ? "storage-error"
            : s.seq !== s.saved
              ? "pending"
              : result.safeCopy
                ? "safe-copy"
                : "saved",
        );
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (e instanceof ApiError && (e.status === 409 || e.status === 412)) {
        s.conflict = true;
        setStatus("conflict");
      } else if (
        e instanceof ApiError &&
        [401, 403, 404, 413, 428, 507].includes(e.status)
      ) {
        s.blocked = true;
        setStatus(
          e.status === 401
            ? "session"
            : e.status === 404
              ? "missing"
              : [413, 507].includes(e.status)
                ? "quota"
                : "connect",
        );
      } else {
        s.retry++;
        if (s.alive)
          setStatus(code === "rate_limit" ? "rate-limit" : "offline");
      }
    } finally {
      s.busy = false;
      if (s.seq !== s.saved && !s.conflict && !s.blocked && s.alive)
        timer.current = setTimeout(
          flush,
          s.retry
            ? Math.min(60000, 2000 * 2 ** Math.min(s.retry, 5)) +
                Math.random() * 500
            : 2000,
        );
    }
  }
  function change(document: MindMap, title = state.current.record.title) {
    const s = state.current;
    if (s.record.storage === "legacy") return;
    s.record = {
      ...s.record,
      document,
      title,
      updatedAt: new Date().toISOString(),
    };
    s.seq++;
    setRecord(s.record);
    const stored = persist(s.record, s.record.storage === "drive");
    if (s.record.storage === "local") {
      const seq = s.seq;
      setStatus("pending");
      void stored.then((ok) => {
        if (ok) s.saved = Math.max(s.saved, seq);
        if (s.alive && seq === s.seq) setStatus(ok ? "local" : "storage-error");
      });
      return;
    }
    setStatus(s.conflict ? "conflict" : s.blocked ? "connect" : "pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 2000);
  }
  async function checkRemote() {
    const s = state.current;
    if (s.record.storage !== "drive" || s.busy || s.conflict || s.pending)
      return;
    const id = s.record.id,
      seq = s.seq,
      base = s.record.revision,
      epoch = s.epoch,
      check = ++s.check;
    const stale = () =>
      !s.alive ||
      s.record.id !== id ||
      s.busy ||
      s.epoch !== epoch ||
      s.check !== check ||
      s.record.revision !== base;
    try {
      const remote = await api<MapRecord>(`/api/maps/${id}`);
      if (stale()) return;
      if (remote.revision !== s.record.revision) {
        if (s.seq !== s.saved || s.pending) {
          // Upgrade old dirty drafts through the server's copy-only fallback.
          // Never label a revision-format upgrade as another device's edit.
          if (
            isLegacyDriveRevision(base) &&
            !isLegacyDriveRevision(remote.revision)
          ) {
            void flush();
            return;
          }
          s.conflict = true;
          setStatus("conflict");
          return;
        }
        if (s.seq !== seq) return;
        s.epoch++;
        s.record = remote;
        setRecord(remote);
        setRemoteEpoch((n) => n + 1);
        await persist(remote, false);
      }
      if (s.blocked) {
        s.blocked = false;
        void flush();
      }
    } catch (e) {
      if (stale()) return;
      if (e instanceof ApiError && [401, 403, 404, 428].includes(e.status)) {
        s.blocked = true;
        setStatus(
          e.status === 404
            ? "missing"
            : e.status === 401
              ? "session"
              : "connect",
        );
      }
    }
  }
  async function latest() {
    const s = state.current;
    if (s.busy) return;
    s.busy = true;
    s.epoch++;
    const seq = s.seq,
      snapshot = structuredClone(s.record);
    try {
      // Keep the unresolved draft as an independent local recovery document.
      const backup = {
        ...snapshot,
        id: "local-" + crypto.randomUUID(),
        storage: "local" as const,
        readOnly: false,
        title: snapshot.title + " 복구본",
      };
      backup.document = await localize(user, backup.document);
      await putLocal(user, backup);
      const remote = await api<MapRecord>(`/api/maps/${snapshot.id}`);
      if (!s.alive) return;
      if (s.seq !== seq || s.record.id !== snapshot.id)
        throw Error(
          "최신본을 불러오는 동안 편집한 내용이 있어 현재 작업을 유지했습니다.",
        );
      s.record = remote;
      s.saved = s.seq;
      s.pending = null;
      s.conflict = false;
      s.blocked = false;
      setRecord(remote);
      setRemoteEpoch((n) => n + 1);
      await persist(remote, false);
      if (s.seq === seq) setStatus("saved");
      return backup;
    } finally {
      s.busy = false;
    }
  }
  useEffect(() => {
    const s = state.current;
    s.alive = true;
    void flush();
    const resume = () => {
      if (document.visibilityState === "visible") {
        s.blocked = false;
        void checkRemote().then(() => flush());
      }
    };
    const continuous = setInterval(() => {
      if (document.visibilityState === "visible") void flush();
    }, 15000);
    const remote = setInterval(() => {
      if (document.visibilityState === "visible") void checkRemote();
    }, 30000);
    const leave = (e: BeforeUnloadEvent) => {
      if (s.seq !== s.saved) {
        e.preventDefault();
      }
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("beforeunload", leave);
    void checkRemote();
    return () => {
      s.alive = false;
      s.epoch++;
      clearTimeout(timer.current);
      clearInterval(continuous);
      clearInterval(remote);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  return {
    record,
    remoteEpoch,
    change,
    status,
    flush,
    latest,
    retry: () => {
      state.current.blocked = false;
      void flush();
    },
    settled: () => writes.current,
    clearDraft: () => del(draftKey(user, state.current.record.id)),
  };
}
