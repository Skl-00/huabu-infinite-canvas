import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";

const provider = "https://video-provider.invalid";
const secret = "fixture-video-credential";

async function setup(page: Page) {
    await page.goto("/video");
    await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeVisible();
    const close = page.getByRole("button", { name: "关闭 Agent", exact: true });
    if (await close.isVisible()) await close.click();
    await page.evaluate(async ({ provider, secret }) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: {
            ...config, proxyEnabled: false, model: "qa::qa-video", videoModel: "qa::qa-video", size: "16:9", vquality: "720", videoSeconds: "5",
            channels: [{ id: "qa", name: "Video QA", baseUrl: provider, apiKey: secret, apiFormat: "openai", models: [{ name: "qa-video", capability: "video" }] }],
        } });
    }, { provider, secret });
    await page.reload();
    await expect(page.getByRole("combobox", { name: "模型" })).toContainText("qa-video");
}

async function runs(page: Page, stored = false) {
    return page.evaluate(async (stored) => {
        const { useVideoRunStore, videoRunStorage } = await import("/src/stores/use-video-run-store.ts");
        if (!stored) return useVideoRunStore.getState().runs;
        const records: any[] = [];
        await videoRunStorage.iterate((value: any) => { records.push(value); });
        return records.sort((a, b) => b.createdAt - a.createdAt);
    }, stored);
}

async function generate(page: Page, prompt = "Frozen video prompt") {
    await page.locator("textarea").first().fill(prompt);
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
}

async function mediaFixture(page: Page, context: BrowserContext) {
    const base64 = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#1f8994"; ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = "#eac452"; ctx.fillRect(40, 40, 120, 100);
        ctx.fillStyle = "#df6b79"; ctx.fillRect(180, 65, 100, 75);
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
            let frame = 0;
            const timer = setInterval(() => { ctx.fillStyle = frame++ % 2 ? "#1f8994" : "#218b96"; ctx.fillRect(0, 0, 10, 10); }, 50);
            setTimeout(() => { clearInterval(timer); recorder.stop(); }, 450);
        });
    });
    await context.route("https://video-media.invalid/**", (route) => route.fulfill({ contentType: "video/webm", body: Buffer.from(base64, "base64") }));
}

test("video execution survives navigation and two tabs have a single query owner", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    let posts = 0, gets = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "remote" } }); }
        else { gets++; await held; await route.fulfill({ json: { status: "completed", url: "https://video-media.invalid/result.webm" } }); }
    });
    await generate(page);
    await expect.poll(() => gets).toBe(1);
    const initial = (await runs(page, true))[0];
    expect(initial.task.id).toBe("remote");
    await page.getByRole("link", { name: "视频任务", exact: true }).click();
    await expect(page.getByTestId("video-task-prompt")).toHaveText("Frozen video prompt");
    const other = await context.newPage();
    await other.goto(`/tasks?kind=video&run=${initial.id}`);
    await expect.poll(async () => (await runs(other))[0]?.status).toBe("running");
    await other.getByRole("button", { name: "刷新视频任务" }).click();
    expect(gets).toBe(1);
    release();
    await expect.poll(async () => (await runs(other))[0]?.status).toBe("succeeded");
    expect(posts).toBe(1);
    expect(gets).toBe(1);
    expect((await runs(other, true))[0].video.storageKey).toMatch(/^video:/);
    expect(JSON.stringify(await runs(other, true))).not.toContain(secret);
    await expect(other.locator("video")).toBeVisible();
    await other.close();
});

