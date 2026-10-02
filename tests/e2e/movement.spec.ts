import { test, expect, type Page } from "@playwright/test";
import { importMM } from "../../shared/freemind";
const item = (page: Page, name: string) =>
  page.getByRole("treeitem", { name, exact: true });
async function documentMap(page: Page) {
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "FreeMind (.mm)", exact: true })
    .click();
  const stream = await (await pending).createReadStream(),
    chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(c);
  return importMM(Buffer.concat(chunks).toString());
}
async function drag(
  page: Page,
  from: string,
  dx: number,
  dy: number,
  cancel = false,
) {
  const b = (await item(page, from).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 12,
  });
  await expect(page.locator(".node-moving")).not.toHaveCount(0);
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
test("free drag previews branches, cancels, undoes, persists and resets", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Touch controls tested separately");
  await page.goto("/");
  const parent = item(page, "목표와 방향"),
    child = item(page, "성공의 기준");
  const a = (await parent.boundingBox())!,
    b = (await child.boundingBox())!;
  await drag(page, "목표와 방향", -70, -85, true);
  expect((await parent.boundingBox())!.x).toBeCloseTo(a.x, 0);
  await drag(page, "목표와 방향", -70, -85);
  expect((await parent.boundingBox())!.x).toBeCloseTo(a.x - 70, 0);
  expect((await child.boundingBox())!.y).toBeCloseTo(b.y - 85, 0);
  await page.keyboard.press("Control+z");
  expect((await parent.boundingBox())!.x).toBeCloseTo(a.x, 0);
  await page.keyboard.press("Control+y");
  const saved = await documentMap(page),
    id = Object.values(saved.nodes).find((n) => n.text === "목표와 방향")!.id;
  expect(saved.nodes[id].offset?.x).toBeLessThan(-50);
  await page.reload();
  await expect(parent).toBeVisible();
  const restored = await documentMap(page);
  expect(restored.nodes[id].offset).toEqual(saved.nodes[id].offset);
  await parent.click();
  await page.getByRole("button", { name: "스타일", exact: true }).click();
  await page
    .getByRole("button", { name: "선택 가지 자동배치", exact: true })
    .click();
  expect((await documentMap(page)).nodes[id].offset).toBeUndefined();
});
test("keyboard reorders, changes side and hierarchy, navigates left branches and nudges", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop keyboard");
  await page.goto("/");
  const a = item(page, "목표와 방향"),
    b = item(page, "실행 계획");
  await a.click();
  await page.keyboard.press("Control+ArrowDown");
  expect((await a.boundingBox())!.y).toBeGreaterThan(
    (await b.boundingBox())!.y,
  );
  await expect(a).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+ArrowLeft");
  const root = (await item(page, "나의 새로운 아이디어").boundingBox())!;
  expect((await a.boundingBox())!.x).toBeLessThan(root.x);
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "우리가 해결할 문제")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(a).toHaveAttribute("aria-selected", "true");
  await item(page, "성공의 기준").click();
  await page.keyboard.press("Control+ArrowLeft");
  let m = await documentMap(page);
  const node = (text: string) =>
    Object.values(m.nodes).find((n) => n.text === text)!;
  expect(node("성공의 기준").parent).toBe(node("우리가 해결할 문제").id);
  await item(page, "성공의 기준").click();
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Control+Shift+ArrowDown");
  m = await documentMap(page);
  expect(node("성공의 기준").parent).toBe(node("목표와 방향").id);
  expect(node("성공의 기준").offset).toEqual({ x: 0, y: 10 });
});
test("drop edges reorder and free mode never reparents an overlapping drop", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Mouse drag");
  await page.goto("/");
  const a = item(page, "목표와 방향"),
    b = item(page, "실행 계획");
  const target = (await b.boundingBox())!,
    source = (await a.boundingBox())!;
  await drag(
    page,
    "목표와 방향",
    target.x + target.width / 2 - source.x - source.width / 2,
    target.y + target.height - 2 - source.y - source.height / 2,
  );
  expect((await a.boundingBox())!.y).toBeGreaterThan(
    (await b.boundingBox())!.y,
  );
  await page.getByRole("button", { name: "자유배치", exact: true }).click();
  const a2 = (await a.boundingBox())!,
    b2 = (await b.boundingBox())!;
  await drag(
    page,
    "목표와 방향",
    b2.x + b2.width / 2 - a2.x - a2.width / 2,
    b2.y + b2.height / 2 - a2.y - a2.height / 2,
  );
  const m = await documentMap(page);
  expect(
    Object.values(m.nodes).find((n) => n.text === "목표와 방향")!.parent,
  ).toBe(m.root);
});
test("mobile position menu nudges and resets without dragging", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Mobile controls");
  await page.goto("/");
  await item(page, "목표와 방향").tap();
  await page.getByRole("button", { name: "속성", exact: true }).click();
  await page.getByTitle("위치 아래로 10", { exact: true }).click();
  let m = await documentMap(page);
  const id = Object.values(m.nodes).find((n) => n.text === "목표와 방향")!.id;
  expect(m.nodes[id].offset).toEqual({ x: 0, y: 10 });
  await page
    .getByRole("button", { name: "선택 가지 자동배치", exact: true })
    .click();
  m = await documentMap(page);
  expect(m.nodes[id].offset).toBeUndefined();
});
test("touch drag and pinch keep document structure intact", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile || browserName !== "chromium",
    "Native touch input through Chromium CDP",
  );
  await page.goto("/");
  const source = item(page, "목표와 방향");
  const b = (await source.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 0 }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - (30 * i) / 8, y: y - (65 * i) / 8, id: 0 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const before = await documentMap(page),
    id = Object.values(before.nodes).find((n) => n.text === "목표와 방향")!.id;
  expect(before.nodes[id].offset?.y).toBeLessThan(-50);
  const layerBefore = await page.locator(".nodes-layer").getAttribute("style");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 130, y: 400, id: 0 },
      { x: 240, y: 400, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 85, y: 400, id: 0 },
      { x: 285, y: 400, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await page.locator(".nodes-layer").getAttribute("style")).not.toBe(
    layerBefore,
  );
  const after = await documentMap(page);
  expect(after.nodes[id].offset).toEqual(before.nodes[id].offset);
  expect(after.nodes[id].parent).toBe(before.root);
});
