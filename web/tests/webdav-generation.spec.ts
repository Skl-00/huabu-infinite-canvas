import { expect, test } from "@playwright/test";

test("WebDAV sync includes durable generation runs and restores remote text tasks", async ({ page }) => {
    const remoteRun = {
        version: 1,
        revision: 2,
        id: "remote-text-run",
        kind: "text",
        source: "text",
        createdAt: 100,
        updatedAt: 200,
        status: "succeeded",
        request: {
            prompt: "Remote durable prompt",
            model: "qa::text",
            modelLabel: "text",
            channelFingerprint: "fingerprint",
            settings: { systemPrompt: "", reasoningEffort: "auto" },
            references: [],
        },
        content: "Remote durable result",
    };
    const uploadedManifests = new Map<string, unknown>();
    await page.route("https://qa-webdav.invalid/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const relative = url.pathname.split("/").slice(2).join("/");
        if (request.method() === "MKCOL") {
            await route.fulfill({ status: 201 });
            return;
        }
        if (request.method() === "PROPFIND") {
            await route.fulfill({ status: 207, contentType: "application/xml", body: "<multistatus />" });
            return;
        }
        if (request.method() === "GET") {
            if (relative === "generation-runs/manifest.json") {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ app: "infinite-canvas", version: 1, domain: "generation-runs", exportedAt: new Date().toISOString(), data: { runs: [remoteRun] }, files: [] }),
                });
            } else {
                await route.fulfill({ status: 404 });
            }
            return;
        }
        if (request.method() === "PUT") {
            const body = await request.postData();
            uploadedManifests.set(relative, body ? JSON.parse(body) : null);
            await route.fulfill({ status: 201 });
            return;
        }
        await route.fulfill({ status: 405 });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { useCanvasStore } = await import("/src/stores/canvas/use-canvas-store.ts");
        const { useAssetStore } = await import("/src/stores/use-asset-store.ts");
        const { useTextRunStore, textRunStorage } = await import("/src/stores/use-text-run-store.ts");
        const { syncAppDataToWebdav } = await import("/src/services/app-sync.ts");
        const current = useTextRunStore.getState().runs;
        await Promise.all(current.map((run) => textRunStorage.removeItem(run.id)));
        useTextRunStore.setState({ runs: [], hydrated: true });
        useCanvasStore.setState({ hydrated: true, projects: [], deletedProjects: [] });
        useAssetStore.setState({ hydrated: true, assets: [] });
        return syncAppDataToWebdav({
            url: "https://qa-webdav.invalid",
            username: "",
            password: "",
            directory: "huabu",
            lastSyncedAt: "",
        });
    });

    expect(result.generationRuns).toBe(1);
    expect(uploadedManifests.get("generation-runs/manifest.json")).toMatchObject({
        domain: "generation-runs",
        data: { runs: [{ id: "remote-text-run", content: "Remote durable result" }] },
    });
    expect(JSON.stringify(uploadedManifests.get("generation-runs/manifest.json"))).not.toContain("apiKey");
    await expect.poll(async () => page.evaluate(async () => {
        const { useTextRunStore } = await import("/src/stores/use-text-run-store.ts");
        return useTextRunStore.getState().runs.find((run) => run.id === "remote-text-run")?.content;
    })).toBe("Remote durable result");
});