test("reload resumes known remote identity without a second POST; unknown identity never auto submits", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    let posts = 0, gets = 0;
    let completed = false;
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "resume-remote" } }); }
        else { gets++; await route.fulfill({ json: completed ? { status: "completed", url: "https://video-media.invalid/result.webm" } : { status: "in_progress" } }); }
    });
    await generate(page);
    await expect.poll(() => gets).toBe(1);
    completed = true;
    await page.reload();
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    expect(posts).toBe(1);
    const original = (await runs(page, true))[0];
    await page.evaluate(async (original) => {
        const { videoRunStorage } = await import("/src/stores/use-video-run-store.ts");
        await videoRunStorage.setItem("unknown", { ...original, id: "unknown", task: undefined, video: undefined, status: "running", createdAt: Date.now() });
    }, original);
    await page.reload();
    await expect.poll(async () => (await runs(page)).find((run: any) => run.id === "unknown")?.status).toBe("interrupted");
    const getCount = gets;
    await page.reload();
    await expect.poll(async () => (await runs(page)).length).toBe(2);
    expect(posts).toBe(1); expect(gets).toBe(getCount);
});

test("frozen retry preserves recipe, permits key rotation, rejects changed binding, deduplicates children", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    const requests: any[] = [];
    let failed = true;
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") {
            const data = route.request().postData()!;
            requests.push({ data, auth: route.request().headers().authorization });
            await route.fulfill({ json: { id: `remote-${requests.length}` } });
        } else await route.fulfill({ json: failed ? { status: "failed", error: { message: `Provider refused ${secret}` } } : { status: "completed", url: "https://video-media.invalid/result.webm" } });
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("failed");
    const original = (await runs(page))[0];
    expect(original.error).not.toContain(secret);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, size: "9:16", videoSeconds: "8", channels: config.channels.map((c: any) => ({ ...c, apiKey: "rotated-video-key", baseUrl: "https://changed.invalid" })) } });
    });
    const error = await page.evaluate(async (id) => {
        const { retryVideoRun } = await import("/src/services/video-runner.ts");
        try { await retryVideoRun(id); } catch (e: any) { return e.message; }
    }, original.id);
    expect(error).toContain("原渠道地址");
    expect(requests).toHaveLength(1);
    await page.evaluate(async (provider) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, channels: config.channels.map((c: any) => ({ ...c, baseUrl: provider })) } });
    }, provider);
    failed = false;
    const other = await context.newPage();
    await other.goto("/tasks?kind=video");
    const retry = (tab: Page) => tab.evaluate(async (id) => (await (await import("/src/services/video-runner.ts")).retryVideoRun(id)).id, original.id);
    const children = await Promise.all([retry(page), retry(other)]);
    expect(children[0]).toBe(children[1]);
    expect(requests).toHaveLength(2);
    expect(requests[1].auth).toBe("Bearer rotated-video-key");
    expect(requests[1].data).toContain("Frozen video prompt");
    expect(requests[1].data).toContain("1280x720");
    expect((await runs(page, true))[0].request).toEqual(original.request);
    expect((await runs(page, true))[1].status).toBe("failed");
    await other.close();
});

test("pre-submit transition failure sends zero POST and remote-id write failure can be resaved", async ({ page, context }) => {
    await setup(page);
    let posts = 0;
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "preserved-remote" } }); }
        else await route.fulfill({ json: { status: "failed", error: { message: "remote failed" } } });
    });
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        (window as any).restoreWrites = () => { IDBObjectStore.prototype.put = put; };
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === "video_runs" && args[0]?.status === "running") throw new DOMException("full", "QuotaExceededError");
            return put.apply(this, args as any);
        };
    });
    await generate(page);
    await expect.poll(async () => Boolean((await runs(page))[0]?.persistenceError)).toBe(true);
    expect(posts).toBe(0);
    await page.evaluate(async () => {
        (window as any).restoreWrites();
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        await (await import("/src/services/video-runner.ts")).resaveVideoRun(useVideoRunStore.getState().runs[0].id);
        const put = IDBObjectStore.prototype.put;
        (window as any).restoreWrites = () => { IDBObjectStore.prototype.put = put; };
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === "video_runs" && args[0]?.task) throw new DOMException("full", "QuotaExceededError");
            return put.apply(this, args as any);
        };
    });
    await generate(page, "Preserve remote ID");
    await expect.poll(async () => (await runs(page))[0]?.task?.id).toBe("preserved-remote");
    await expect.poll(async () => Boolean((await runs(page))[0]?.persistenceError)).toBe(true);
    expect(posts).toBe(1);
    const id = (await runs(page))[0].id;
    await page.evaluate(async (id) => {
        (window as any).restoreWrites();
        const runner = await import("/src/services/video-runner.ts");
        await runner.resaveVideoRun(id);
        await runner.resumeVideoRun(id);
    }, id);
    expect((await runs(page, true))[0]).toMatchObject({ status: "failed", task: { id: "preserved-remote" } });
    expect(posts).toBe(1);
});

