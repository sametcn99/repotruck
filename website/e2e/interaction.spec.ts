import { expect, test } from "@playwright/test";

test("[E69] command builder traps focus, closes with Escape and restores its opener", async ({
  page,
}) => {
  await page.goto("");
  const opener = page.getByRole("button", { name: /command builder/i });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Command builder", exact: true });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 25; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.getByLabel("Search commands").fill("changelog");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("[E69] real clipboard denial exposes the manual copy state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
    });
    document.execCommand = () => false;
  });
  await page.goto("");
  await page.getByRole("button", { name: /command builder/i }).click();
  const copy = page
    .getByRole("dialog", { name: "Command builder", exact: true })
    .getByRole("button", { name: /^Copy command:/ })
    .first();
  await copy.click();
  await expect(copy).toHaveText("Select & copy");
});

test("[E69] screenshot viewer supports keyboard focus, zoom/reset and touch pointer gestures", async ({
  page,
  isMobile,
}) => {
  await page.goto("");
  const opener = page.getByRole("button", {
    name: "Open Cockpit screenshot enlarged",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: /Cockpit — enlarged screenshot/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(dialog.locator(".lightbox-zoom")).not.toHaveText("100%");
  await dialog.getByRole("button", { name: "Reset zoom" }).click();
  await expect(dialog.locator(".lightbox-zoom")).toHaveText("100%");
  if (isMobile) {
    const stage = dialog.locator(".lightbox-stage"),
      bounds = (await stage.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const centerX = bounds.x + bounds.width / 2,
      centerY = bounds.y + bounds.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: centerX - 40, y: centerY, id: 1 },
        { x: centerX + 40, y: centerY, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: centerX - 75, y: centerY, id: 1 },
        { x: centerX + 75, y: centerY, id: 2 },
      ],
    });
    await expect(dialog.locator(".lightbox-zoom")).not.toHaveText("100%");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});
