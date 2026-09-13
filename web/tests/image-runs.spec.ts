import { expect, test, type Page, type Route } from "@playwright/test";
import path from "node:path";

const provider = "https://huabu-provider.invalid";
const secret = "test-only-provider-credential";

async function loadedModule(page: Page, suffix: string) {
    return page.evaluate((suffix) => {
        const loaded = performance.getEntriesByType("resource").map((item) => item.name).filter((name) => new URL(name).pathname === suffix);
        return loaded.at(-1) || suffix;
    }, suffix);
}

async function setup(page: Page, count = 1) {
    await page.goto("/image");
    await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeVisible();
    const closeAgent = page.getByRole("button", { name: "关闭 Agent", exact: true });
    if (await closeAgent.isVisible()) await closeAgent.click();
    const configUrl = await loadedModule(page, "/src/stores/use-config-store.ts");
    await page.evaluate(async ({ configUrl, count, provider, secret }) => {
        const { useConfigStore } = await import(/* @vite-ignore */ configUrl);
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: {
            ...config, proxyEnabled: false, model: "qa::qa-image", imageModel: "qa::qa-image",
            count: String(count), size: "1024x1024", quality: "low", background: "",
            channels: [{ id: "qa", name: "QA Provider", baseUrl: provider, apiKey: secret, apiFormat: "openai", models: [{ name: "qa-image", capability: "image" }] }],
        } });
    }, { configUrl, count, provider, secret });
    return page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 384;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#dceef2";
        ctx.fillRect(0, 0, 512, 384);
        ctx.fillStyle = "#117e8b";
        ctx.fillRect(40, 40, 220, 220);
        ctx.fillStyle = "#d75968";
        ctx.fillRect(290, 100, 175, 175);
        ctx.fillStyle = "#182228";
        ctx.font = "24px sans-serif";
        ctx.fillText("HuaBu QA result", 40, 335);
        return canvas.toDataURL("image/png").split(",")[1];
    });
}

async function runs(page: Page) {
    const url = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    return page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).useImageRunStore.getState().runs, url);
}

async function storedRuns(page: Page) {
    const url = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    return page.evaluate(async (url) => {
        const { imageRunStorage } = await import(/* @vite-ignore */ url);
        const records: any[] = [];
        await imageRunStorage.iterate((value: unknown) => { records.push(value); });
        return records.sort((a, b) => b.createdAt - a.createdAt);
    }, url);
}

async function generate(page: Page, prompt = "原始产品场景，保持柔和自然的光线") {
    await page.locator("textarea").first().fill(prompt);
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
}

async function success(route: Route, png: string) {
    await route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: png }] } });
}

