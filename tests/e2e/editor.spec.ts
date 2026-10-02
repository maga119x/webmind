import { test, expect } from "@playwright/test";

test("renders SVG and PNG exports and a foldable HTML document", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || isMobile,
    "Export byte checks run once.",
  );
  await page.goto("/");
  for (const label of ["SVG", "PNG", "접이식 HTML"]) {
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const download = await pending,
      stream = await download.createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (label === "PNG")
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    else
      expect(bytes.toString()).toContain(
        label === "SVG" ? "<svg" : "<details open>",
      );
  }
});

test("drag reparents a branch and menu-based mobile movement works", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Movement model is shared across engines.",
  );
  await page.goto("/");
  const source = page.getByRole("treeitem", {
      name: "목표와 방향",
      exact: true,
    }),
    target = page.getByRole("treeitem", { name: "실행 계획", exact: true });
  if (isMobile) {
    await source.tap();
    await page.getByRole("button", { name: "속성", exact: true }).click();
    const parent = page.getByRole("combobox", { name: "부모 변경" });
    await parent.selectOption({ label: "실행 계획" });
  } else {
    const a = await source.boundingBox(),
      b = await target.boundingBox();
    await page.mouse.move(a!.x + 20, a!.y + 20);
    await page.mouse.down();
    await page.mouse.move(b!.x + 20, b!.y + 20, { steps: 12 });
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "들여쓰기 텍스트", exact: true })
    .click();
  const stream = await (await pending).createReadStream(),
    chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(c);
  expect(Buffer.concat(chunks).toString()).toContain("\t실행 계획\n");
  expect(Buffer.concat(chunks).toString()).toContain("\t\t목표와 방향");
});
test("edits, undoes, searches, exports and restores a local map", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const root = page.getByRole("treeitem", {
    name: "나의 새로운 아이디어",
    exact: true,
  });
  await expect(root).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "하위", exact: true }).click();
  else await page.getByRole("button", { name: "하위 생각 Tab" }).click();
  const edit = page.getByRole("textbox", { name: "Edit node" });
  await edit.fill("한글 테스트 아이디어");
  await edit.press("Enter");
  await expect(
    page.getByRole("treeitem", { name: "한글 테스트 아이디어", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "실행 취소 Ctrl+Z" }).click();
  await expect(
    page.getByRole("treeitem", { name: "새 생각", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "다시 실행 Ctrl+Y" }).click();
  await page.getByRole("button", { name: "검색 Ctrl+F" }).click();
  await page.getByPlaceholder("생각 검색").fill("한글 테스트");
  await page.getByPlaceholder("바꿀 내용").fill("최종");
  await page.getByRole("button", { name: "모두 바꾸기" }).click();
  await expect(
    page.getByRole("treeitem", { name: "최종 아이디어", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "FreeMind (.mm)" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mm$/);
  await page.reload();
  await expect(
    page.getByRole("treeitem", { name: "최종 아이디어", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("IME composition does not create a node and style panel works", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  const root = page.getByRole("treeitem", {
    name: "나의 새로운 아이디어",
    exact: true,
  });
  if (isMobile) {
    await root.tap();
    await page.getByRole("button", { name: "편집", exact: true }).click();
  } else await root.dblclick();
  const edit = page.getByRole("textbox", { name: "Edit node" });
  await edit.dispatchEvent("compositionstart");
  await edit.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  await expect(edit).toBeVisible();
  await edit.dispatchEvent("compositionend");
  await edit.fill("입력 완료");
  await edit.press("Enter");
  await page
    .getByRole("button", { name: isMobile ? "속성" : "스타일", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "메모", exact: true })
    .fill("중요한 메모");
  await page.getByRole("button", { name: "idea", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: "입력 완료", exact: true }),
  ).toContainText("💡");
});
test("imports a FreeMind fixture and preserves extensions in export", async ({
  page,
}) => {
  await page.goto("/");
  page.on("dialog", (d) => d.accept());
  await page
    .locator('input[type=file][accept=".mm,.txt"]')
    .setInputFiles("tests/fixtures/roundtrip.mm");
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue(
    "roundtrip",
  );
  await expect(
    page.getByRole("treeitem", { name: "프로젝트 & Ideas", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "FreeMind (.mm)" }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString();
  expect(xml).toContain("example.extension");
  expect(xml).toContain('CUSTOM="keep"');
});
