import { expect, test, type Page } from "@playwright/test";

async function enterCanvas(page: Page) {
    await page.goto("/canvas?mode=new");
    await expect(page.getByRole("button", { name: "文本", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/canvas\/[^?]+/);
}

async function readRuns(page: Page) {
    return page.evaluate(async () => {
        const loadedStoreUrl = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((name) => /\/src\/stores\/use-text-run-store\.ts(?:\?|$)/.test(name));
        const storeUrl = loadedStoreUrl ? new URL(loadedStoreUrl).href : "/src/stores/use-text-run-store.ts";
        const { useTextRunStore } = await import(/* @vite-ignore */ storeUrl);
        return useTextRunStore.getState().runs;
    });
}

test("plugin AI generation uses one durable text task and survives the loading transition", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      let disposed = false;",
        "      void ctx.ai.generateText('Plugin durable prompt').then(({ text }) => {",
        "        if (!disposed) ctx.updateMetadata({ content: text, status: 'success' });",
        "      });",
        "      return () => { disposed = true; };",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-content' }, ctx.node.metadata?.content || 'plugin running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-plugin',",
        "    name: '耐久任务插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-plugin:text', title: '插件文本', icon: jsx('span', null, 'P'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    await page.route("https://qa-durable-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-provider.invalid/**", async (route) => {
        await route.fulfill({
            contentType: "application/json",
            json: { output_text: "Plugin durable result" },
        });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/responses`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, input: messages },",
            "});",
            "return response.output_text;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin::qa-text",
                textModel: "qa-plugin::qa-text",
                channels: [{
                    id: "qa-plugin",
                    name: "插件 QA",
                    baseUrl: "https://qa-plugin-provider.invalid",
                    apiKey: "qa-plugin-test-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-text", capability: "text", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件文本$/ }).click();
    await expect(page.getByTestId("plugin-content")).toBeVisible();
    await expect.poll(async () => (await readRuns(page)).length).toBe(1);
    await expect.poll(async () => (await readRuns(page))[0]?.status).toBe("succeeded");
    await expect(page.getByTestId("plugin-content")).toHaveText("Plugin durable result");

    const run = (await readRuns(page))[0];
    expect(run.request.canvas).toMatchObject({
        projectId: new URL(page.url()).pathname.split("/").pop(),
        targetNodeId: expect.any(String),
        pluginId: "qa-durable-plugin",
        pluginNodeType: "qa-durable-plugin:text",
    });
    expect(JSON.stringify(run)).not.toContain("qa-plugin-test-secret");
    expect(JSON.stringify(run)).not.toContain("const response = await request");

    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.getByTestId("plugin-content")).toHaveText("Plugin durable result");
    expect((await readRuns(page)).length).toBe(1);
});

test("plugin video generation stores one localized run and reuses it after refresh", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      let disposed = false;",
        "      void ctx.ai.generateVideo('Plugin durable video').then(({ url }) => {",
        "        if (!disposed) ctx.updateMetadata({ content: url, status: 'success' });",
        "      });",
        "      return () => { disposed = true; };",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-video-content' }, ctx.node.metadata?.content ? 'plugin video ready' : 'plugin video running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-video-plugin',",
        "    name: '耐久视频插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-video-plugin:video', title: '插件视频', icon: jsx('span', null, 'V'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    let gets = 0;
    await page.route("https://qa-durable-video-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-video-provider.invalid/**", async (route) => {
        if (route.request().method() === "POST") {
            posts += 1;
            await route.fulfill({ contentType: "application/json", json: { id: "plugin-video-remote" } });
            return;
        }
        gets += 1;
        await route.fulfill({ contentType: "application/json", json: { status: "completed", url: "https://qa-plugin-video-media.invalid/result.webm" } });
    });
    await page.route("https://qa-plugin-video-media.invalid/result.webm", (route) => route.fulfill({ contentType: "video/webm", body: Buffer.from("plugin-video") }));

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-video::qa-video",
                videoModel: "qa-plugin-video::qa-video",
                channels: [{
                    id: "qa-plugin-video",
                    name: "插件视频 QA",
                    baseUrl: "https://qa-plugin-video-provider.invalid",
                    apiKey: "qa-plugin-video-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-video", capability: "video" }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-video-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件视频$/ }).click();
    await expect(page.getByTestId("plugin-video-content")).toHaveText("plugin video ready");
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        return useVideoRunStore.getState().runs;
    })).length).toBe(1);
    await expect.poll(() => posts).toBe(1);
    await expect.poll(() => gets).toBe(1);

    const run = await page.evaluate(async () => {
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        return useVideoRunStore.getState().runs[0];
    });
    expect(run.status).toBe("succeeded");
    expect(run.video?.storageKey).toMatch(/^video:/);
    expect(run.task?.id).toBe("plugin-video-remote");
    expect(JSON.stringify(run)).not.toContain("qa-plugin-video-secret");

    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.getByTestId("plugin-video-content")).toHaveText("plugin video ready");
    expect(posts).toBe(1);
    expect(gets).toBe(1);
    expect((await page.evaluate(async () => {
        const { useVideoRunStore } = await import("/src/stores/use-video-run-store.ts");
        return useVideoRunStore.getState().runs;
    })).length).toBe(1);
});

test("plugin image generation stores one localized run and exposes its source in the task center", async ({ page }) => {
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#258b94";
        context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png").split(",")[1];
    });
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      let disposed = false;",
        "      void ctx.ai.generateImage('Plugin durable image').then(({ images }) => {",
        "        if (!disposed) ctx.updateMetadata({ content: images[0], status: 'success' });",
        "      });",
        "      return () => { disposed = true; };",
        "    }, [ctx.node.id]);",
        "    return ctx.node.metadata?.content",
        "      ? jsx('img', { 'data-testid': 'plugin-image-content', src: ctx.node.metadata.content, alt: 'plugin image' })",
        "      : jsx('div', { 'data-testid': 'plugin-image-content' }, 'plugin image running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-image-plugin',",
        "    name: '耐久图片插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-image-plugin:image', title: '插件图片', icon: jsx('span', null, 'I'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    await page.route("https://qa-durable-image-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-image-provider.invalid/**", async (route) => {
        posts++;
        await route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: png }] } });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/images/generations`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, prompt, n: params.count, size: params.size },",
            "});",
            "return `data:image/png;base64,${response.data[0].b64_json}`;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-image::qa-image",
                imageModel: "qa-plugin-image::qa-image",
                channels: [{
                    id: "qa-plugin-image",
                    name: "插件图片 QA",
                    baseUrl: "https://qa-plugin-image-provider.invalid",
                    apiKey: "qa-plugin-image-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-image", capability: "image", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-image-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件图片$/ }).click();
    await expect(page.getByTestId("plugin-image-content")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs;
    })).length).toBe(1);
    await expect.poll(() => posts).toBe(1);

    const run = await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs[0];
    });
    expect(run.status).toBe("succeeded");
    expect(run.slots[0].image?.storageKey).toMatch(/^image:/);
    expect(run.request.canvas).toMatchObject({ pluginId: "qa-durable-image-plugin", pluginNodeType: "qa-durable-image-plugin:image" });
    expect(JSON.stringify(run)).not.toContain("qa-plugin-image-secret");
    await page.goto(`/tasks?run=${run.id}`);
    await expect(page.getByTestId("task-origin-detail")).toContainText("qa-durable-image-plugin");
    await expect(page.getByTestId("task-result")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("task-origin-detail")).toContainText("qa-durable-image-plugin");
    await expect(page.getByTestId("task-result")).toHaveCount(1);
    expect(posts).toBe(1);
});

