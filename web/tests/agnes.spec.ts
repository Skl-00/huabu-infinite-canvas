import { expect, test, type Page } from "@playwright/test";

const provider = "https://api.agnes-ai.cn";
const key = "test-only-agnes-key";

async function setup(page: Page) {
    await page.goto("/video");
    await expect(page.locator("textarea").first()).toBeVisible();
    const close = page.getByRole("button", { name: "关闭 Agent", exact: true });
    if (await close.isVisible()) await close.click();
    await page.evaluate(async (key) => {
        const { useConfigStore, configureAgnesChannel } = await import("/src/stores/use-config-store.ts");
        const config = configureAgnesChannel(useConfigStore.getState().config, key);
        useConfigStore.setState({ config: { ...config, size: "16:9", vquality: "720", videoSeconds: "5", count: "1", proxyEnabled: false } });
    }, key);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "模型" })).toContainText("agnes-video-2.5-flash");
}

async function logs(page: Page, legacy = false) {
    return page.evaluate(async (legacy) => {
        const { default: localforage } = await import("/node_modules/.vite/deps/localforage.js");
        const store = localforage.createInstance({ name: "infinite-canvas", storeName: legacy ? "video_generation_logs" : "video_runs" });
        const result: any[] = [];
        await store.iterate((value: any) => { result.push(value); });
        return result;
    }, legacy);
}

async function createTask(page: Page) {
    return page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const config = useConfigStore.getState().config;
        return createVideoGenerationTask({ ...config, model: config.videoModel }, "A glass of water");
    });
}

async function poll(page: Page, task: any) {
    return page.evaluate(async (task) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { pollVideoGenerationTask } = await import("/src/services/api/video.ts");
        try {
            const result = await pollVideoGenerationTask(useConfigStore.getState().config, task);
            return { status: result.status, error: result.status === "failed" ? result.error : undefined, bytes: result.status === "completed" ? result.result.blob?.size : undefined };
        } catch (error: any) { return { error: error.message }; }
    }, task);
}

test("Agnes preset preserves other channels and survives reload with three selected models", async ({ page }) => {
    await setup(page);
    await page.reload();
    const configured = await page.evaluate(async () => {
        const { useConfigStore, configureAgnesChannel } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const next = configureAgnesChannel(config);
        return { channels: next.channels.map((c: any) => ({ id: c.id, format: c.apiFormat, models: c.models.map((m: any) => m.name) })), defaults: [next.textModel, next.imageModel, next.videoModel] };
    });
    expect(configured.channels).toHaveLength(2);
    expect(configured.channels.filter((c: any) => c.format === "agnes")).toHaveLength(1);
    expect(configured.defaults.map((x: string) => x.split("::")[1])).toEqual(["agnes-2.5-flash", "agnes-image-2.5-flash", "agnes-video-2.5-flash"]);
    const preserved = await page.evaluate(async () => {
        const { useConfigStore, configureAgnesChannel } = await import("/src/stores/use-config-store.ts");
        const config = structuredClone(useConfigStore.getState().config);
        const original = config.channels.find((channel: any) => channel.apiFormat === "agnes")!;
        original.name = "My Agnes";
        original.models[0].script = "return 'custom text';";
        original.models.push({ name: "custom-model", capability: "text", script: "return 'custom model';" });
        config.channels.push({ ...structuredClone(original), id: "custom-endpoint", baseUrl: "https://custom.invalid/v1" });
        const next = configureAgnesChannel(config);
        return {
            channel: next.channels.find((channel: any) => channel.id === original.id),
            custom: next.channels.find((channel: any) => channel.id === "custom-endpoint"),
        };
    });
    expect(preserved.channel).toMatchObject({ name: "My Agnes", apiKey: key });
    expect(preserved.channel.models).toHaveLength(4);
    expect(preserved.channel.models[0].script).toBe("return 'custom text';");
    expect(preserved.channel.models.at(-1).name).toBe("custom-model");
    expect(preserved.custom.baseUrl).toBe("https://custom.invalid/v1");
});