test("partial image generation persists and retries only failures with the frozen recipe", async ({ page }) => {
    const png = await setup(page, 2);
    const requests: any[] = [];
    await page.route(`${provider}/**`, async (route) => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 2) await route.fulfill({ status: 500, json: { error: { message: `Provider refused ${secret}` } } });
        else await success(route, png);
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("partial");
    const original = (await runs(page))[0];
    expect(original.slots.map((slot: any) => slot.status).sort()).toEqual(["failed", "success"]);
    expect(JSON.stringify(await storedRuns(page))).not.toContain(secret);
    expect(JSON.stringify(await storedRuns(page))).not.toContain("apiKey");
    expect(original.slots.find((slot: any) => slot.error).error).toContain("[已隐藏凭据]");

    await page.locator("textarea").first().fill("编辑后的提示词，不应进入重试请求");
    const configUrl = await loadedModule(page, "/src/stores/use-config-store.ts");
    await page.evaluate(async (url) => {
        const { useConfigStore } = await import(/* @vite-ignore */ url);
        useConfigStore.getState().updateConfig("size", "1536x1024");
        useConfigStore.getState().updateConfig("quality", "high");
    }, configUrl);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("button", { name: "确认重试", exact: true }).click();
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    const all = await storedRuns(page);
    expect(all).toHaveLength(2);
    expect(all[0].retryOf).toBe(original.id);
    expect(all[0].slots).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(requests[2].prompt).toBe(requests[0].prompt);
    expect(requests[2].size).toBe(requests[0].size);
    expect(requests[2].quality).toBe(requests[0].quality);
    expect(all[1].status).toBe("partial");
    await page.reload();
    await expect.poll(async () => (await runs(page)).length).toBe(2);
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    await expect(page.getByTestId("task-prompt")).toHaveText(requests[0].prompt);
    await expect(page.getByTestId("task-result").getByRole("img", { name: "生成图片 1", exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载图片 1", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/huabu-.*\.png/);
    await page.getByRole("button", { name: "存入素材 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "查看素材 1", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "查看素材 1", exact: true })).toBeVisible();

    const storageUrl = await loadedModule(page, "/src/services/image-storage.ts");
    await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).cleanupUnusedImages({}), storageUrl);
    await page.reload();
    const image = page.getByTestId("task-result").getByRole("img", { name: "生成图片 1", exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(512);
});

test("image slots never overlap Provider requests", async ({ page }) => {
    const png = await setup(page, 2);
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirst!: () => void;
    const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (calls === 1) await firstRequest;
        await success(route, png);
        inFlight--;
    });
    await generate(page, "串行图片槽位");
    await expect.poll(() => calls).toBe(1);
    expect(maxInFlight).toBe(1);
    releaseFirst();
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    expect(calls).toBe(2);
    expect(maxInFlight).toBe(1);
});

test("navigation and a second tab do not interrupt a live request or duplicate submissions", async ({ page, context }) => {
    const png = await setup(page);
    let calls = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        await hold;
        await success(route, png);
    });
    await generate(page);
    await expect.poll(() => calls).toBe(1);
    const initial = (await storedRuns(page))[0];
    expect(initial.status).toBe("running");
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\?run=/);
    const other = await context.newPage();
    await other.goto("/tasks");
    await expect.poll(async () => (await runs(other))[0]?.status).toBe("running");
    await other.getByRole("button", { name: "刷新任务记录", exact: true }).click();
    expect((await storedRuns(other))[0].status).toBe("running");
    release();
    await expect.poll(async () => (await runs(other))[0]?.status).toBe("succeeded");
    expect(calls).toBe(1);
    await page.getByRole("link", { name: "图片工作台", exact: true }).click();
    await expect(page.getByRole("img", { name: "生成结果 1", exact: true })).toBeVisible();
    expect((await runs(page))[0].id).toBe(initial.id);
    await other.close();
});

test("reloading an unfinished request records interruption without resubmission", async ({ page }) => {
    const png = await setup(page);
    let calls = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        await hold;
        await success(route, png).catch(() => undefined);
    });
    await generate(page);
    await expect.poll(() => calls).toBe(1);
    await page.reload();
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("interrupted");
    release();
    expect(calls).toBe(1);
    expect((await storedRuns(page))[0].slots[0].status).toBe("interrupted");
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    await expect(page.getByText("本地执行已中断，服务端状态未知，未自动重新提交。")).toBeVisible();
});

test("initial storage failure blocks the Provider request and double invocation submits once", async ({ page }) => {
    const png = await setup(page);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => { calls++; await success(route, png); });
    const storeUrl = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    await page.evaluate(async (url) => {
        const { imageRunStorage } = await import(/* @vite-ignore */ url);
        const original = imageRunStorage.setItem.bind(imageRunStorage);
        imageRunStorage.setItem = async (...args: unknown[]) => {
            imageRunStorage.setItem = original;
            throw new Error("QA storage unavailable");
        };
    }, storeUrl);
    await generate(page);
    await expect(page.getByText("QA storage unavailable", { exact: true })).toBeVisible();
    expect(calls).toBe(0);
    expect(await storedRuns(page)).toHaveLength(0);
    const runnerUrl = await loadedModule(page, "/src/services/image-runner.ts");
    const configUrl = await loadedModule(page, "/src/stores/use-config-store.ts");
    const statuses = await page.evaluate(async ({ runnerUrl, configUrl }) => {
        const { startImageRun } = await import(/* @vite-ignore */ runnerUrl);
        const { useConfigStore } = await import(/* @vite-ignore */ configUrl);
        const input = { prompt: "同步双击", references: [], count: 1, config: useConfigStore.getState().config };
        return (await Promise.allSettled([startImageRun(input), startImageRun(input)])).map((item) => item.status);
    }, { runnerUrl, configUrl });
    expect(statuses).toEqual(["fulfilled", "rejected"]);
    expect(calls).toBe(1);
});

