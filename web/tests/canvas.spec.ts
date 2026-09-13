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
            { id: "video", type: "video", title: "V", position: { x: 20, y: 20 }, width: 200, height: 100, metadata: { groupId: "group", status: "loading", videoTaskId: "active-job", generationRunId: "run-keep-out", generationRunKind: "video", storageKey: "video:keep" } },
            { id: "plugin", type: "custom:node", title: "P", position: { x: 220, y: 20 }, width: 200, height: 100, metadata: { customValue: 42 } },
        ];
        return cloneSceneGraph({ nodes, connections: [{ id: "edge", fromNodeId: "video", toNodeId: "plugin" }] } as any);
    });
    expect(result.nodes[1].metadata.groupId).toBe(result.nodes[0].id);
    expect(result.nodes[1].metadata.videoTaskId).toBeUndefined();
    expect(result.nodes[1].metadata.generationRunId).toBeUndefined();
    expect(result.nodes[1].metadata.generationRunKind).toBeUndefined();
    expect(result.nodes[1].metadata.storageKey).toBe("video:keep");
    expect(result.nodes[1].metadata.status).toBe("error");
    expect(result.nodes[2].metadata.customValue).toBe(42);
    expect(result.connections[0].fromNodeId).toBe(result.nodes[1].id);
});

test("canvas image generation writes a durable run and rehydrates the result onto the node", async ({ page }) => {
    await enterCanvas(page);
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#258b94"; context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-image", imageModel: "canvas::canvas-image", count: "1",
                channels: [{ id: "canvas", name: "Canvas QA", baseUrl: "https://canvas-provider.invalid", apiKey: "canvas-test-key", apiFormat: "openai", models: [{ name: "canvas-image", capability: "image" }] }],
            },
        });
    });
    await page.route("https://canvas-provider.invalid/**", (route) => route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: png }] } }));
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    const prompt = page.locator('[contenteditable="true"]').last();
    await prompt.fill("Canvas durable image");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(async () => (await snapshot(page))[0].nodes.some((node: any) => node.metadata?.generationRunId)).toBe(true);
    await expect.poll(async () => (await snapshot(page))[0].nodes.some((node: any) => node.metadata?.content)).toBe(true);
    const state = await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs;
    });
    expect(state).toHaveLength(1);
    expect(state[0].request.canvas).toMatchObject({ targetNodeId: (await snapshot(page))[0].nodes[0].id });
    expect(JSON.stringify(state)).not.toContain("canvas-test-key");
    await page.waitForTimeout(700);
    await page.reload();
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.content) || false).toBe(true);
});

test("canvas video generation stores the remote task and rehydrates the durable result", async ({ page }) => {
    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-video", videoModel: "canvas::canvas-video", size: "16:9", vquality: "720", videoSeconds: "5",
                channels: [{ id: "canvas", name: "Canvas Video QA", baseUrl: "https://canvas-video-provider.invalid", apiKey: "canvas-video-test-key", apiFormat: "openai", models: [{ name: "canvas-video", capability: "video" }] }],
            },
        });
    });
    let posts = 0;
    await page.route("https://canvas-video-provider.invalid/**", async (route) => {
        if (route.request().method() === "POST") {
            posts++;
            await route.fulfill({ contentType: "application/json", json: { id: "canvas-video-remote" } });
            return;
        }
        await route.fulfill({ contentType: "application/json", json: { status: "completed", url: "https://canvas-video-media.invalid/result.webm" } });
    });
    await page.route("https://canvas-video-media.invalid/result.webm", (route) => route.fulfill({ contentType: "video/webm", body: Buffer.from("canvas-video") }));
    await page.getByRole("button", { name: "视频", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.locator('[contenteditable="true"]').last().fill("Canvas durable video");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.generationRunId) || false).toBe(true);
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.content) || false).toBe(true);
    expect(posts).toBe(1);
    const result = await page.evaluate(async () => {
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        return useVideoRunStore.getState().runs[0];
    });
    expect(result.request.canvas).toMatchObject({ targetNodeId: (await snapshot(page))[0].nodes[0].id });
    expect(result.task?.id).toBe("canvas-video-remote");
    expect(result.video?.storageKey).toMatch(/^video:/);
    expect(JSON.stringify(result)).not.toContain("canvas-video-test-key");
    await page.waitForTimeout(700);
    await page.reload();
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.content) || false).toBe(true);
    expect(posts).toBe(1);
});