test("Agnes image generation and editing use the documented JSON fields and endpoint", async ({ page }) => {
    await setup(page);
    const requests: any[] = [];
    await page.route(`${provider}/**`, async (route) => {
        requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
        await route.fulfill({ json: { data: [{ b64_json: "cG5n" }] } });
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { requestGeneration, requestEdit } = await import("/src/services/api/image.ts");
        const c = useConfigStore.getState().config;
        const config = { ...c, model: c.imageModel, quality: "medium", size: "16:9" };
        await requestGeneration(config, "Create");
        await requestEdit(config, "Edit", [{ id: "ref", name: "reference", type: "image/png", dataUrl: "data:image/png;base64,cG5n" }]);
    });
    expect(requests.map((r) => r.url)).toEqual([`${provider}/v1/images/generations`, `${provider}/v1/images/generations`]);
    expect(requests[0].body).toMatchObject({ size: "2K", ratio: "16:9", extra_body: { response_format: "b64_json" } });
    expect(requests[1].body.extra_body.image).toEqual(["data:image/png;base64,cG5n"]);
    expect(requests[0].body).not.toHaveProperty("response_format");
    expect(requests[0].body).not.toHaveProperty("output_format");
});

test("Agnes stores video_id and queries the original provider without exposing credentials", async ({ page }) => {
    await setup(page);
    const requests: any[] = [];
    let status = "queued";
    await page.route(`${provider}/**`, async (route) => {
        requests.push({ url: route.request().url(), auth: route.request().headers().authorization, body: route.request().method() === "POST" ? route.request().postDataJSON() : undefined });
        await route.fulfill({ json: route.request().method() === "POST"
            ? { id: "task-1", video_id: "video-2", status: "queued" }
            : status === "completed" ? { status, url: "https://media.invalid/result.mp4" } : { status, metadata: { url: "https://media.invalid/result.mp4" } } });
    });
    let downloads = 0;
    await page.route("https://media.invalid/**", async (route) => { downloads++; await route.fulfill({ contentType: "video/mp4", body: Buffer.from("video-test") }); });
    const task = await createTask(page);
    expect(task.id).toBe("task-1");
    expect(task.videoId).toBe("video-2");
    expect(JSON.stringify(task)).not.toContain(key);
    expect(requests[0].body).toEqual({ model: "agnes-video-2.5-flash", prompt: "A glass of water", seconds: "5", size: "720P", aspect_ratio: "16:9", mode: "text" });
    expect((await poll(page, task)).status).toBe("pending");
    expect(downloads).toBe(0);
    status = "pending";
    expect((await poll(page, task)).status).toBe("pending");
    expect(new URL(requests[1].url).pathname).toBe("/agnesapi");
    expect(new URL(requests[1].url).searchParams.get("video_id")).toBe("video-2");
    expect(new URL(requests[1].url).searchParams.get("model_name")).toBe("agnes-video-2.5-flash");
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const c = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...c, videoModel: c.channels[0].id + "::grok-imagine-video", channels: c.channels.map((x: any) => x.apiFormat === "agnes" ? { ...x, apiKey: "rotated-key" } : x) } });
    });
    status = "completed";
    expect(await poll(page, task)).toMatchObject({ status: "completed", bytes: 10 });
    expect(requests.at(-1).auth).toBe("Bearer rotated-key");
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const c = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...c, channels: c.channels.map((x: any) => x.apiFormat === "agnes" ? { ...x, baseUrl: "https://other.invalid/v1" } : x) } });
    });
    expect((await poll(page, task)).error).toContain("原渠道地址");
    expect(requests).toHaveLength(4);
    expect((await poll(page, { ...task, binding: undefined })).error).toContain("没有原渠道记录");
});

test("local video references are rejected before sending and remote references keep keyframe semantics", async ({ page }) => {
    await setup(page);
    const requests: any[] = [];
    await page.route(`${provider}/**`, async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { id: "task", video_id: "video" } });
    });
    const localError = await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const c = useConfigStore.getState().config;
        try { await createVideoGenerationTask({ ...c, model: c.videoModel }, "local", [{ id: "1", name: "local", type: "image/png", dataUrl: "blob:http://127.0.0.1/local" }]); }
        catch (e: any) { return e.message; }
    });
    expect(localError).toContain("本地参考素材");
    expect(requests).toHaveLength(0);
    await page.getByRole("button", { name: "添加参考图链接" }).click();
    await page.getByRole("textbox", { name: "参考图链接" }).fill("https://media.invalid/ref.png");
    await page.getByRole("dialog").getByRole("button", { name: /添\s*加/ }).click();
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const c = useConfigStore.getState().config;
        await createVideoGenerationTask({ ...c, model: c.videoModel }, "remote", [{ id: "1", name: "remote", type: "image/png", dataUrl: "https://media.invalid/ref.png" }]);
    });
    expect(requests[0]).toMatchObject({ mode: "keyframe", first_frame: "https://media.invalid/ref.png" });
    expect(requests[0]).not.toHaveProperty("images");
});

