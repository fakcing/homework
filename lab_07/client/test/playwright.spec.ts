import { expect, test } from "@playwright/test";

async function join(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.goto("/");
  await page.locator("#pilot").fill(name);
  const room = page.locator("button.room").first();
  await expect(room).toBeVisible();
  await room.click();
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.locator(".chat")).toBeVisible();
}

test("two browser clients share movement and chat in one room", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const page1 = await first.newPage();
  const page2 = await second.newPage();
  try {
    await join(page1, "Alpha");
    await join(page2, "Beta");
    await expect(page1.locator(".chat-title")).toContainText("2 online");
    await page1.keyboard.down("ArrowUp");
    await page1.waitForTimeout(400);
    await page1.keyboard.up("ArrowUp");
    await expect(page2.locator(".chat-title")).toContainText("2 online");
    await page1.locator(".chat-input").fill("hello from browser one");
    await page1.locator(".chat-input").press("Enter");
    await expect(page2.locator(".chat-log")).toContainText("hello from browser one");
  } finally {
    await first.close();
    await second.close();
  }
});
