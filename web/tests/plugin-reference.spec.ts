import { expect, test } from "@playwright/test";

test("plugin text references are forwarded into the real multimodal request", async ({ page }) => {
    const pluginSource = [
        "export default function(runtime) {",
        "  const React = runtime.React;",
        "  const jsx = runtime.jsx;",
        "  const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';",
        "  function Content({ ctx }) {",
        "    React.useEffect(() => {",
        "      void ctx.ai.generateText('描述插件参考图', { references: [reference] }).then(({ text }) => ctx.updateMetadata({ content: text, status: 'success' })).catch((error) => ctx.updateMetadata({ status: 'error', errorDetails: String(error) }));",
        "    }, [ctx.node.id]);",
        "    return jsx('div', { 'data-testid': 'plugin-reference-content' }, 'plugin reference');",
        "  }",
        "  return {",
        "    id: 'qa-plugin-reference-text',",
        "    name: '插件参考文本',",
        "    version: '1.0.0',",
        "    nodes: [{ type: 'qa-plugin-reference-text:text', title: '插件参考文本', icon: jsx('span', null, 'T'), defaultSize: { width: 300, height: 180 }, Content }],",
        "  };",
        "}",
    ].join("\n");
    await page.route("https://qa-plugin-reference-text.invalid/plugin.js", (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.goto("/canvas?mode=new");
    await expect(page.getByRole("button", { name: "文本", exact: true })).toBeVisible();
    let requestBody: any = null;
    await page.route("https://plugin-text-reference.invalid/**", async (route) => {
        requestBody = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: ['data: {"type":"response.output_text.delta","delta":"plugin reference received"}', "", "data: [DONE]", ""].join("\n"),
        });
    });
    await page.evaluate(async () => {
        const { useConfigStore } = await import("/src/stores/use-config-store.ts");
        const current = useConfigStore.getState().config;
        const config = {
            ...current,
            proxyEnabled: false,
            model: "plugin-reference::text",
            textModel: "plugin-reference::text",
            channels: [{
                id: "plugin-reference",
                name: "Plugin text reference QA",
                baseUrl: "https://plugin-text-reference.invalid/v1",
                apiKey: "plugin-text-reference-key",
                apiFormat: "openai" as const,
                models: [{ name: "text", capability: "text" as const }],
            }],
        };
        useConfigStore.setState({ config });
        const { installPluginFromUrl } = await import("/src/lib/canvas/plugin-loader.ts");
        await installPluginFromUrl("https://qa-plugin-reference-text.invalid/plugin.js");
    });
    await page.getByRole("button", { name: "扩展节点", exact: true }).click();
    await page.getByRole("button", { name: /插件参考文本$/ }).click();
    await expect.poll(() => requestBody).toBeTruthy();
    expect(requestBody.input[0].content).toEqual(expect.arrayContaining([
        { type: "input_text", text: "描述插件参考图" },
        expect.objectContaining({ type: "input_image", image_url: expect.stringMatching(/^data:image\/png;base64,/) }),
    ]));
    await expect(page.locator("[data-testid='plugin-reference-content']")).toBeVisible();
});
