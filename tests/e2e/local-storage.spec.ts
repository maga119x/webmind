import { test, expect } from "@playwright/test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
test("guest creates multiple local maps with images, reloads and exports ZIP without signup", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "문서 제목" })
    .fill("Local image map");
  await page
    .locator('input[type=file][accept^="image/png"]')
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".node-image")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue(
    "Local image map",
  );
  await expect(page.locator(".node-image")).toBeVisible();
  await page.getByRole("button", { name: "내 마인드맵", exact: true }).click();
  await page.getByRole("button", { name: "로컬 문서", exact: true }).click();
  await page
    .getByRole("textbox", { name: "문서 제목" })
    .fill("Second local map");
  await page.getByRole("button", { name: "내 마인드맵", exact: true }).click();
  await page.getByRole("button", { name: /Local image map/ }).click();
  await expect(page.locator(".node-image")).toBeVisible();
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /zip/i }).click();
  expect((await download).suggestedFilename()).toBe("Local image map.zip");
});