test("Agnes Flash enforces its video limits before POST and normalizes legacy settings", async ({ page }) => {
    await setup(page);
    const requests: any[] = [];
    await page.route(`${provider}/**`, async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { id: "task", video_id: "video" } });
    });
    const sixImages = Array.from({ length: 6 }, (_, index) => ({ id: String(index), name: `ref-${index}`, type: "image/png", dataUrl: `https://media.invalid/${index}.png` }));
    const tooMany = await page.evaluate(async (references) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const c = useConfigStore.getState().config;
        try {
            await createVideoGenerationTask({ ...c, model: c.videoModel, vquality: "1080", videoSeconds: "30", videoMode: "frames" }, "too many", references);
            return "";
        } catch (error: any) {
            return error.message;
        }
    }, sixImages);
    expect(tooMany).toContain("最多支持 5 张");
    expect(requests).toHaveLength(0);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const c = useConfigStore.getState().config;
        await createVideoGenerationTask({ ...c, model: c.videoModel, vquality: "1080", videoSeconds: "30", videoMode: "frames" }, "normalized", [{ id: "1", name: "ref", type: "image/png", dataUrl: "https://media.invalid/ref.png" }]);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ seconds: "12", size: "720P", mode: "keyframe", first_frame: "https://media.invalid/ref.png" });
});

test("video workbench saves before POST, redacts errors and resumes queries without resubmitting", async ({ page }) => {
    await setup(page);
    let posts = 0;
    let gets = 0;
    let savedBeforePost = false;
    await page.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") {
            posts++;
            savedBeforePost = (await logs(page)).some((log) => log.status === "running" && !log.task);
            await route.fulfill({ json: { id: "task", video_id: "video" } });
        } else {
            gets++;
            await route.fulfill({ status: 429, json: { detail: `rate limited ${key}` } });
        }
    });
    await page.locator("textarea").first().fill("Pending task");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.getByRole("button", { name: "继续查询原任务" })).toBeVisible();
    expect(savedBeforePost).toBe(true);
    expect(posts).toBe(1);
    expect(gets).toBe(1);
    expect(JSON.stringify(await logs(page))).not.toContain(key);
    await page.reload();
    await expect(page.getByRole("button").filter({ hasText: "Pending task" })).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Pending task" }).click();
    await page.getByRole("button", { name: "继续查询原任务" }).click();
    await expect.poll(() => gets).toBe(2);
    expect(posts).toBe(1);
});

test("unknown pending submission and legacy task never auto POST or query another channel", async ({ page }) => {
    await setup(page);
    await page.evaluate(async () => {
        const { default: lf } = await import("/node_modules/.vite/deps/localforage.js");
        const store = lf.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
        await store.setItem("unknown", { id: "unknown", title: "Unknown submission", status: "pending", config: {}, references: [] });
        await store.setItem("legacy", { id: "legacy", title: "Legacy task", status: "pending", config: {}, references: [], task: { id: "old", provider: "openai", model: "default::grok-imagine-video" } });
    });
    let requests = 0;
    await page.route(/https:\/\/api\.(agnes-ai\.cn|openai\.com)\//, async (route) => { requests++; await route.abort(); });
    await page.reload();
    await expect(page.getByRole("button").filter({ hasText: "Unknown submission" })).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Unknown submission" }).click();
    await expect(page.getByText("旧任务待核对，请先在原服务检查。不会自动重新生成")).toBeVisible();
    expect(requests).toBe(0);
});

test("media errors cannot be saved as local video bytes", async ({ page }) => {
    await setup(page);
    await page.route("https://media.invalid/**", (route) => route.fulfill({ status: 403, contentType: "text/html", body: "<html>denied</html>" }));
    const error = await page.evaluate(async () => {
        const { uploadMediaFile } = await import("/src/services/file-storage.ts");
        try { await uploadMediaFile("https://media.invalid/bad.mp4", "video"); }
        catch (e: any) { return e.message; }
    });
    expect(error).toContain("403");
});

test("copying a canvas scene never copies the original video execution identity", async ({ page }) => {
    await setup(page);
    const metadata = await page.evaluate(async () => {
        const { cloneSceneGraph } = await import("/src/lib/canvas/canvas-workspaces.ts");
        return cloneSceneGraph({ nodes: [{ id: "node", metadata: { status: "loading", videoTaskId: "task", videoTaskProvider: "agnes", videoTask: { id: "task", videoId: "video", provider: "agnes", binding: {} } } }], connections: [] }).nodes[0].metadata;
    });
    expect(metadata.status).toBe("error");
    expect(metadata).not.toHaveProperty("videoTask");
    expect(metadata).not.toHaveProperty("videoTaskId");
});

test("video submission is blocked when its initial record cannot be persisted", async ({ page }) => {
    await setup(page);
    let posts = 0;
    await page.route(`${provider}/**`, async (route) => { posts++; await route.abort(); });
    await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === "video_runs") throw new DOMException("Storage unavailable", "QuotaExceededError");
            return original.apply(this, args as any);
        };
    });
    await page.locator("textarea").first().fill("Must not submit");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.getByText("视频任务无法保存，未提交生成请求")).toBeVisible();
    expect(posts).toBe(0);
});

