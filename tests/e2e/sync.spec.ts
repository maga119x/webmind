import { test, expect, type Page } from "@playwright/test";
import { emptyMap } from "../../shared/model";

test("opening the remote version cannot replace edits made while the recovery copy is being prepared", async ({
  page,
}) => {
  const original = await setup(page, "Recovery race");
  const path = `/api/maps/${original.id}`;
  await page.request.put(path, {
    data: {
      title: "Actual external change",
      document: original.document,
      revision: original.revision,
    },
  });
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await title.fill("Current unsaved work");
  await expect(page.locator(".save-alert")).toContainText("Drive 저장본");
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const remote = await route.fetch();
    observed();
    await held;
    await route.fulfill({ response: remote });
  });
  await page.getByRole("button", { name: /최신본 열기/ }).click();
  await started;
  await title.fill("최신본을 기다리는 동안 추가한 작업");
  release();
  await expect(page.getByRole("status")).toContainText("현재 작업을 유지");
  await expect(title).toHaveValue("최신본을 기다리는 동안 추가한 작업");
  await page.unroute(`**${path}`);
  await page.reload();
  await expect(title).toHaveValue("최신본을 기다리는 동안 추가한 작업");
  await expect(page.locator(".save-alert")).toContainText("Drive 저장본");
  await page.getByRole("button", { name: /최신본 열기/ }).click();
  await expect(title).toHaveValue("Actual external change");
  await page.getByRole("button", { name: "내 마인드맵", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /최신본을 기다리는 동안 추가한 작업 복구본/,
    }),
  ).toBeVisible();
});

async function setup(page: Page, name: string) {
  await page.goto("/");
  const email = `sync-${crypto.randomUUID()}@example.com`;
  await page.request.post("/api/auth/sign-up/email", {
    data: { email, password: "test-password-12345", name: "Sync regression" },
  });
  const mail = (
    await (await page.request.get("/api/dev/mailbox")).json()
  ).findLast((m: any) => m.to === email);
  await page.request.get(mail.url);
  const created = await (
    await page.request.post("/api/maps", {
      data: { title: name, document: emptyMap("보존할 생각") },
    })
  ).json();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue(
    name,
  );
  return created;
}

test("typing while a protected save is in flight keeps the newer text and uses the new file id", async ({
  page,
}) => {
  const original = await setup(page, "Typing during save");
  await page.request.post(`/api/test-drive/${original.id}/metadata`, {
    data: { safeCopy: true },
  });
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route(`**/api/maps/${original.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const acknowledged = await route.fetch();
    observed();
    await held;
    await route.fulfill({ response: acknowledged });
  });
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await title.fill("First in-flight snapshot");
  await started;
  await title.fill("저장 중 추가한 최종 작업");
  release();
  await expect(page.locator(".save-status")).toContainText(
    "변경본을 별도 Drive 파일로 저장했습니다",
  );
  await expect(title).toHaveValue("저장 중 추가한 최종 작업 변경본");
  await expect(page.locator(".save-alert")).toHaveCount(0);
  await page.reload();
  await expect(title).toHaveValue("저장 중 추가한 최종 작업 변경본");
});

test("a delayed pre-save read cannot conflict with or roll back this tab's own save", async ({
  page,
}) => {
  const original = await setup(page, "Single browser");
  const path = `/api/maps/${original.id}`;
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let intercepted = false;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "GET" || intercepted)
      return route.continue();
    intercepted = true;
    const old = await route.fetch();
    observed();
    await held;
    await route.fulfill({ response: old });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await started;
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await title.fill("First acknowledged edit");
  await expect(page.locator(".save-status")).toContainText(
    "Google Drive 저장 완료",
  );
  await title.fill("Second edit made before old read returns");
  release();
  await expect(page.locator(".save-status")).toContainText(
    "Google Drive 저장 완료",
  );
  await expect(page.locator(".save-alert")).toHaveCount(0);
  await expect(title).toHaveValue("Second edit made before old read returns");
  expect((await (await page.request.get(path)).json()).title).toBe(
    "Second edit made before old read returns",
  );
  await page.reload();
  await expect(title).toHaveValue("Second edit made before old read returns");
});

test("safe copies survive invisible Drive updates, continued editing and offline reload", async ({
  page,
  context,
}) => {
  let current = await setup(page, "Protected document");
  const title = page.getByRole("textbox", { name: "문서 제목" });
  for (let i = 1; i <= 3; i++) {
    await page.request.post(`/api/test-drive/${current.id}/metadata`, {
      data: { safeCopy: true },
    });
    await title.fill(`보호 모드 연속 편집 ${i}`);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith(`/api/maps/${current.id}`),
    );
    await expect(page.locator(".save-status")).toContainText(
      "변경본을 별도 Drive 파일로 저장했습니다",
    );
    const response = await saved;
    expect(response.status()).toBe(200);
    const previous = current.id;
    current = await response.json();
    expect(current.id).not.toBe(previous);
    await expect(title).toHaveValue(`보호 모드 연속 편집 ${i} 변경본`);
    await expect(page.locator(".save-alert")).toHaveCount(0);
  }
  await context.setOffline(true);
  await title.fill("아직 저장되지 않은 최신 작업");
  await expect(page.locator(".save-status")).toContainText("연결 대기");
  // Abort writes during reload so the recovered draft must survive remote reads.
  await page.route("**/api/maps/*", async (route) => {
    if (route.request().method() === "PUT") return route.abort();
    await route.continue();
  });
  await context.setOffline(false);
  await page.reload();
  await expect(title).toHaveValue("아직 저장되지 않은 최신 작업");
  await expect(page.locator(".save-status")).toContainText("연결 대기");
  await expect(page.locator(".save-alert")).toHaveCount(0);
  await page.unroute("**/api/maps/*");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".save-status")).toContainText(
    "변경본을 별도 Drive 파일로 저장했습니다",
  );
  await expect(title).toHaveValue("아직 저장되지 않은 최신 작업 변경본");
});