test("plugin image retry from the task center preserves plugin source context", async ({ page }) => {
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#d75968";
        context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png").split(",")[1];
    });
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      void ctx.ai.generateImage('Plugin retry image').then(({ images }) => {",
        "        ctx.updateMetadata({ content: images[0], status: 'success' });",
        "      });",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-retry-image-content' }, ctx.node.metadata?.content ? 'plugin retry ready' : 'plugin retry running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-retry-image-plugin',",
        "    name: '耐久图片重试插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-retry-image-plugin:image', title: '插件图片重试', icon: jsx('span', null, 'R'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    await page.route("https://qa-durable-retry-image-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-retry-image-provider.invalid/**", async (route) => {
        posts++;
        if (posts === 1) {
            await route.fulfill({ status: 500, contentType: "application/json", json: { error: { message: "synthetic plugin image failure" } } });
            return;
        }
        await route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: png }] } });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/images/generations`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, prompt, n: params.count },",
            "});",
            "return `data:image/png;base64,${response.data[0].b64_json}`;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-retry-image::qa-image",
                imageModel: "qa-plugin-retry-image::qa-image",
                channels: [{
                    id: "qa-plugin-retry-image",
                    name: "插件图片重试 QA",
                    baseUrl: "https://qa-plugin-retry-image-provider.invalid",
                    apiKey: "qa-plugin-retry-image-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-image", capability: "image", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-retry-image-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件图片重试$/ }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs[0]?.status;
    }))).toBe("failed");
    const original = await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs[0];
    });
    await page.goto(`/tasks?run=${original.id}`);
    await expect(page.getByRole("button", { name: "重试未完成项", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重试未完成项", exact: true }).click();
    await page.getByRole("button", { name: "确认重试", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(async (originalId) => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs.find((run) => run.retryOf === originalId)?.status;
    }, original.id))).toBe("succeeded");
    const child = await page.evaluate(async (originalId) => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs.find((run) => run.retryOf === originalId);
    }, original.id);
    expect(child.request.canvas).toMatchObject({
        projectId: original.request.canvas.projectId,
        targetNodeId: original.request.canvas.targetNodeId,
        pluginId: "qa-durable-retry-image-plugin",
        pluginNodeType: "qa-durable-retry-image-plugin:image",
    });
    expect(posts).toBe(2);
    await expect(page.getByTestId("task-origin-detail")).toContainText("qa-durable-retry-image-plugin");
    expect(JSON.stringify(child)).not.toContain("qa-plugin-retry-image-secret");
});

test("plugin image generation preserves partial slot results after a later slot fails", async ({ page }) => {
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#4b78d1";
        context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL("image/png").split(",")[1];
    });
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      void ctx.ai.generateImage('Plugin partial image', { count: 2 }).then(({ images }) => {",
        "        ctx.updateMetadata({ content: images[0], status: 'success' });",
        "      });",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-partial-image-content' }, ctx.node.metadata?.content ? 'plugin partial ready' : 'plugin partial running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-partial-image-plugin',",
        "    name: '耐久部分图片插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-partial-image-plugin:image', title: '插件部分图片', icon: jsx('span', null, 'P'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    await page.route("https://qa-durable-partial-image-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-partial-image-provider.invalid/**", async (route) => {
        posts += 1;
        if (posts === 1) {
            await route.fulfill({ status: 500, contentType: "application/json", json: { error: { message: "synthetic first slot failure" } } });
            return;
        }
        await route.fulfill({ contentType: "application/json", json: { data: [{ b64_json: png }] } });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/images/generations`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, prompt, n: params.count },",
            "});",
            "return `data:image/png;base64,${response.data[0].b64_json}`;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-partial-image::qa-image",
                imageModel: "qa-plugin-partial-image::qa-image",
                channels: [{
                    id: "qa-plugin-partial-image",
                    name: "插件部分图片 QA",
                    baseUrl: "https://qa-plugin-partial-image-provider.invalid",
                    apiKey: "qa-plugin-partial-image-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-image", capability: "image", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-partial-image-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件部分图片$/ }).click();
    await expect(page.getByTestId("plugin-partial-image-content")).toHaveText("plugin partial ready");
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs[0]?.status;
    }))).toBe("partial");
    const run = await page.evaluate(async () => {
        const { useImageRunStore } = await import("/src/stores/use-image-run-store.ts");
        return useImageRunStore.getState().runs[0];
    });
    expect(posts).toBe(2);
    expect(run.slots.map((slot: any) => slot.status).sort()).toEqual(["failed", "success"]);
    expect(run.slots.find((slot: any) => slot.status === "failed")?.error).toContain("模型调用脚本执行失败");
    expect(run.slots.find((slot: any) => slot.status === "success")?.image?.storageKey).toMatch(/^image:/);
    expect(run.request.canvas).toMatchObject({ pluginId: "qa-durable-partial-image-plugin", pluginNodeType: "qa-durable-partial-image-plugin:image" });
    expect(JSON.stringify(run)).not.toContain("qa-plugin-partial-image-secret");
    await page.goto(`/tasks?kind=image&run=${run.id}`);
    await expect(page.getByTestId("task-origin-detail")).toContainText("qa-durable-partial-image-plugin");
    await page.reload();
    await expect(page.getByTestId("task-origin-detail")).toContainText("qa-durable-partial-image-plugin");
    expect(posts).toBe(2);
});