test("a changed channel is rejected and missing references never reach the Provider", async ({ page }) => {
    await setup(page);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        await route.fulfill({ status: 400, json: { error: { message: "QA failed" } } });
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("failed");
    const runnerUrl = await loadedModule(page, "/src/services/image-runner.ts");
    const configUrl = await loadedModule(page, "/src/stores/use-config-store.ts");
    const id = (await runs(page))[0].id;
    const errors = await page.evaluate(async ({ runnerUrl, configUrl, id }) => {
        const { retryImageRun, startImageRun } = await import(/* @vite-ignore */ runnerUrl);
        const { useConfigStore } = await import(/* @vite-ignore */ configUrl);
        const original = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...original, channels: original.channels.map((item: any) => ({ ...item, baseUrl: "https://changed.invalid" })) } });
        const changed = await retryImageRun(id).then(() => "", (error: Error) => error.message);
        useConfigStore.setState({ config: original });
        const missing = await startImageRun({ config: original, prompt: "缺失参考图", count: 1, references: [{ id: "missing", name: "missing.png", type: "image/png", dataUrl: "", storageKey: "image:missing" }] }).then(() => "", (error: Error) => error.message);
        return { changed, missing };
    }, { runnerUrl, configUrl, id });
    expect(errors.changed).toContain("已改变");
    expect(errors.missing).toContain("已丢失");
    expect(calls).toBe(1);
    expect(await storedRuns(page)).toHaveLength(1);
});

test("result persistence failure remains visible and can be saved without regenerating", async ({ page }) => {
    const png = await setup(page);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => { calls++; await success(route, png); });
    const storeUrl = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    await page.evaluate(async (url) => {
        const { imageRunStorage } = await import(/* @vite-ignore */ url);
        const original = imageRunStorage.setItem.bind(imageRunStorage);
        (window as any).restoreTaskStorage = () => { imageRunStorage.setItem = original; };
        imageRunStorage.setItem = async (key: string, value: any) => {
            if (value.slots.some((slot: any) => slot.status === "success")) throw new Error("QA disk full");
            return original(key, value);
        };
    }, storeUrl);
    await generate(page);
    await expect.poll(async () => Boolean((await runs(page))[0]?.persistenceError)).toBe(true);
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    await expect(page.getByRole("button", { name: "重新保存", exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).restoreTaskStorage());
    await page.getByRole("button", { name: "重新保存", exact: true }).click();
    await expect.poll(async () => (await storedRuns(page))[0]?.status).toBe("succeeded");
    expect(calls).toBe(1);
    await page.reload();
    await expect(page.getByRole("button", { name: "重新保存", exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "生成图片 1", exact: true })).toBeVisible();
});

test("task views support filters, missing IDs and responsive light/dark layouts", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (["error", "warning"].includes(event.type())) errors.push(event.text()); });
    const png = await setup(page, 2);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        if (calls === 2) await route.fulfill({ json: { error: { message: "测试错误: " + "long-provider-diagnostic-".repeat(15) } } });
        else await success(route, png);
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("partial");
    await expect(page.locator(".ant-message-notice")).toHaveCount(0);
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    const selectedId = (await runs(page))[0].id;
    await page.getByRole("textbox", { name: "搜索任务" }).fill("no-match");
    await expect(page.getByText("没有匹配的任务", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "搜索任务" }).fill("");
    await page.getByText("已完成", { exact: true }).click();
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await page.getByText("待处理", { exact: true }).click();
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    const themeUrl = await loadedModule(page, "/src/stores/use-theme-store.ts");
    for (const theme of ["light", "dark"]) {
        await page.evaluate(async ({ themeUrl, theme }) => (await import(/* @vite-ignore */ themeUrl)).useThemeStore.getState().setTheme(theme), { themeUrl, theme });
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
        for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 390, height: 568 }]) {
            await page.setViewportSize(viewport);
            await expect(page.getByTestId("task-prompt")).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
            if (viewport.width === 390) {
                const menu = await page.locator(".app-menu-button").boundingBox();
                const agent = await page.getByRole("button", { name: "打开 Agent", exact: true }).boundingBox();
                expect(menu!.x + menu!.width).toBeLessThanOrEqual(agent!.x);
                expect(agent!.x + agent!.width).toBeLessThanOrEqual(viewport.width);
            }
            await page.screenshot({ path: path.resolve(`../docs/planning/image-tasks-${theme}-${viewport.width}x${viewport.height}.png`), fullPage: true, animations: "disabled" });
        }
    }
    await page.getByRole("button", { name: "返回任务列表", exact: true }).click();
    await expect(page.getByTestId("task-row")).toBeVisible();
    await page.getByTestId("task-row").click();
    await expect(page).toHaveURL(new RegExp(selectedId));
    await page.goto("/tasks?run=missing-task");
    await expect(page.getByText("找不到该任务，原记录可能不在此浏览器中", { exact: true })).toBeVisible();
    await page.locator(".app-menu-button").click();
    await page.getByRole("dialog").getByRole("link", { name: "任务", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId("task-row")).toBeVisible();
    expect(errors).toEqual([]);
});

