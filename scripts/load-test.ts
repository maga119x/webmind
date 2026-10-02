/** Run against a disposable local/test server, never a production user database. */
import { emptyMap, addNode } from "../shared/model";
const base = process.env.TEST_URL ?? "http://localhost:4173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Load test only permits loopback test servers");
const mode = (await fetch(base + "/api/test-storage-mode")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)) as { mockDrive?: boolean } | null;
if (!mode?.mockDrive)
  throw Error(
    "Start the disposable mock server first: npm run build, then npx tsx tests/e2e-drive-server.ts. No accounts or documents were created.",
  );
async function req(path: string, body?: unknown, cookie = "") {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      origin: process.env.TEST_ORIGIN ?? new URL(base).origin,
      cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
const cookies: string[] = [];
for (let i = 0; i < 3; i++) {
  const email = `load-${Date.now()}-${i}@example.com`,
    password = "load-test-password-123";
  const r = await req("/api/auth/sign-up/email", {
    email,
    password,
    name: "Load test",
  });
  if (!r.ok) throw Error(await r.text());
  const mails = (await (await req("/api/dev/mailbox")).json()) as any[];
  const verify = mails.findLast((m) => m.to === email).url;
  await fetch(base + new URL(verify).pathname + new URL(verify).search, {
    redirect: "manual",
  });
  const login = await req("/api/auth/sign-in/email", { email, password });
  cookies.push(
    login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  );
}
const m = emptyMap("1000 thoughts");
for (let i = 0; i < 20; i++) {
  const id = addNode(m, m.root, "Branch " + i);
  for (let j = 0; j < 49; j++) addNode(m, id, "Thought " + j);
}
const timings: number[] = [];
await Promise.all(
  cookies.map(async (cookie) => {
    const create = await req(
      "/api/maps",
      { title: "Load test", document: m },
      cookie,
    );
    if (!create.ok) throw Error(await create.text());
    let map = (await create.json()) as any;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const r = await fetch(base + `/api/maps/${map.id}`, {
        method: "PUT",
        headers: {
          cookie,
          "Content-Type": "application/json",
          origin: process.env.TEST_ORIGIN ?? new URL(base).origin,
        },
        body: JSON.stringify({
          title: "Load " + i,
          document: m,
          revision: map.revision,
        }),
      });
      if (!r.ok) throw Error(await r.text());
      map = { ...map, ...(await r.json()) };
      timings.push(performance.now() - start);
    }
  }),
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      users: 3,
      nodes: Object.keys(m.nodes).length,
      writes: timings.length,
      p50ms: timings[Math.floor(timings.length * 0.5)],
      p95ms: timings[Math.floor(timings.length * 0.95)],
    },
    null,
    2,
  ),
);