test("result staging and final write failures preserve media and resave without new generation", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    let posts = 0, gets = 0;
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "result-remote" } }); }
        else { gets++; await route.fulfill({ json: { status: "completed", url: "https://video-media.invalid/result.webm" } }); }
    });
    for (const mode of ["stage", "media", "final"]) {
        await page.evaluate((mode) => {
            const put = IDBObjectStore.prototype.put;
            (window as any).restoreWrites = () => { IDBObjectStore.prototype.put = put; };
            IDBObjectStore.prototype.put = function (...args) {
                if ((mode === "media" && this.name === "media_files") || (this.name === "video_runs" && (mode === "stage" ? args[0]?.pendingResult : mode === "final" && args[0]?.video))) throw new DOMException("full", "QuotaExceededError");
                return put.apply(this, args as any);
            };
        }, mode);
        await generate(page, `Result ${mode}`);
        await expect.poll(async () => Boolean((await runs(page))[0]?.persistenceError || (mode === "media" && (await runs(page))[0]?.status === "interrupted"))).toBe(true);
        const failed = (await runs(page))[0];
        expect(Boolean(failed.pendingResult || failed.video)).toBe(true);
        if (mode === "media") await page.reload();
        await page.evaluate(async (id) => {
            (window as any).restoreWrites?.();
            await (await import("/src/services/video-runner.ts")).resaveVideoRun(id);
        }, failed.id);
        await expect.poll(async () => (await runs(page, true))[0]?.status).toBe("succeeded");
    }
    expect(posts).toBe(3); expect(gets).toBe(3);
    await page.reload();
    await expect.poll(async () => (await runs(page)).every((run: any) => !!run.video?.url)).toBe(true);
});

test("video task references and result survive asset cleanup; missing reference blocks retry; Agent reads durable truth", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    let posts = 0;
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "asset-remote" } }); }
        else await route.fulfill({ json: { status: "completed", url: "https://video-media.invalid/result.webm" } });
    });
    const id = await page.evaluate(async () => {
        const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
        const { uploadImage } = await import("/src/services/image-storage.ts");
        const image = await uploadImage(canvas.toDataURL());
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const run = await (await import("/src/services/video-runner.ts")).startVideoRun({
            prompt: "Reference task", config: useConfigStore.getState().config, agentTaskId: "agent-video",
            references: [{ id: "ref", name: "reference.png", type: "image/png", storageKey: image.storageKey, dataUrl: image.url }],
        });
        return run.id;
    });
    await page.goto(`/tasks?kind=video&run=${id}`);
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); video.pause(); });
    await page.getByRole("button", { name: "存入素材", exact: true }).click();
    await expect(page.getByRole("button", { name: "已存入素材" })).toBeVisible();
    const retained = await page.evaluate(async (id) => {
        const { useAssetStore } = await import("/src/stores/use-asset-store.ts");
        useAssetStore.getState().removeAsset(useAssetStore.getState().assets.find((a: any) => a.metadata?.generationRunId === id)!.id);
        const images = await import("/src/services/image-storage.ts");
        const media = await import("/src/services/file-storage.ts");
        await images.cleanupUnusedImages({}); await media.cleanupUnusedMedia({});
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        const run = useVideoRunStore.getState().runs.find((run: any) => run.id === id)!;
        const status = await (await import("/src/lib/agent/agent-site-tools.ts")).runSiteTool("generation_get_status", { scope: "video", taskId: "agent-video" }, () => {});
        const bytes = [(await images.getImageBlob(run.request.references[0].storageKey!))?.size, (await media.getMediaBlob(run.video!.storageKey))?.size];
        return { bytes, status };
    }, id);
    expect(retained.bytes.every((bytes) => bytes! > 0)).toBe(true);
    expect((retained.status as any).tasks).toHaveLength(1);
    expect((retained.status as any).tasks[0].status).toBe("succeeded");
    const error = await page.evaluate(async (id) => {
        const { videoRunStorage } = await import("/src/stores/use-video-run-store.ts");
        const original = await videoRunStorage.getItem<any>(id);
        await videoRunStorage.setItem("missing-ref", { ...original, id: "missing-ref", status: "failed", video: undefined, request: { ...original.request, references: [{ ...original.request.references[0], storageKey: "image:missing", dataUrl: "" }] } });
        try { await (await import("/src/services/video-runner.ts")).retryVideoRun("missing-ref"); } catch (e: any) { return e.message; }
    }, id);
    expect(error).toContain("已丢失");
    expect(posts).toBe(1);
});