test("Agent status reads one durable task including partial results after refresh", async ({ page }) => {
    const png = await setup(page, 2);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => {
        calls++;
        if (calls === 2) await route.fulfill({ status: 429, json: { error: { message: "rate limit" } } });
        else await success(route, png);
    });
    const agentUrl = await loadedModule(page, "/src/stores/use-workbench-agent-store.ts");
    const taskId = await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).useWorkbenchAgentStore.getState().dispatchImage({ prompt: "Agent 的图片请求", run: true }), agentUrl);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("partial");
    for (const refresh of [false, true]) {
        if (refresh) await page.reload();
        const toolsUrl = await loadedModule(page, "/src/lib/agent/agent-site-tools.ts");
        const status = await page.evaluate(async ({ toolsUrl, taskId }) => (await import(/* @vite-ignore */ toolsUrl)).runSiteTool("generation_get_status", { scope: "image", taskId }, () => {}), { toolsUrl, taskId });
        expect(status.total).toBe(1);
        expect(status.summary.partial).toBe(1);
        expect(status.tasks[0]).toMatchObject({ id: taskId, status: "partial", successCount: 1, failCount: 1 });
    }
    expect(calls).toBe(2);
});

test("reference images survive refresh and credential rotation is allowed on frozen retries", async ({ page }) => {
    const png = await setup(page);
    const requests: { path: string; auth: string; body: Buffer }[] = [];
    await page.route(`${provider}/**`, async (route) => {
        requests.push({ path: new URL(route.request().url()).pathname, auth: route.request().headers().authorization, body: route.request().postDataBuffer()! });
        if (requests.length === 1) await route.fulfill({ status: 429, json: { error: { message: "rate limit" } } });
        else await success(route, png);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.locator('img[alt="reference.png"]')).toBeVisible();
    await generate(page, "复用参考图的产品画面");
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("failed");
    const id = (await runs(page))[0].id;
    await page.reload();
    const configUrl = await loadedModule(page, "/src/stores/use-config-store.ts");
    const runnerUrl = await loadedModule(page, "/src/services/image-runner.ts");
    await page.evaluate(async ({ configUrl, runnerUrl, id, secret }) => {
        const { useConfigStore } = await import(/* @vite-ignore */ configUrl);
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, channels: config.channels.map((item: any) => ({ ...item, apiKey: `${secret}-rotated` })) } });
        await (await import(/* @vite-ignore */ runnerUrl)).retryImageRun(id);
    }, { configUrl, runnerUrl, id, secret });
    expect(requests).toHaveLength(2);
    expect(requests[1].path).toBe("/v1/images/edits");
    expect(requests[1].auth).toBe(`Bearer ${secret}-rotated`);
    for (const request of requests) expect(request.body.includes(Buffer.from(png, "base64"))).toBe(true);
    const stored = await storedRuns(page);
    expect(stored[0].request.references[0].storageKey).toBe(stored[1].request.references[0].storageKey);
    expect(JSON.stringify(stored)).not.toContain(secret);
});

test("recovery uses already saved slot results when only the final status write failed", async ({ page }) => {
    const png = await setup(page);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => { calls++; await success(route, png); });
    const storeUrl = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    await page.evaluate(async (url) => {
        const { imageRunStorage } = await import(/* @vite-ignore */ url);
        const original = imageRunStorage.setItem.bind(imageRunStorage);
        imageRunStorage.setItem = async (key: string, value: any) => {
            if (value.status === "succeeded") throw new Error("QA terminal write failed");
            return original(key, value);
        };
    }, storeUrl);
    await generate(page);
    await expect.poll(async () => Boolean((await runs(page))[0]?.persistenceError)).toBe(true);
    expect((await storedRuns(page))[0].slots[0].status).toBe("success");
    await page.reload();
    await expect.poll(async () => (await storedRuns(page))[0]?.status).toBe("succeeded");
    expect(calls).toBe(1);
});

test("asset save errors are reported and do not lose the original generated image", async ({ page }) => {
    const png = await setup(page);
    await page.route(`${provider}/**`, async (route) => success(route, png));
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    const storageUrl = await loadedModule(page, "/src/lib/localforage-storage.ts");
    await page.evaluate(async (url) => {
        const { localForageStorage } = await import(/* @vite-ignore */ url);
        const original = localForageStorage.setItem;
        localForageStorage.setItem = async (name: string, value: string) => {
            if (name === "infinite-canvas:asset_store") {
                localForageStorage.setItem = original;
                throw new Error("QA asset storage failed");
            }
            return original(name, value);
        };
    }, storageUrl);
    await page.getByRole("button", { name: "存入素材 1", exact: true }).click();
    await expect(page.getByText("素材未能保存，生成结果仍保留在任务记录中", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "存入素材 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "存入素材 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "查看素材 1", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "查看素材 1", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "生成图片 1", exact: true })).toBeVisible();
});

