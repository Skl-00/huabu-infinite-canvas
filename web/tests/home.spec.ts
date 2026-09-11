import { expect, test } from "@playwright/test";

test("home community entry opens the prompt library", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/<canvas>|<content>/)).toHaveCount(0);
    const entry = page.getByRole("button", { name: "进入提示词社区", exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/\/prompts$/);
});