test("canvas audio generation stores a durable run and rehydrates the result", async ({ page }) => {
    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-audio", audioModel: "canvas::canvas-audio", audioFormat: "mp3",
                channels: [{ id: "canvas", name: "Canvas Audio QA", baseUrl: "https://canvas-audio-provider.invalid", apiKey: "canvas-audio-test-key", apiFormat: "openai", models: [{ name: "canvas-audio", capability: "audio" }] }],
            },
        });
    });
    await page.route("https://canvas-audio-provider.invalid/**", (route) => route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("canvas-audio") }));
    await page.getByRole("button", { name: "配置", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.locator('[contenteditable="true"]').last().fill("Canvas durable audio");
    await page.getByRole("button", { name: "关闭节点编辑器", exact: true }).click();
    await page.locator(".canvas-config-mode").getByText("音频", { exact: true }).click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.generationRunId) || false).toBe(true);
    await expect.poll(async () => (await snapshot(page))[0]?.nodes?.some((node: any) => node.metadata?.content) || false).toBe(true);
    const result = await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs[0];
    });
    const audioTarget = (await snapshot(page))[0].nodes.find((node: any) => node.metadata?.generationRunId === result.id);
    expect(audioTarget?.id).toBe(result.request.canvas?.targetNodeId);
    expect(result.audio?.storageKey).toMatch(/^audio:/);
    expect(JSON.stringify(result)).not.toContain("canvas-audio-test-key");
    await page.waitForTimeout(700);
    await page.goto(`/tasks?kind=audio&run=${result.id}`);
    await expect(page.getByTestId("audio-tasks")).toBeVisible();
    await expect(page.getByTestId("audio-task-row")).toHaveCount(1);
    await expect(page.getByTestId("audio-task-prompt")).toHaveText("Canvas durable audio");
    await expect(page.getByTestId("audio-task-result")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("audio-task-row")).toHaveCount(1);
    await expect(page.getByTestId("audio-task-result")).toBeVisible();
});

test("audio task center retries a confirmed failure as a child run", async ({ page }) => {
    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-audio-retry", audioModel: "canvas::canvas-audio-retry", audioFormat: "mp3",
                channels: [{ id: "canvas", name: "Canvas Audio Retry QA", baseUrl: "https://canvas-audio-retry-provider.invalid", apiKey: "canvas-audio-retry-key", apiFormat: "openai", models: [{ name: "canvas-audio-retry", capability: "audio" }] }],
            },
        });
    });
    let posts = 0;
    await page.route("https://canvas-audio-retry-provider.invalid/**", (route) => {
        posts += 1;
        if (posts === 1) {
            return route.fulfill({ status: 500, contentType: "application/json", json: { error: { message: "synthetic audio failure" } } });
        }
        return route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("canvas-audio-retry") });
    });
    await page.getByRole("button", { name: "配置", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.locator('[contenteditable="true"]').last().fill("Canvas audio retry");
    await page.getByRole("button", { name: "关闭节点编辑器", exact: true }).click();
    await page.locator(".canvas-config-mode").getByText("音频", { exact: true }).click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs[0]?.status;
    }))).toBe("failed");
    const failedId = await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs[0]?.id;
    });
    await page.goto(`/tasks?kind=audio&run=${failedId}`);
    await expect(page.getByTestId("audio-task-row")).toHaveCount(1);
    await page.getByRole("button", { name: "使用原参数重试" }).click();
    await page.getByRole("button", { name: "确认重试" }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs;
    })).length).toBe(2);
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs.find((run) => run.retryOf)?.status;
    }))).toBe("succeeded");
    const runs = await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs;
    });
    expect(posts).toBe(2);
    expect(runs.find((run) => run.id === failedId)?.status).toBe("failed");
    expect(runs.find((run) => run.retryOf === failedId)?.audio?.storageKey).toMatch(/^audio:/);
    await expect(page.getByTestId("audio-task-result")).toBeVisible();
});

