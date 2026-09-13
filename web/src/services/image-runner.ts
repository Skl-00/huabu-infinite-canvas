import { nanoid } from "nanoid";

import { requestEdit, requestGeneration } from "@/services/api/image";
import { getImageBlob, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { createImageRun, imageRunLockName, initializeImageRuns, ownedImageRuns, updateImageRun, useImageRunStore } from "@/stores/use-image-run-store";
import { modelMatchesCapability, modelOptionLabel, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { completedImageRunStatus, isActiveImageRun, type CanvasRunContext, type ImageRun, type ImageRunSettings, type ImageRunSlot } from "@/types/image-run";
import type { ReferenceImage } from "@/types/image";

let submitting = false;

function settingsSnapshot(config: AiConfig): ImageRunSettings {
    return { quality: config.quality, size: config.size, background: config.background, systemPrompt: config.systemPrompt, reasoningEffort: config.reasoningEffort };
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
    let text = error instanceof Error ? error.message : "生成失败";
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

export async function startImageRun(input: { prompt: string; config: AiConfig; references: ReferenceImage[]; count: number; agentTaskId?: string; retryOf?: string; expectedFingerprint?: string; canvas?: CanvasRunContext; signal?: AbortSignal; onCreated?: (id: string) => void }): Promise<ImageRun> {
    if (submitting || useImageRunStore.getState().runs.some((run) => ownedImageRuns.has(run.id) && isActiveImageRun(run))) throw new Error("图片生成正在执行，请等待本次任务完成");
    submitting = true;
    let id: string | undefined;
    try {
        const config = structuredClone(input.config);
        const inputReferences = structuredClone(input.references);
        if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁，请使用支持 Web Locks 的浏览器");
        await initializeImageRuns();
        const model = config.imageModel || config.model;
        config.model = model;
        config.count = "1";
        if (!input.prompt.trim()) throw new Error("请输入提示词");
        if (!useConfigStore.getState().isAiConfigReady(config, model) || !modelMatchesCapability(config, model, "image")) throw new Error("原图片渠道或模型不可用，请检查模型配置");
        if (!Number.isInteger(input.count) || input.count < 1) throw new Error("生成数量无效");
        const fingerprint = await channelFingerprint(config, model);
        if (input.expectedFingerprint && input.expectedFingerprint !== fingerprint) throw new Error("原渠道、接口或模型脚本已改变，未提交重试。请恢复原配置，或在图片工作台创建新任务。");
        const references = await freezeReferences(inputReferences);
        id = nanoid();
        const now = Date.now();
        const run: ImageRun = {
            version: 1, revision: 0, id, kind: "image", source: "image", agentTaskId: input.agentTaskId, retryOf: input.retryOf,
            createdAt: now, updatedAt: now, status: "queued",
            request: { prompt: input.prompt.trim(), model, modelLabel: modelOptionLabel(config, model), channelFingerprint: fingerprint, settings: settingsSnapshot(config), references, canvas: input.canvas },
            slots: Array.from({ length: input.count }, () => ({ id: nanoid(), status: "pending" })),
        };
        ownedImageRuns.add(id);
        return await navigator.locks.request(imageRunLockName(id), async () => {
            // Both the request and the running transition must be durable before spending API credit.
            await createImageRun(run);
            input.onCreated?.(run.id);
            if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            try {
                await updateImageRun(run.id, (current) => ({ ...current, status: "running" }));
            } catch (error) {
                await updateImageRun(run.id, (current) => ({ ...current, status: "interrupted" })).catch(() => undefined);
                throw error;
            }
            if (input.agentTaskId) useWorkbenchAgentStore.getState().updateTask(input.agentTaskId, { status: "running" });
            // Agnes 免费模型只允许一个图片请求在途；当前槽位失败后继续处理后续槽位。
            for (const slot of run.slots) {
                const started = performance.now();
                let next: ImageRunSlot;
                try {
                    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
                    const images = references.length
                        ? await requestEdit(config, run.request.prompt, references, { signal: input.signal })
                        : await requestGeneration(config, run.request.prompt, { signal: input.signal });
                    if (!images[0]) throw new Error("接口未返回图片");
                    const stored = await uploadImage(images[0].dataUrl);
                    next = { ...slot, status: "success", image: {
                        id: images[0].id, dataUrl: stored.url, storageKey: stored.storageKey,
                        width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType,
                        durationMs: performance.now() - started,
                    } };
                } catch (error) {
                    next = { ...slot, status: "failed", error: safeError(error, config) };
                }
                await updateImageRun(run.id, (current) => ({
                    ...current, slots: current.slots.map((item) => item.id === slot.id ? next : item),
                })).catch(() => undefined);
            }
            await updateImageRun(run.id, (current) => ({ ...current, status: completedImageRunStatus(current.slots) })).catch(() => undefined);
            const completed = useImageRunStore.getState().runs.find((item) => item.id === run.id)!;
            if (input.agentTaskId) {
                useWorkbenchAgentStore.getState().updateTask(input.agentTaskId, {
                    status: completed.status === "partial" ? "partial" : completed.status === "succeeded" ? "succeeded" : "failed",
                    successCount: completed.slots.filter((slot) => slot.status === "success").length,
                    failCount: completed.slots.filter((slot) => slot.status === "failed").length,
                    error: completed.persistenceError || completed.slots.find((slot) => slot.error)?.error,
                });
            }
            return completed;
        });
    } finally {
        if (id) ownedImageRuns.delete(id);
        submitting = false;
    }
}

export async function retryImageRun(id: string, slotId?: string) {
    await initializeImageRuns();
    const run = useImageRunStore.getState().runs.find((item) => item.id === id);
    if (!run || isActiveImageRun(run)) throw new Error("任务不存在或仍在执行");
    if (run.persistenceError) throw new Error("请先重新保存任务记录");
    const slots = run.slots.filter((slot) => slot.status !== "success" && (!slotId || slot.id === slotId));
    if (!slots.length) throw new Error("没有需要重试的结果");
    return startImageRun({
        prompt: run.request.prompt,
        config: { ...useConfigStore.getState().config, ...run.request.settings, imageModel: run.request.model, model: run.request.model },
        references: run.request.references,
        count: slots.length,
        retryOf: run.id,
        expectedFingerprint: run.request.channelFingerprint,
        canvas: run.request.canvas,
    });
}