test("plugin text abort preserves partial content without an implicit resubmission", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      const controller = new AbortController();",
        "      void ctx.ai.generateText('Plugin interrupted text', { signal: controller.signal }).catch(() => undefined);",
        "      setTimeout(() => controller.abort(), 120);",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-interrupted-text-content' }, 'plugin interrupted');",
        "  }",
        "  return {",
        "    id: 'qa-durable-interrupted-text-plugin',",
        "    name: '耐久中断文本插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-interrupted-text-plugin:text', title: '插件中断文本', icon: jsx('span', null, 'T'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    await page.route("https://qa-durable-interrupted-text-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-interrupted-text-provider.invalid/**", async (route) => {
        posts += 1;
        await route.fulfill({
            contentType: "application/json",
            json: { output_text: "late text should never commit" },
        });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "onDelta('Partial plugin text');",
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/responses`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, input: messages },",
            "});",
            "await sleep(1000);",
            "return response.output_text;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-interrupted-text::qa-text",
                textModel: "qa-plugin-interrupted-text::qa-text",
                channels: [{
                    id: "qa-plugin-interrupted-text",
                    name: "插件中断文本 QA",
                    baseUrl: "https://qa-plugin-interrupted-text-provider.invalid",
                    apiKey: "qa-plugin-interrupted-text-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-text", capability: "text", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-interrupted-text-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件中断文本$/ }).click();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0]?.status;
    }))).toBe("interrupted");
    const run = await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0];
    });
    expect(posts).toBe(1);
    expect(run.partialContent).toBe("Partial plugin text");
    expect(run.content).toBeUndefined();
    expect(run.request.canvas).toMatchObject({ pluginId: "qa-durable-interrupted-text-plugin", pluginNodeType: "qa-durable-interrupted-text-plugin:text" });
    expect(JSON.stringify(run)).not.toContain("qa-plugin-interrupted-text-secret");
    await page.goto(`/tasks?kind=text&run=${run.id}`);
    await expect(page.getByTestId("text-task-row")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("text-task-result")).toContainText("Partial plugin text");
    expect(posts).toBe(1);
});

test("a completed plugin run cannot write into a replacement node after the target is deleted", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      void ctx.ai.generateText('Plugin deleted target').catch(() => undefined);",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-deleted-target-content' }, 'plugin running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-deleted-target-plugin',",
        "    name: '耐久删除目标插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-deleted-target-plugin:text', title: '插件删除目标', icon: jsx('span', null, 'D'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    await page.route("https://qa-durable-deleted-target-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-deleted-target-provider.invalid/**", async (route) => {
        posts += 1;
        await blocked;
        await route.fulfill({ contentType: "application/json", json: { output_text: "should stay in deleted target" } });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "const response = await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/responses`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  data: { model, input: messages },",
            "});",
            "return response.output_text;",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-deleted-target::qa-text",
                textModel: "qa-plugin-deleted-target::qa-text",
                channels: [{
                    id: "qa-plugin-deleted-target",
                    name: "插件删除目标 QA",
                    baseUrl: "https://qa-plugin-deleted-target-provider.invalid",
                    apiKey: "qa-plugin-deleted-target-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-text", capability: "text", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-deleted-target-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件删除目标$/ }).click();
    await expect.poll(() => posts).toBe(1);
    const targetId = (await page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        return useCanvasStore.getState().projects[0].nodes[0].id;
    }));
    await page.locator(".node-element").click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".node-element")).toHaveCount(0);
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator(".node-element")).toHaveCount(1);
    release();
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0]?.status;
    }))).toBe("succeeded");
    const state = await page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        return useCanvasStore.getState().projects[0];
    });
    expect(posts).toBe(1);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).not.toBe(targetId);
    expect(state.nodes[0].metadata?.generationRunId).toBeUndefined();
    expect(state.nodes[0].metadata?.content).not.toBe("should stay in deleted target");
    expect(JSON.stringify(await page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs[0];
    }))).not.toContain("qa-durable-deleted-target-secret");
});

