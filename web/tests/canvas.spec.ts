import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function enterCanvas(page: Page) {
    await page.goto("/canvas?mode=new");
    await expect(page.getByRole("button", { name: "文本", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/canvas\/[^?]+/);
    await expect.poll(async () => (await snapshot(page)).length).toBeGreaterThan(0);
}

async function snapshot(page: Page) {
    return page.evaluate(async () => {
        const loadedStoreUrl = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((name) => /\/src\/stores\/canvas\/use-canvas-store\.ts(?:\?|$)/.test(name));
        const storeUrl = loadedStoreUrl ? new URL(loadedStoreUrl).href : "/src/stores/canvas/use-canvas-store.ts";
        const { useCanvasStore } = await import(/* @vite-ignore */ storeUrl);
        return useCanvasStore.getState().projects;
    });
}

async function dragNode(page: Page, index: number, dx: number, dy: number) {
    const box = await page.locator(".node-element").nth(index).boundingBox();
    if (!box) throw new Error("Missing node");
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 12 + dy, { steps: 12 });
    await page.mouse.up();
}

async function connect(page: Page, fromIndex: number, fromSide: string, toIndex: number, toSide: string) {
    const from = page.locator(".node-element").nth(fromIndex);
    const to = page.locator(".node-element").nth(toIndex);
    await from.hover();
    const a = await from.locator(`[data-connection-handle="${fromSide}"]`).boundingBox();
    const b = await to.locator(`[data-connection-handle="${toSide}"]`).boundingBox();
    if (!a || !b) throw new Error("Missing handles");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
}

test("immediate creation, directional connection, duplicate prevention and reload", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await enterCanvas(page);
    await page.getByLabel("文本", { exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await dragNode(page, 0, -280, -70);
    await page.getByLabel("文本", { exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(2);
    await dragNode(page, 1, 260, 70);
    await connect(page, 0, "right", 1, "left");
    await expect(page.locator("[data-connection-id]")).toHaveCount(1);
    await connect(page, 1, "left", 0, "right");
    await expect(page.locator("[data-connection-id]")).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page))[0].connections.length).toBe(1);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator("[data-connection-id]")).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("right click creates at pointer and right dragging never moves a node", async ({ page }) => {
    await enterCanvas(page);
    await page.mouse.click(1100, 370, { button: "right" });
    const menu = page.getByRole("dialog", { name: "选择节点" });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: /^文本/ }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    const before = (await snapshot(page))[0].nodes[0].position;
    await page.mouse.move(1100, 370);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(1020, 300, { steps: 5 });
    await page.mouse.up({ button: "right" });
    expect((await snapshot(page))[0].nodes[0].position).toEqual(before);
    await page.keyboard.press("Escape");
    await page.mouse.click(1425, 945, { button: "right" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(960);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
});

test("pointer cancellation removes the unfinished connection", async ({ page }) => {
    await enterCanvas(page);
    await page.getByLabel("文本", { exact: true }).click();
    const node = page.locator(".node-element");
    await node.hover();
    const handle = await node.locator('[data-connection-handle="right"]').boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(1200, 600, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("[data-connection-create-menu]")).toHaveCount(0);
    await expect(page.locator("[data-connection-id]")).toHaveCount(0);
    await page.mouse.click(1200, 600);
    await page.getByLabel("文本", { exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(2);
});

test("canvas appearance persists the default image size and connection visibility", async ({ page }) => {
    await enterCanvas(page);
    await page.getByRole("button", { name: "画布外观", exact: true }).click();
    await page.getByLabel("默认生图画幅").click();
    await page.getByText("9:16", { exact: true }).last().click();
    await page.getByRole("switch", { name: "显示连线" }).uncheck();
    await page.getByRole("button", { name: "画布外观", exact: true }).click();

    await page.getByRole("button", { name: "图片", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    const created = (await snapshot(page))[0];
    expect(created.nodes[0].metadata.size).toBe("9:16");
    expect(created.nodes[0].height).toBeGreaterThan(created.nodes[0].width);

    await page.mouse.click(620, 300, { button: "right" });
    await page.getByRole("dialog", { name: "选择节点" }).getByRole("button", { name: /^文本/ }).click();
    await page.mouse.click(1050, 520, { button: "right" });
    await page.getByRole("dialog", { name: "选择节点" }).getByRole("button", { name: /^文本/ }).click();
    await connect(page, 1, "right", 2, "left");
    await expect.poll(async () => (await snapshot(page))[0].connections.length).toBe(1);
    await expect(page.locator("[data-connection-id]")).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.reload();
    await expect.poll(async () => (await snapshot(page))[0].connections.length).toBe(1);
    await expect(page.locator("[data-connection-id]")).toHaveCount(0);

    await page.getByRole("button", { name: "画布外观", exact: true }).click();
    await page.getByRole("switch", { name: "显示连线" }).check();
    await page.getByRole("button", { name: "画布外观", exact: true }).click();
    await expect(page.locator("[data-connection-id]")).toHaveCount(1);
});

test("workspaces isolate scenes, clone graph IDs and round-trip the whole archive", async ({ page }) => {
    await enterCanvas(page);
    const masterUrl = page.url();
    await page.getByRole("button", { name: "文本", exact: true }).click();
    const masterId = (await snapshot(page))[0].nodes[0].id;
    await page.getByRole("button", { name: "添加工作画布" }).click();
    await page.getByRole("menuitem", { name: "故事 / 剧本" }).click();
    await expect(page.locator(".node-element")).toHaveCount(0);
    await expect(page).not.toHaveURL(masterUrl);
    const storyUrl = page.url();
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.getByRole("button", { name: "工作画布菜单" }).click();
    await page.getByRole("menuitem", { name: "复制工作画布" }).click();
    await expect(page).not.toHaveURL(storyUrl);
    await expect(page.locator(".node-element")).toHaveCount(1);
    const all = await snapshot(page);
    expect(all).toHaveLength(3);
    expect(new Set(all.flatMap((p: any) => p.nodes.map((n: any) => n.id))).size).toBe(3);
    expect(all[0].nodes[0].id).toBe(masterId);
    await page.getByRole("button", { name: "工作画布菜单" }).click();
    await page.getByRole("menuitem", { name: "重命名画布" }).click();
    await page.getByRole("textbox", { name: "画布名称" }).fill("分镜验证");
    await page.locator(".ant-modal-footer").getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("分镜验证", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "打开画布菜单" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "导出当前画布" }).click();
    const download = await downloadPromise;
    const archive = await download.path();
    expect(archive).toBeTruthy();
    await page.goto("/canvas");
    await page.locator('input[type="file"]').setInputFiles(archive!);
    await expect.poll(async () => (await snapshot(page)).length).toBe(6);
    const imported = await snapshot(page);
    expect(new Set(imported.map((p: any) => p.workspaceId || p.id)).size).toBe(2);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator("article")).toHaveCount(2);
});

test("clone semantics keep media and plugin data, remap groups and remove active task IDs", async ({ page }) => {
    await enterCanvas(page);
    const result = await page.evaluate(async () => {
        const { cloneSceneGraph } = await import("/src/lib/canvas/canvas-workspaces.ts");
        const nodes = [
            { id: "group", type: "group", title: "G", position: { x: 0, y: 0 }, width: 400, height: 400 },
            { id: "video", type: "video", title: "V", position: { x: 20, y: 20 }, width: 200, height: 100, metadata: { groupId: "group", status: "loading", videoTaskId: "active-job", storageKey: "video:keep" } },
            { id: "plugin", type: "custom:node", title: "P", position: { x: 220, y: 20 }, width: 200, height: 100, metadata: { customValue: 42 } },
        ];
        return cloneSceneGraph({ nodes, connections: [{ id: "edge", fromNodeId: "video", toNodeId: "plugin" }] } as any);
    });
    expect(result.nodes[1].metadata.groupId).toBe(result.nodes[0].id);
    expect(result.nodes[1].metadata.videoTaskId).toBeUndefined();
    expect(result.nodes[1].metadata.storageKey).toBe("video:keep");
    expect(result.nodes[1].metadata.status).toBe("error");
    expect(result.nodes[2].metadata.customValue).toBe(42);
    expect(result.connections[0].fromNodeId).toBe(result.nodes[1].id);
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 390, height: 568 }]) {
    test(`controls, panels and menus remain visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await enterCanvas(page);
        for (const name of ["文本", "图片", "添加工作画布", "创作设置"]) {
            const control = page.getByRole("button", { name, exact: true });
            const box = await control.boundingBox();
            expect(box).toBeTruthy();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
            await control.click({ trial: true });
        }
        await page.getByRole("button", { name: "图片", exact: true }).click();
        const editor = page.locator(".canvas-editor-overlay");
        await expect(editor).toBeVisible();
        const box = await editor.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 100);
        await page.screenshot({ path: path.resolve(`../docs/planning/alignment-editor-${viewport.width}x${viewport.height}.png`) });
        await page.getByRole("button", { name: "素材库", exact: true }).click();
        await expect(editor).toHaveCount(0);
        await page.getByRole("button", { name: "关闭资源面板" }).click();
        await expect(editor).toBeVisible();
        await page.getByRole("button", { name: "关闭节点编辑器" }).click();
        await page.mouse.click(viewport.width - 8, 160, { button: "right" });
        const menu = page.getByRole("dialog", { name: "选择节点" });
        await expect(menu).toBeVisible();
        const menuBox = await menu.boundingBox();
        expect(menuBox!.y).toBeGreaterThanOrEqual(0);
        expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press("Escape");
        await page.screenshot({ path: path.resolve(`../docs/planning/alignment-canvas-${viewport.width}x${viewport.height}.png`) });
        expect(errors).toEqual([]);
    });
}