test("canvas text generation stores a durable streamed run and rehydrates the result", async ({ page }) => {
    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-text", textModel: "canvas::canvas-text",
                channels: [{ id: "canvas", name: "Canvas Text QA", baseUrl: "https://canvas-text-provider.invalid", apiKey: "canvas-text-test-key", apiFormat: "openai", models: [{ name: "canvas-text", capability: "text" }] }],
            },
        });
    });
    let posts = 0;
    await page.route("https://canvas-text-provider.invalid/**", async (route) => {
        posts += 1;
        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: [
                'data: {"type":"response.output_text.delta","delta":"Durable "}',
                "",
                'data: {"type":"response.output_text.delta","delta":"canvas text"}',
                "",
                'data: {"type":"response.output_text.done","text":"Durable canvas text"}',
                "",
                "data: [DONE]",
                "",
            ].join("\n"),
        });
    });
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.locator(".node-element").click();
    await page.locator('[contenteditable="true"]').last().fill("Write durable text");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0]?.status;
    }))).toBe("succeeded");
    const result = await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0];
    });
    expect(posts).toBe(1);
    expect(result.content).toBe("Durable canvas text");
    expect(JSON.stringify(result)).not.toContain("canvas-text-test-key");
    expect((await snapshot(page))[0].nodes.some((node: any) => node.metadata?.content === "Durable canvas text")).toBe(true);
    await page.goto(`/tasks?kind=text&run=${result.id}`);
    await expect(page.getByTestId("text-tasks")).toBeVisible();
    await expect(page.getByTestId("text-task-row")).toHaveCount(1);
    await expect(page.getByTestId("text-task-prompt")).toHaveText("Write durable text");
    await expect(page.getByTestId("text-task-result")).toContainText("Durable canvas text");
    await page.reload();
    await expect(page.getByTestId("text-task-result")).toContainText("Durable canvas text");
    expect(posts).toBe(1);
});

test("connected storage-only image reference reaches the real text request body", async ({ page }) => {
    await enterCanvas(page);
    let requestBody: any = null;
    await page.route("https://reference-text-provider.invalid/**", async (route) => {
        requestBody = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: ['data: {"type":"response.output_text.delta","delta":"Reference received"}', "", "data: [DONE]", ""].join("\n"),
        });
    });

    const result = await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        const { setImageBlob } = await import("/src/services/image-storage.ts");
        const { buildNodeGenerationContext, hydrateNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const { startTextRun } = await import("/src/services/text-runner.ts");
        const currentConfig = useConfigStore.getState().config;
        const config = {
            ...currentConfig,
            proxyEnabled: false,
            model: "reference::reference-text",
            textModel: "reference::reference-text",
            channels: [{
                id: "reference",
                name: "Reference QA",
                baseUrl: "https://reference-text-provider.invalid/v1",
                apiKey: "reference-test-key",
                apiFormat: "openai" as const,
                models: [{ name: "reference-text", capability: "text" as const }],
            }],
        };
        useConfigStore.setState({ config });
        const project = useCanvasStore.getState().projects[0];
        const referenceId = "storage-only-reference";
        const targetId = "reference-target";
        await setImageBlob("image:qa-reference", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
        const nodes = [
            { id: referenceId, type: "image", title: "持久化参考图", position: { x: 0, y: 0 }, width: 240, height: 240, metadata: { content: "", storageKey: "image:qa-reference", mimeType: "image/png" } },
            { id: targetId, type: "text", title: "执行目标", position: { x: 320, y: 0 }, width: 240, height: 180, metadata: { content: "", prompt: "读取这张参考图并描述它" } },
        ];
        const connections = [{ id: "reference-edge", fromNodeId: referenceId, toNodeId: targetId }];
        useCanvasStore.getState().updateProject(project.id, { nodes, connections });
        const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(targetId, nodes as any, connections, "读取这张参考图并描述它"));
        const run = await startTextRun({ prompt: context.prompt, config, references: context.referenceImages, canvas: { projectId: project.id, sceneId: project.id, targetNodeId: targetId, originNodeId: targetId } });
        return { imageCount: context.imageCount, dataUrl: context.referenceImages[0]?.dataUrl, status: run.status };
    });

    expect(result.imageCount).toBe(1);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.status).toBe("succeeded");
    await expect.poll(() => requestBody).toBeTruthy();
    const content = requestBody.input[0].content;
    expect(content).toEqual(expect.arrayContaining([
        { type: "input_text", text: "读取这张参考图并描述它" },
        expect.objectContaining({ type: "input_image", image_url: expect.stringMatching(/^data:image\/png;base64,/) }),
    ]));
});