test("plugin audio generation stores one localized run and reuses it after refresh", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      let disposed = false;",
        "      void ctx.ai.generateAudio('Plugin durable audio').then(() => {",
        "        if (!disposed) ctx.updateMetadata({ content: 'ready', status: 'success' });",
        "      });",
        "      return () => { disposed = true; };",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-audio-content' }, ctx.node.metadata?.content ? 'plugin audio ready' : 'plugin audio running');",
        "  }",
        "  return {",
        "    id: 'qa-durable-audio-plugin',",
        "    name: '耐久音频插件',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-durable-audio-plugin:audio', title: '插件音频', icon: jsx('span', null, 'A'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    let posts = 0;
    await page.route("https://qa-durable-audio-plugin.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route("https://qa-plugin-audio-provider.invalid/**", async (route) => {
        posts++;
        await route.fulfill({ contentType: "audio/mpeg", body: Buffer.from("plugin-audio") });
    });

    await enterCanvas(page);
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const config = useConfigStore.getState().config;
        const script = [
            "return await request({",
            "  method: 'post',",
            "  url: `${baseUrl}/v1/audio/speech`,",
            "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },",
            "  responseType: 'blob',",
            "  data: { model, input: prompt, response_format: params.format },",
            "});",
        ].join("\n");
        useConfigStore.setState({
            config: {
                ...config,
                proxyEnabled: false,
                model: "qa-plugin-audio::qa-audio",
                audioModel: "qa-plugin-audio::qa-audio",
                channels: [{
                    id: "qa-plugin-audio",
                    name: "插件音频 QA",
                    baseUrl: "https://qa-plugin-audio-provider.invalid",
                    apiKey: "qa-plugin-audio-secret",
                    apiFormat: "openai",
                    models: [{ name: "qa-audio", capability: "audio", script }],
                }],
            },
        });
    });
    await page.evaluate(async () => {
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-durable-audio-plugin.invalid/plugin.js");
    });

    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件音频$/ }).click();
    await expect(page.getByTestId("plugin-audio-content")).toHaveText("plugin audio ready");
    await expect.poll(async () => (await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs;
    })).length).toBe(1);
    await expect.poll(() => posts).toBe(1);

    const run = await page.evaluate(async () => {
        const { useAudioRunStore } = await import("/src/stores/use-audio-run-store.ts");
        return useAudioRunStore.getState().runs[0];
    });
    expect(run.status).toBe("succeeded");
    expect(run.audio?.storageKey).toMatch(/^audio:/);
    expect(run.request.canvas).toMatchObject({ pluginId: "qa-durable-audio-plugin", pluginNodeType: "qa-durable-audio-plugin:audio" });
    expect(JSON.stringify(run)).not.toContain("qa-plugin-audio-secret");
    await page.goto(`/tasks?kind=audio&run=${run.id}`);
    await expect(page.getByTestId("audio-task-origin-detail")).toContainText("qa-durable-audio-plugin");
    await expect(page.getByTestId("audio-task-result")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("audio-task-origin-detail")).toContainText("qa-durable-audio-plugin");
    await expect(page.getByTestId("audio-task-result")).toBeVisible();
    expect(posts).toBe(1);
});
