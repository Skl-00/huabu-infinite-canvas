import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("local backup exports and restores a workspace snapshot", async ({ page }) => {
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "配置与用户偏好", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "本地存储", exact: true }).click();
    await expect(page.getByText("本地数据备份与恢复", { exact: true })).toBeVisible();

    await page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        useCanvasStore.setState({ hydrated: true, projects: [], deletedProjects: [] });
        useCanvasStore.getState().createProject("备份验收画布");
    });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出本地数据", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("huabu-local-backup.zip");
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await fs.readFile(downloadPath!);
    expect(bytes.length).toBeGreaterThan(100);

    const fileInput = page.locator('input[type="file"][accept=".zip,application/zip"]');
    await fileInput.setInputFiles({ name: "huabu-local-backup.zip", mimeType: "application/zip", buffer: bytes });
    const confirm = page.getByRole("dialog", { name: "恢复本地数据？" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "导入本地数据", exact: true }).click();
    await expect(page.getByText("已恢复 1 个画布、0 个资产、0 条任务和 0 个媒体文件", { exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        return useCanvasStore.getState().projects[0]?.title;
    })).toBe("备份验收画布");
});

test("invalid local backup is rejected before changing canvas data", async ({ page }) => {
    await page.goto("/config");
    await page.getByRole("tab", { name: "本地存储", exact: true }).click();
    await page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        useCanvasStore.setState({ hydrated: true, projects: [], deletedProjects: [] });
        useCanvasStore.getState().createProject("不可被覆盖");
    });

    const fileInput = page.locator('input[type="file"][accept=".zip,application/zip"]');
    await fileInput.setInputFiles({ name: "invalid.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
    await expect(page.getByRole("dialog", { name: "恢复本地数据？" })).toBeVisible();
    await page.getByRole("dialog", { name: "恢复本地数据？" }).getByRole("button", { name: "导入本地数据", exact: true }).click();
    await expect(page.getByText(/无法|失败|格式/)).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        return useCanvasStore.getState().projects[0]?.title;
    })).toBe("不可被覆盖");
});