test("disconnecting a reference removes it from the compiled execution context", async ({ page }) => {
    await enterCanvas(page);
    const result = await page.evaluate(async () => {
        const { buildNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const nodes = [
            { id: "reference", type: "image", title: "参考", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { storageKey: "image:missing-but-not-read", content: "" } },
            { id: "target", type: "text", title: "目标", position: { x: 240, y: 0 }, width: 200, height: 160, metadata: { prompt: "执行" } },
        ];
        const connected = buildNodeGenerationContext("target", nodes as any, [{ id: "edge", fromNodeId: "reference", toNodeId: "target" }], "执行");
        const disconnected = buildNodeGenerationContext("target", nodes as any, [], "执行");
        return { connected: connected.imageCount, disconnected: disconnected.imageCount };
    });
    expect(result.connected).toBe(1);
    expect(result.disconnected).toBe(0);
});

test("Config aggregates direct, grouped and repeated references for the execution target", async ({ page }) => {
    await enterCanvas(page);
    const result = await page.evaluate(async () => {
        const { buildNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const nodes = [
            { id: "image-a", type: "image", title: "图 A", position: { x: 0, y: 0 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,YQ==" } },
            { id: "image-b", type: "image", title: "图 B", position: { x: 0, y: 220 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,Yg==" } },
            { id: "group", type: "group", title: "参考组", position: { x: 220, y: 0 }, width: 320, height: 420, metadata: {} },
            { id: "config", type: "config", title: "配置", position: { x: 600, y: 0 }, width: 240, height: 240, metadata: {} },
            { id: "target", type: "image", title: "执行目标", position: { x: 900, y: 0 }, width: 240, height: 240, metadata: {} },
        ];
        nodes[1].metadata.groupId = "group";
        const connections = [
            { id: "a-config", fromNodeId: "image-a", toNodeId: "config" },
            { id: "b-config", fromNodeId: "image-b", toNodeId: "config" },
            { id: "a-target", fromNodeId: "image-a", toNodeId: "target" },
            { id: "group-target", fromNodeId: "group", toNodeId: "target" },
            { id: "config-target", fromNodeId: "config", toNodeId: "target" },
        ];
        const context = buildNodeGenerationContext("target", nodes as any, connections, "主体 @[node:image-a]，补充 @[node:group]");
        return {
            imageCount: context.imageCount,
            prompt: context.prompt,
            ids: context.referenceImages.map((item) => item.id),
        };
    });
    expect(result.imageCount).toBe(2);
    expect(result.ids).toEqual(["image-a", "image-b"]);
    expect(result.prompt).toContain("主体 @[node:image-a]");
});

test("the real canvas direction resources into Config compiles and disconnects the real edge", async ({ page }) => {
    await enterCanvas(page);
    const result = await page.evaluate(async () => {
        const { buildNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const { getCanvasReferenceSources } = await import("/src/lib/canvas/canvas-resource-references.ts");
        const nodes = [
            { id: "text", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 200, height: 160, metadata: { content: "保留人物身份" } },
            { id: "image", type: "image", title: "参考图", position: { x: 0, y: 220 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,YQ==" } },
            { id: "config", type: "config", title: "配置", position: { x: 360, y: 120 }, width: 240, height: 240, metadata: {} },
        ];
        const connections = [
            { id: "text-config", fromNodeId: "text", toNodeId: "config" },
            { id: "image-config", fromNodeId: "image", toNodeId: "config" },
        ];
        const context = buildNodeGenerationContext("config", nodes as any, connections, "生成结果");
        const sources = getCanvasReferenceSources("config", nodes as any, connections);
        return {
            prompt: context.prompt,
            imageCount: context.imageCount,
            sourceTargets: sources.map((source) => source.connectionTargetId),
            sourceIds: sources.map((source) => source.sourceNodeId),
        };
    });
    expect(result.prompt).toContain("保留人物身份");
    expect(result.imageCount).toBe(1);
    expect(result.sourceTargets).toEqual(["config", "config"]);
    expect(result.sourceIds).toEqual(["text", "image"]);
});

test("Config composer selects a group member with @ while preserving ordinary prompt text", async ({ page }) => {
    await enterCanvas(page);
    const result = await page.evaluate(async () => {
        const { buildNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const nodes = [
            { id: "image-a", type: "image", title: "图 A", position: { x: 0, y: 0 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,YQ==" } },
            { id: "image-b", type: "image", title: "图 B", position: { x: 0, y: 220 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,Yg==" } },
            { id: "group", type: "group", title: "参考组", position: { x: 220, y: 0 }, width: 320, height: 420, metadata: {} },
            { id: "config", type: "config", title: "配置", position: { x: 600, y: 0 }, width: 240, height: 240, metadata: { composerContent: "只参考 @[node:image-b]，保留普通提示词" } },
        ];
        nodes[1].metadata.groupId = "group";
        const connections = [
            { id: "group-config", fromNodeId: "group", toNodeId: "config" },
        ];
        const context = buildNodeGenerationContext("config", nodes as any, connections, nodes[3].metadata.composerContent);
        return { imageCount: context.imageCount, ids: context.referenceImages.map((item) => item.id), prompt: context.prompt };
    });
    expect(result.imageCount).toBe(1);
    expect(result.ids).toEqual(["image-b"]);
    expect(result.prompt).toContain("只参考");
    expect(result.prompt).toContain("图片1");
});

test("connected video references reach OpenAI multipart fields", async ({ page }) => {
    await enterCanvas(page);
    let requestBody: Buffer | null = null;
    await page.route("https://canvas-video-openai.invalid/**", async (route) => {
        requestBody = route.request().postDataBuffer();
        await route.fulfill({ status: 200, contentType: "application/json", json: { id: "video-task" } });
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { setMediaBlob } = await import("/src/services/file-storage.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const current = useConfigStore.getState().config;
        const config = {
            ...current,
            proxyEnabled: false,
            model: "video::openai-video",
            videoModel: "video::openai-video",
            videoMode: "reference",
            channels: [{
                id: "video",
                name: "Video multipart QA",
                baseUrl: "https://canvas-video-openai.invalid/v1",
                apiKey: "video-openai-test-key",
                apiFormat: "openai" as const,
                models: [{ name: "openai-video", capability: "video" as const }],
            }],
        };
        useConfigStore.setState({ config });
        await setMediaBlob("video:qa-reference", new Blob(["video"], { type: "video/mp4" }));
        await setMediaBlob("audio:qa-reference", new Blob(["audio"], { type: "audio/mpeg" }));
        await createVideoGenerationTask(
            config,
            "video with references",
            [{ id: "image", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,cG5n" }],
            {
                videos: [{ id: "video", name: "reference.mp4", type: "video/mp4", url: "", storageKey: "video:qa-reference" }],
                audios: [{ id: "audio", name: "reference.mp3", type: "audio/mpeg", url: "", storageKey: "audio:qa-reference" }],
            },
        );
    });
    await expect.poll(() => requestBody).toBeTruthy();
    const body = requestBody!.toString();
    expect(body).toContain('name="image[]"');
    expect(body).toContain('name="video[]"');
    expect(body).toContain('name="audio[]"');
});

test("connected video references reach Gemini JSON fields", async ({ page }) => {
    await enterCanvas(page);
    let requestBody: any = null;
    await page.route("https://canvas-video-gemini.invalid/**", async (route) => {
        requestBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "application/json", json: { name: "operations/video-task" } });
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { setMediaBlob } = await import("/src/services/file-storage.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const current = useConfigStore.getState().config;
        const config = {
            ...current,
            proxyEnabled: false,
            model: "video::gemini-video",
            videoModel: "video::gemini-video",
            videoMode: "reference",
            channels: [{
                id: "video",
                name: "Video Gemini QA",
                baseUrl: "https://canvas-video-gemini.invalid",
                apiKey: "video-gemini-test-key",
                apiFormat: "gemini" as const,
                models: [{ name: "gemini-video", capability: "video" as const }],
            }],
        };
        useConfigStore.setState({ config });
        await setMediaBlob("video:qa-gemini-reference", new Blob(["video"], { type: "video/mp4" }));
        await setMediaBlob("audio:qa-gemini-reference", new Blob(["audio"], { type: "audio/mpeg" }));
        await createVideoGenerationTask(
            config,
            "video with references",
            [{ id: "image", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,cG5n" }],
            {
                videos: [{ id: "video", name: "reference.mp4", type: "video/mp4", url: "", storageKey: "video:qa-gemini-reference" }],
                audios: [{ id: "audio", name: "reference.mp3", type: "audio/mpeg", url: "", storageKey: "audio:qa-gemini-reference" }],
            },
        );
    });
    await expect.poll(() => requestBody).toBeTruthy();
    expect(requestBody.instances[0].referenceImages).toHaveLength(1);
    expect(requestBody.instances[0].video.bytesBase64Encoded).toBeTruthy();
    expect(requestBody.instances[0].audio.bytesBase64Encoded).toBeTruthy();
});

test("canvas video target compiles connected image, video and audio nodes into one Provider request", async ({ page }) => {
    await enterCanvas(page);
    let requestBody: Buffer | null = null;
    await page.route("https://canvas-video-graph.invalid/**", async (route) => {
        requestBody = route.request().postDataBuffer();
        await route.fulfill({ status: 200, contentType: "application/json", json: { id: "video-graph-task" } });
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { setMediaBlob } = await import("/src/services/file-storage.ts");
        const { buildNodeGenerationContext, hydrateNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const { createVideoGenerationTask } = await import("/src/services/api/video.ts");
        const current = useConfigStore.getState().config;
        const config = {
            ...current,
            proxyEnabled: false,
            model: "video::graph-video",
            videoModel: "video::graph-video",
            videoMode: "reference",
            channels: [{
                id: "video",
                name: "Video graph QA",
                baseUrl: "https://canvas-video-graph.invalid/v1",
                apiKey: "video-graph-test-key",
                apiFormat: "openai" as const,
                models: [{ name: "graph-video", capability: "video" as const }],
            }],
        };
        useConfigStore.setState({ config });
        await setMediaBlob("video:graph-reference", new Blob(["video"], { type: "video/mp4" }));
        await setMediaBlob("audio:graph-reference", new Blob(["audio"], { type: "audio/mpeg" }));
        const nodes = [
            { id: "image", type: "image", title: "参考图", position: { x: 0, y: 0 }, width: 160, height: 160, metadata: { content: "data:image/png;base64,cG5n" } },
            { id: "video", type: "video", title: "参考视频", position: { x: 0, y: 220 }, width: 160, height: 120, metadata: { storageKey: "video:graph-reference", content: "" } },
            { id: "audio", type: "audio", title: "参考音频", position: { x: 0, y: 400 }, width: 160, height: 100, metadata: { storageKey: "audio:graph-reference", content: "" } },
            { id: "target", type: "video", title: "执行视频", position: { x: 360, y: 120 }, width: 240, height: 180, metadata: {} },
        ];
        const connections = [
            { id: "image-target", fromNodeId: "image", toNodeId: "target" },
            { id: "video-target", fromNodeId: "video", toNodeId: "target" },
            { id: "audio-target", fromNodeId: "audio", toNodeId: "target" },
        ];
        const context = await hydrateNodeGenerationContext(buildNodeGenerationContext("target", nodes as any, connections, "按参考素材生成视频"));
        await createVideoGenerationTask(config, context.prompt, context.referenceImages, { videos: context.referenceVideos, audios: context.referenceAudios });
        return { imageCount: context.imageCount, videoCount: context.videoCount, audioCount: context.audioCount };
    });
    await expect.poll(() => requestBody).toBeTruthy();
    expect(requestBody!.toString()).toContain('name="image[]"');
    expect(requestBody!.toString()).toContain('name="video[]"');
    expect(requestBody!.toString()).toContain('name="audio[]"');
});

test("connected storage-only image reference reaches the real image edit multipart body", async ({ page }) => {
    await enterCanvas(page);
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    let requestBody: Buffer | null = null;
    await page.route("https://reference-image-provider.invalid/**", async (route) => {
        requestBody = route.request().postDataBuffer();
        await route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: pngBase64 }] } });
    });

    const result = await page.evaluate(async (png) => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        const { setImageBlob } = await import("/src/services/image-storage.ts");
        const { buildNodeGenerationContext, hydrateNodeGenerationContext } = await import("/src/components/canvas/canvas-node-generation.ts");
        const { requestEdit } = await import("/src/services/api/image.ts");
        const currentConfig = useConfigStore.getState().config;
        const config = {
            ...currentConfig,
            proxyEnabled: false,
            model: "reference::reference-image",
            imageModel: "reference::reference-image",
            channels: [{
                id: "reference",
                name: "Reference Image QA",
                baseUrl: "https://reference-image-provider.invalid/v1",
                apiKey: "reference-image-test-key",
                apiFormat: "openai" as const,
                models: [{ name: "reference-image", capability: "image" as const }],
            }],
        };
        useConfigStore.setState({ config });
        const project = useCanvasStore.getState().projects[0];
        const nodes = [
            { id: "reference-image", type: "image", title: "参考图", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { content: "", storageKey: "image:qa-edit-reference", mimeType: "image/png" } },
            { id: "image-target", type: "text", title: "图片目标", position: { x: 260, y: 0 }, width: 200, height: 160, metadata: { prompt: "基于参考图生成新图" } },
        ];
        const connections = [{ id: "image-edge", fromNodeId: "reference-image", toNodeId: "image-target" }];
        await setImageBlob("image:qa-edit-reference", new Blob([Uint8Array.from(atob(png), (value) => value.charCodeAt(0))], { type: "image/png" }));
        useCanvasStore.getState().updateProject(project.id, { nodes, connections });
        const context = await hydrateNodeGenerationContext(buildNodeGenerationContext("image-target", nodes as any, connections, "基于参考图生成新图"));
        const images = await requestEdit({ ...config, count: "1" }, context.prompt, context.referenceImages);
        return { imageCount: context.imageCount, resultCount: images.length };
    }, pngBase64);

    expect(result.imageCount).toBe(1);
    expect(result.resultCount).toBe(1);
    await expect.poll(() => requestBody).toBeTruthy();
    expect(requestBody!.includes(Buffer.from(pngBase64, "base64"))).toBe(true);
    expect(requestBody!.toString()).toContain('name="image"');
});

test("text task center retries a confirmed failure as a child run", async ({ page }) => {
    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config, proxyEnabled: false, model: "canvas::canvas-text-retry", textModel: "canvas::canvas-text-retry",
                channels: [{ id: "canvas", name: "Canvas Text Retry QA", baseUrl: "https://canvas-text-retry-provider.invalid", apiKey: "canvas-text-retry-key", apiFormat: "openai", models: [{ name: "canvas-text-retry", capability: "text" }] }],
            },
        });
    });
    let posts = 0;
    await page.route("https://canvas-text-retry-provider.invalid/**", async (route) => {
        posts += 1;
        if (posts === 1) {
            await route.fulfill({ status: 500, contentType: "application/json", json: { error: { message: "synthetic text failure" } } });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: ['data: {"type":"response.output_text.delta","delta":"Recovered text"}', "", "data: [DONE]", ""].join("\n"),
        });
    });
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    await page.locator(".node-element").click();
    await page.locator('[contenteditable="true"]').last().fill("Retry durable text");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0]?.status;
    }))).toBe("failed");
    const failedId = await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0]?.id;
    });
    await page.goto(`/tasks?kind=text&run=${failedId}`);
    await page.getByRole("button", { name: "使用原参数重试" }).click();
    await page.getByRole("button", { name: "确认重试" }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs;
    })).length).toBe(2);
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs.find((run) => run.retryOf)?.status;
    }))).toBe("succeeded");
    const runs = await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs;
    });
    expect(posts).toBe(2);
    expect(runs.find((run) => run.id === failedId)?.status).toBe("failed");
    expect(runs.find((run) => run.retryOf === failedId)?.content).toBe("Recovered text");
    await expect(page.getByTestId("text-task-result")).toContainText("Recovered text");
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
