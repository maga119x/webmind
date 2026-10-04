import { test, expect } from "@playwright/test";
import { emptyMap } from "../../shared/model";
test("email signup, cloud autosave, offline retry, conflict copy, image duplication and logout", async ({
  page,
  context,
  request,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || isMobile,
    "Full cloud flow runs once; editor coverage runs in every engine.",
  );
  test.setTimeout(60000);
  const email = `browser-${Date.now()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "로그인 / 가입" }).click();
  await page
    .getByRole("button", { name: "새 계정 만들기", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("Browser Tester");
  await page.getByRole("textbox", { name: "이메일", exact: true }).fill(email);
  await page.getByLabel("비밀번호 (10자 이상)").fill("test-password-12345");
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("메일함");
  let verify = "";
  await expect
    .poll(async () => {
      const messages = await (await request.get("/api/dev/mailbox")).json();
      verify = messages.findLast((m: any) => m.to === email)?.url ?? "";
      return verify;
    })
    .not.toBe("");
  await page.goto(verify);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await title.fill("Cloud original");
  await page.getByRole("button", { name: "Drive에 저장", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText(
    "Google Drive 저장 완료",
  );
  const maps = await (await page.request.get("/api/maps")).json();
  const id = maps[0].id;
  await context.setOffline(true);
  await title.fill("Offline change");
  await expect(page.locator(".save-status")).toContainText("연결 대기");
  await context.setOffline(false);
  await expect(page.locator(".save-status")).toContainText(
    "Google Drive 저장 완료",
  );
  expect((await (await page.request.get(`/api/maps/${id}`)).json()).title).toBe(
    "Offline change",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .locator('input[type=file][accept^="image/png"]')
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".node-image")).toBeVisible();
  await expect(page.locator(".save-status")).toContainText(
    "Google Drive 저장 완료",
  );
  const current = await (await page.request.get(`/api/maps/${id}`)).json();
  expect(
    (
      await page.request.put(`/api/maps/${id}`, {
        data: {
          title: "Other device",
          revision: current.revision,
          document: current.document,
        },
      })
    ).status(),
  ).toBe(200);
  await title.fill("My conflict change");
  await expect(page.getByRole("alert")).toContainText("Drive 저장본");
  await page.getByRole("button", { name: "복사본 저장", exact: true }).click();
  await expect(title).toHaveValue("My conflict change 충돌 복사본");
  await expect(page.locator(".node-image")).toBeVisible();
  const copyList = await (await page.request.get("/api/maps")).json();
  const copied = copyList.find((m: any) => m.id !== id);
  const copiedDoc = await (
    await page.request.get(`/api/maps/${copied.id}`)
  ).json();
  expect(copiedDoc.document.nodes[copiedDoc.document.root].image).toContain(
    copied.id,
  );
  await page.request.delete(`/api/maps/${id}`);
  await page.reload();
  await expect(page.locator(".node-image")).toBeVisible();
  expect(
    await page
      .locator(".node-image")
      .evaluate((img: HTMLImageElement) => img.naturalWidth > 0),
  ).toBe(true);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인 / 가입" }),
  ).toBeVisible();
  expect((await page.request.get(`/api/maps/${copied.id}`)).status()).toBe(401);
});

test("two browser contexts preserve dirty changes, reload drafts and isolate guest work", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "문서 제목" })
    .fill("Guest private draft");
  await expect(page.locator(".save-status")).toContainText("이 기기에 저장됨");
  const email = `contexts-${Date.now()}@example.com`;
  await page.request.post("/api/auth/sign-up/email", {
    data: { email, password: "test-password-12345", name: "Contexts" },
  });
  const mail = (
    await (await page.request.get("/api/dev/mailbox")).json()
  ).findLast((m: any) => m.to === email);
  await page.request.get(mail.url);
  const created = await (
    await page.request.post("/api/maps", {
      data: { title: "Shared original", document: emptyMap("Shared root") },
    })
  ).json();
  await page.reload();
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await expect(title).toHaveValue("Shared original");
  await page.getByRole("button", { name: "내 마인드맵", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Guest private draft/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const otherContext = await browser.newContext({
    storageState: await context.storageState(),
    baseURL: "http://localhost:4173",
  });
  try {
    const other = await otherContext.newPage();
    await other.goto("/");
    await other
      .getByRole("textbox", { name: "문서 제목" })
      .fill("Changed in second browser");
    await expect(other.locator(".save-status")).toContainText(
      "Google Drive 저장 완료",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(title).toHaveValue("Changed in second browser");
    // Keep browser one offline while the second browser commits its next revision.
    await context.setOffline(true);
    await title.fill("Offline unsynced draft");
    await expect(page.locator(".save-status")).toContainText("연결 대기");
    await other
      .getByRole("textbox", { name: "문서 제목" })
      .fill("Second browser latest");
    await expect(other.locator(".save-status")).toContainText(
      "Google Drive 저장 완료",
    );
    await context.setOffline(false);
    await expect(page.getByRole("alert")).toContainText("Drive 저장본");
    await page.reload();
    await expect(title).toHaveValue("Offline unsynced draft");
    await expect(page.getByRole("alert")).toContainText("Drive 저장본");
    await page.getByRole("button", { name: /최신본 열기/ }).click();
    await expect(title).toHaveValue("Second browser latest");
    await page
      .getByRole("button", { name: "내 마인드맵", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Offline unsynced draft 복구본/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      (await (await page.request.get(`/api/maps/${created.id}`)).json()).title,
    ).toBe("Second browser latest");
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(title).toHaveValue("Guest private draft");
    await page
      .getByRole("button", { name: "내 마인드맵", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: /Offline unsynced draft|Second browser latest/,
      }),
    ).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});