test("the image workbench reuses frozen parameters and shows new and legacy history on mobile", async ({ page }) => {
    const png = await setup(page);
    let calls = 0;
    await page.route(`${provider}/**`, async (route) => { calls++; await success(route, png); });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    const original = (await runs(page))[0];
    const storeUrl = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    await page.evaluate(async (url) => {
        const { imageRunStorage } = await import(/* @vite-ignore */ url);
        await imageRunStorage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" }).setItem("legacy-qa", {
            id: "legacy-qa", title: "旧版记录保留", prompt: "旧版提示词", createdAt: Date.now(), config: {}, references: [], images: [], status: "failed",
        });
    }, storeUrl);
    await page.reload();
    await page.locator("textarea").first().fill("尚未提交的改写，不能污染结果来源");
    await page.getByRole("button", { name: "加入我的资产", exact: true }).click();
    const assetUrl = await loadedModule(page, "/src/stores/use-asset-store.ts");
    const prompt = await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).useAssetStore.getState().assets[0].metadata.prompt, assetUrl);
    expect(prompt).toBe(original.request.prompt);
    await page.getByRole("button", { name: "复用参数", exact: true }).click();
    await expect(page.locator("textarea").first()).toHaveValue(original.request.prompt);
    expect(calls).toBe(1);
    await expect(page.locator(".ant-message-notice")).toHaveCount(0);
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
        if (viewport.width === 1440) {
            const overflow = await page.locator('main > aside').evaluate((element) => element.scrollWidth - element.clientWidth);
            expect(overflow).toBe(0);
        }
        await page.screenshot({ path: path.resolve(`../docs/planning/image-workbench-${viewport.width}x${viewport.height}.png`), fullPage: true, animations: "disabled" });
    }
    await page.getByRole("button", { name: "生成记录", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "生成记录", exact: true });
    await expect(drawer.getByRole("button", { name: new RegExp(original.request.prompt) })).toBeVisible();
    await expect(drawer.getByText("旧版记录保留", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: new RegExp(original.request.prompt) }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("img", { name: "生成结果 1", exact: true })).toBeVisible();
});

test("remote-only results are identified instead of claiming offline media persistence", async ({ page }) => {
    const png = await setup(page);
    const remote = "https://huabu-output.invalid/image.png";
    await page.route(`${provider}/**`, (route) => route.fulfill({ json: { data: [{ url: remote }] } }));
    await page.route(remote, async (route) => {
        if (route.request().resourceType() === "image") await route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
        else await route.abort("blockedbyclient");
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    await expect(page.getByText("远程结果，尚未本地保存", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "任务记录", exact: true }).click();
    await expect(page.getByText("远程结果，尚未本地保存", { exact: true })).toBeVisible();
    expect((await storedRuns(page))[0].slots[0].image.storageKey).toBeUndefined();
});

test("a delayed history read cannot roll a completed task back to running", async ({ page }) => {
    const png = await setup(page);
    let releaseProvider!: () => void;
    const providerReady = new Promise<void>((resolve) => { releaseProvider = resolve; });
    await page.route(`${provider}/**`, async (route) => { await providerReady; await success(route, png); });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("running");
    const storeUrl = await loadedModule(page, "/src/stores/use-image-run-store.ts");
    await page.evaluate(async (url) => {
        const { imageRunStorage, loadImageRuns } = await import(/* @vite-ignore */ url);
        const original = imageRunStorage.iterate.bind(imageRunStorage);
        const delayed = new Promise<void>((resolve) => { (window as any).releaseQaRead = resolve; });
        imageRunStorage.iterate = async (iterator: any) => {
            imageRunStorage.iterate = original;
            await original(iterator);
            (window as any).qaReadCaptured = true;
            await delayed;
        };
        void loadImageRuns().then(() => { (window as any).qaReadFinished = true; });
    }, storeUrl);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).qaReadCaptured))).toBe(true);
    releaseProvider();
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    const completed = (await runs(page))[0];
    await page.evaluate(() => (window as any).releaseQaRead());
    await expect.poll(() => page.evaluate(() => Boolean((window as any).qaReadFinished))).toBe(true);
    expect((await runs(page))[0].status).toBe("succeeded");
    expect((await runs(page))[0].revision).toBe(completed.revision);
});