test("remote videos can be localized without generation and remain available after history deletion", async ({ page }) => {
    await setup(page);
    const videoBase64 = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#397e8c";
        context.fillRect(0, 0, 64, 64);
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        const chunks: Blob[] = [];
        return new Promise<string>((resolve) => {
            recorder.ondataavailable = (event) => chunks.push(event.data);
            recorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1]);
                reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
            };
            recorder.start();
            setTimeout(() => recorder.stop(), 250);
        });
    });
    await page.route("https://media.invalid/result.webm", (route) => route.fulfill({ contentType: "video/webm", body: Buffer.from(videoBase64, "base64") }));
    await page.evaluate(async () => {
        const { default: lf } = await import("/node_modules/.vite/deps/localforage.js");
        await lf.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" }).setItem("remote", {
            id: "remote", title: "Remote result", prompt: "Frozen original prompt", createdAt: Date.now(), status: "success", config: {}, references: [],
            video: { id: "result", url: "https://media.invalid/result.webm", storageKey: "", width: 0, height: 0, bytes: 0, mimeType: "video/webm", durationMs: 0 },
        });
    });
    await page.reload();
    await page.getByRole("button").filter({ hasText: "Remote result" }).click();
    await expect(page.getByText("远程结果，尚未保存到本地")).toBeVisible();
    await expect(page.getByText("尺寸未知", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存到本地", exact: true }).click();
    await expect.poll(async () => (await logs(page, true))[0].video.storageKey).not.toBe("");
    expect((await logs(page, true))[0].video).toMatchObject({ width: 64, height: 64 });
    await expect(page.getByText("64x64", { exact: true })).toBeVisible();
    const storageKey = (await logs(page, true))[0].video.storageKey;
    await page.locator("textarea").first().fill("Changed draft");
    await page.getByRole("button", { name: "加入我的资产", exact: true }).click();
    await page.reload();
    await page.getByRole("button").filter({ hasText: "Remote result" }).click();
    await expect(page.getByRole("button", { name: "保存到本地", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "全选", exact: true }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /删\s*除/ }).click();
    await expect.poll(async () => (await logs(page, true)).length).toBe(0);
    const retained = await page.evaluate(async (key) => {
        const { getMediaBlob } = await import("/src/services/file-storage.ts");
        return (await getMediaBlob(key))?.size;
    }, storageKey);
    expect(retained).toBeGreaterThan(0);
});

test("video workbench and Agnes channel editor fit narrow screens in both themes", async ({ page }) => {
    await setup(page);
    for (const theme of ["light", "dark"]) {
        await page.evaluate(async (theme) => {
            const { useThemeStore } = await import("/src/stores/use-theme-store.ts");
            useThemeStore.getState().setTheme(theme);
        }, theme);
        for (const height of [844, 568]) {
            await page.setViewportSize({ width: 390, height });
            await page.goto("/video");
            await expect(page.getByRole("button", { name: "生成记录", exact: true })).toBeVisible();
            expect(await page.evaluate(() => document.querySelector("main")!.scrollWidth)).toBe(390);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
            await page.getByRole("button", { name: "参数", exact: true }).click();
            await expect(page.getByRole("dialog", { name: "参数" })).toBeVisible();
            expect(await page.getByRole("dialog", { name: "参数" }).evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
            await page.goto("/config");
            await page.getByRole("button", { name: "Agnes Flash", exact: true }).click();
            await expect(page.getByRole("dialog", { name: "编辑渠道" })).toBeVisible();
            expect(await page.getByRole("dialog", { name: "编辑渠道" }).evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
        }
    }
});