test("video tasks remain readable in desktop and mobile light and dark themes", async ({ page, context }) => {
    await setup(page);
    await mediaFixture(page, context);
    await context.route(`${provider}/**`, (route) => route.fulfill({ json: route.request().method() === "POST" ? { id: "visual-remote" } : { status: "completed", url: "https://video-media.invalid/result.webm" } }));
    await generate(page, "A calm product scene with soft daylight and a clean composition");
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("succeeded");
    const id = (await runs(page))[0].id;
    await page.goto(`/tasks?kind=video&run=${id}`);
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); video.pause(); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) {
        await page.evaluate(async (theme) => (await import("/src/stores/use-theme-store.ts")).useThemeStore.getState().setTheme(theme), theme);
        for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 390, height: 568 }]) {
            await page.setViewportSize(viewport);
            await expect(page.getByTestId("video-task-prompt")).toBeVisible();
            await expect(page.locator("video")).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: path.resolve(`../docs/planning/video-tasks-${theme}-${viewport.width}x${viewport.height}.png`) });
        }
    }
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "返回视频任务列表" }).click();
    await expect(page.getByTestId("video-task-row")).toBeVisible();
    await page.getByTestId("video-task-row").click();
    await expect(page.getByTestId("video-task-prompt")).toBeVisible();
});

test("resume uses original binding with current key and never queries a changed endpoint", async ({ page, context }) => {
    await setup(page);
    let posts = 0;
    const auths: string[] = [];
    await context.route(`${provider}/**`, async (route) => {
        if (route.request().method() === "POST") { posts++; await route.fulfill({ json: { id: "bound-remote" } }); }
        else { auths.push(route.request().headers().authorization); await route.fulfill({ status: 429, json: { error: { message: "try later" } } }); }
    });
    await generate(page);
    await expect.poll(async () => (await runs(page))[0]?.status).toBe("interrupted");
    const id = (await runs(page))[0].id;
    await page.evaluate(async (id) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, channels: config.channels.map((c: any) => ({ ...c, apiKey: "rotated-query-key" })) } });
        await (await import("/src/services/video-runner.ts")).resumeVideoRun(id);
    }, id);
    expect(auths).toEqual([`Bearer ${secret}`, "Bearer rotated-query-key"]);
    await page.evaluate(async (id) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({ config: { ...config, channels: config.channels.map((c: any) => ({ ...c, baseUrl: "https://unrelated.invalid" })) } });
        await (await import("/src/services/video-runner.ts")).resumeVideoRun(id);
    }, id);
    expect(auths).toHaveLength(2);
    expect(posts).toBe(1);
    expect((await runs(page, true))[0].error).toContain("原渠道地址");
});
