import { nanoid } from "nanoid";

import { requestImageQuestion } from "@/services/api/image";
import { getImageBlob, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { createTextRun, ownedTextRuns, textRunLockName, updateTextRun, useTextRunStore, initializeTextRuns } from "@/stores/use-text-run-store";
import { modelMatchesCapability, modelOptionLabel, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import type { CanvasRunContext } from "@/types/image-run";
import { isActiveTextRun, type TextRun, type TextRunSettings } from "@/types/text-run";

const currentRun = (id: string) => useTextRunStore.getState().runs.find((run) => run.id === id)!;

function settingsSnapshot(config: AiConfig): TextRunSettings {
    return { systemPrompt: config.systemPrompt, reasoningEffort: config.reasoningEffort };
}

async function channelFingerprint(config: AiConfig, model: string) {
    const resolved = resolveModelRequestConfig(config, model);
    const identity = JSON.stringify({
        channelId: resolveModelChannel(config, model).id,
        baseUrl: resolved.baseUrl.trim().replace(/\/+$/, ""),
        apiFormat: resolved.apiFormat,
        model: resolved.model,
        script: resolveModelScript(config, model),
    });
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeError(error: unknown, config: AiConfig) {
    let text = error instanceof Error ? error.message : "文本生成失败";
    for (const key of [config.apiKey, ...config.channels.map((channel) => channel.apiKey)].filter(Boolean)) {
        text = text.split(key).join("[已隐藏凭据]");
    }
    return text;
}

async function freezeReferences(references: ReferenceImage[]) {
    return Promise.all(references.map(async (item) => {
        if (item.storageKey) {
            if (!(await getImageBlob(item.storageKey))) throw new Error(`参考图「${item.name}」已丢失，请重新添加`);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey) };
        }
        const stored = await uploadImage(item.dataUrl);
        if (!stored.storageKey) throw new Error(`参考图「${item.name}」无法保存到本地，未提交生成`);
        return { ...item, dataUrl: stored.url, storageKey: stored.storageKey };
    }));
}

export async function startTextRun(input: {
    prompt: string;
    config: AiConfig;
    references?: ReferenceImage[];
    agentTaskId?: string;
    retryOf?: string;
    expectedFingerprint?: string;
    canvas?: CanvasRunContext;
    signal?: AbortSignal;
    onCreated?: (id: string) => void;
    onDelta?: (text: string) => void;
}): Promise<TextRun> {
    let id: string | undefined;
    try {
        if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
        const config = structuredClone(input.config);
        const model = config.textModel || config.model;
        config.model = model;
        const prompt = input.prompt.trim();
        if (!prompt) throw new Error("请输入提示词");
        await initializeTextRuns();
        if (!useConfigStore.getState().isAiConfigReady(config, model) || !modelMatchesCapability(config, model, "text")) throw new Error("原文本渠道或模型不可用");
        const fingerprint = await channelFingerprint(config, model);
        if (input.expectedFingerprint && input.expectedFingerprint !== fingerprint) throw new Error("原渠道、接口或模型脚本已改变，未提交重试。请恢复原配置，或创建新任务。");
        const references = await freezeReferences(input.references || []);
        id = nanoid();
        const now = Date.now();
        const run: TextRun = {
            version: 1, revision: 0, id, kind: "text", source: "text", agentTaskId: input.agentTaskId, retryOf: input.retryOf,
            createdAt: now, updatedAt: now, status: "queued",
            request: { prompt, model, modelLabel: modelOptionLabel(config, model), channelFingerprint: fingerprint, settings: settingsSnapshot(config), references, canvas: input.canvas },
        };
        ownedTextRuns.add(id);
        return await navigator.locks.request(textRunLockName(id), async () => {
            await createTextRun(run);
            input.onCreated?.(id!);
            await updateTextRun(id!, (item) => ({ ...item, status: "running" }));
            if (input.agentTaskId) useWorkbenchAgentStore.getState().updateTask(input.agentTaskId, { status: "running" });
            if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            let partial = "";
            let lastPartialPersistAt = 0;
            try {
                const messages = references.length
                    ? [{
                          role: "user" as const,
                          content: [{ type: "text" as const, text: prompt }, ...references.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
                      }]
                    : [{ role: "user" as const, content: prompt }];
                const content = await requestImageQuestion(config, messages, (text) => {
                    partial = text;
                    input.onDelta?.(text);
                    if (Date.now() - lastPartialPersistAt >= 120) {
                        lastPartialPersistAt = Date.now();
                        void updateTextRun(id!, (item) => ({ ...item, partialContent: text })).catch(() => undefined);
                    }
                }, { signal: input.signal });
                const finalContent = content || partial;
                await updateTextRun(id!, (item) => ({ ...item, status: "succeeded", content: finalContent, partialContent: finalContent, error: undefined }));
            } catch (error) {
                const aborted = error instanceof DOMException && error.name === "AbortError";
                await updateTextRun(id!, (item) => ({ ...item, status: aborted ? "interrupted" : "failed", error: safeError(error, config) })).catch(() => undefined);
            }
            const completed = currentRun(id!);
            if (completed.agentTaskId) useWorkbenchAgentStore.getState().updateTask(completed.agentTaskId, {
                status: completed.status === "succeeded" ? "succeeded" : completed.status === "interrupted" ? "failed" : completed.status,
                successCount: completed.status === "succeeded" ? 1 : 0,
                failCount: completed.status === "failed" ? 1 : 0,
                error: completed.persistenceError || completed.error,
            });
            return completed;
        });
    } finally {
        if (id) ownedTextRuns.delete(id);
    }
}

export async function retryTextRun(id: string) {
    if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
    return navigator.locks.request(`huabu:text-retry:${id}`, async () => {
        await initializeTextRuns();
        const run = useTextRunStore.getState().runs.find((item) => item.id === id);
        if (!run || (run.status !== "failed" && run.status !== "interrupted") || run.persistenceError) throw new Error("仅可重试已保存的失败或中断文本任务");
        const child = useTextRunStore.getState().runs.find((item) => item.retryOf === id);
        if (child) return child;
        return startTextRun({
            prompt: run.request.prompt,
            config: { ...useConfigStore.getState().config, ...run.request.settings, model: run.request.model, textModel: run.request.model },
            references: run.request.references,
            expectedFingerprint: run.request.channelFingerprint,
            retryOf: id,
            canvas: run.request.canvas,
        });
    });
}
