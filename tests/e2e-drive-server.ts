// Test-only process. It has no runtime flag or endpoint that can enable mock Drive in production.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { fakeFactory } from "./fake-drive";
const dataDir = mkdtempSync(join(tmpdir(), "webmind-browser-drive-"));
const fake = fakeFactory();
const { app } = await createApp({
  dataDir,
  baseURL: "http://localhost:4173",
  test: true,
  driveFactory: fake.factory,
});
app.get("/api/test-storage-mode", async () => ({ mockDrive: true }));
// Only registered by this isolated test process, never by the production app.
app.post<{ Params: { id: string }; Body: { safeCopy?: boolean } }>(
  "/api/test-drive/:id/metadata",
  async (req, reply) => {
    const raw = req.params.id.replace(/^g_/, "");
    const client = [...fake.clients.values()].find((c) => c.files.has(raw));
    if (!client) return reply.code(404).send();
    if (req.body.safeCopy) client.exposeEtags = false;
    await client.update(raw, {
      appProperties: { backgroundUpdate: String(Date.now()) },
    });
    return { ok: true };
  },
);
await app.listen({ host: "127.0.0.1", port: 4173 });
const close = async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
