import { nanoid } from "nanoid";

import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { audioRunPendingStorage, audioRunLockName, createAudioRun, loadAudioRuns, ownedAudioRuns, refreshAudioRun, updateAudioRun, useAudioRunStore, withAudioRunLock } from "@/stores/use-audio-run-store";
import { modelMatchesCapability, modelOptionLabel, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { isActiveAudioRun, type AudioRun, type AudioRunSettings } from "@/types/audio-run";
import type { CanvasRunContext } from "@/types/image-run";

let submitting = false;
const currentRun = (id: string) => useAudioRunStore.getState().runs.find((run) => run.id === id)!;

function settingsSnapshot(config: AiConfig): AudioRunSettings {
    return {
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
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
    let text = error instanceof Error ? error.message : "音频生成失败";
    for (const key of [config.apiKey, ...config.channels.map((channel) => channel.apiKey)].filter(Boolean)) {
        text = text.split(key).join("[已隐藏凭据]");
    }
    return text;
}

function isAbort(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

async function finishPendingAudio(id: string) {
    const run = currentRun(id);
    if (!run.pendingResult) return;
    const blob = await audioRunPendingStorage.getItem<Blob>(run.pendingResult.blobKey);
    if (!blob) throw new Error("音频结果暂存已丢失，请重新生成");
    const stored = await storeGeneratedAudio(blob, run.request.settings.audioFormat);
    await updateAudioRun(id, (item) => ({
        ...item,
        status: "succeeded",
        error: undefined,
        pendingResult: undefined,
        audio: { ...stored, id: nanoid(), mimeType: stored.mimeType || run.pendingResult?.mimeType || "audio/mpeg" },
    }));
    await audioRunPendingStorage.removeItem(run.pendingResult.blobKey);
}

function notifyAgent(run: AudioRun) {
    if (!run.agentTaskId) return;
    useWorkbenchAgentStore.getState().updateTask(run.agentTaskId, {
        status: run.status === "interrupted" ? "failed" : run.status,
        successCount: run.audio ? 1 : 0,
        failCount: run.status === "failed" ? 1 : 0,
        error: run.persistenceError || run.error,
    });
}

export async function startAudioRun(input: {
    prompt: string;
    config: AiConfig;
    agentTaskId?: string;
    retryOf?: string;
    expectedFingerprint?: string;
    canvas?: CanvasRunContext;
    signal?: AbortSignal;
    onCreated?: (id: string) => void;
}): Promise<AudioRun> {
    if (submitting || useAudioRunStore.getState().runs.some((run) => ownedAudioRuns.has(run.id) && isActiveAudioRun(run))) throw new Error("音频生成正在执行，请等待本次任务完成");
    submitting = true;
    try {
        if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
        const config = structuredClone(input.config);
        const model = config.audioModel || config.model;
        config.model = model;
        const prompt = input.prompt.trim();
        if (!prompt) throw new Error("请输入提示词");
        await loadAudioRuns();
        if (!useConfigStore.getState().isAiConfigReady(config, model) || !modelMatchesCapability(config, model, "audio")) throw new Error("原音频渠道或模型不可用");
        const fingerprint = await channelFingerprint(config, model);
        if (input.expectedFingerprint && input.expectedFingerprint !== fingerprint) throw new Error("原渠道、接口或模型脚本已改变，未提交重试。请恢复原配置，或创建新任务。");
        const now = Date.now();
        const run: AudioRun = {
            version: 1,
            revision: 0,
            id: nanoid(),
            kind: "audio",
            source: "audio",
            agentTaskId: input.agentTaskId,
            retryOf: input.retryOf,
            createdAt: now,
            updatedAt: now,
            status: "queued",
            request: { prompt, model, modelLabel: modelOptionLabel(config, model), channelFingerprint: fingerprint, settings: settingsSnapshot(config), canvas: input.canvas },
        };
        return await navigator.locks.request(audioRunLockName(run.id), async () => {
            ownedAudioRuns.add(run.id);
            try {
                await createAudioRun(run);
                input.onCreated?.(run.id);
                await updateAudioRun(run.id, (item) => ({ ...item, status: "running" }));
                notifyAgent(currentRun(run.id));
                if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
                const blob = await requestAudioGeneration(config, prompt, { signal: input.signal });
                const blobKey = `pending:${run.id}`;
                await audioRunPendingStorage.setItem(blobKey, blob);
                await updateAudioRun(run.id, (item) => ({ ...item, pendingResult: { blobKey, mimeType: blob.type }, status: "running" }));
                await finishPendingAudio(run.id);
            } catch (error) {
                const current = currentRun(run.id);
                if (current.pendingResult) {
                    await updateAudioRun(run.id, (item) => ({ ...item, status: "interrupted", error: "音频已生成但本地结果尚未完成保存，请继续处理" })).catch(() => undefined);
                } else {
                    await updateAudioRun(run.id, (item) => ({ ...item, status: isAbort(error) ? "interrupted" : "failed", error: safeError(error, config) })).catch(() => undefined);
                }
            } finally {
                notifyAgent(currentRun(run.id));
                ownedAudioRuns.delete(run.id);
            }
            return currentRun(run.id);
        });
    } finally {
        submitting = false;
    }
}

export async function resumeAudioRun(id: string) {
    return withAudioRunLock(id, async (run) => {
        if (!run || run.status === "succeeded" || run.status === "failed") return run;
        if (run.persistenceError) throw new Error("请先重新保存任务记录");
        try {
            if (run.pendingResult) await finishPendingAudio(id);
            else await updateAudioRun(id, (item) => ({ ...item, status: "interrupted", error: "页面在任务完成前关闭；当前音频 Provider 没有可验证的续查协议" }));
        } catch (error) {
            await updateAudioRun(id, (item) => ({ ...item, status: "interrupted", error: safeError(error, useConfigStore.getState().config) })).catch(() => undefined);
        }
        const completed = currentRun(id);
        notifyAgent(completed);
        return completed;
    });
}

export async function initializeAudioRuns() {
    await loadAudioRuns();
    for (const run of useAudioRunStore.getState().runs.filter(isActiveAudioRun)) {
        void resumeAudioRun(run.id).catch(() => undefined);
    }
}

export async function resaveAudioRun(id: string) {
    return withAudioRunLock(id, async (run) => {
        if (!run) throw new Error("音频任务不存在");
        await updateAudioRun(id, (item) => item);
        if (run.pendingResult) await finishPendingAudio(id);
        else if (isActiveAudioRun(run)) await updateAudioRun(id, (item) => ({ ...item, status: "interrupted", error: "记录已保存，请核对原服务结果" }));
        notifyAgent(currentRun(id));
    });
}

export async function retryAudioRun(id: string) {
    if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
    return navigator.locks.request(`huabu:audio-retry:${id}`, async () => {
        await loadAudioRuns();
        const run = currentRun(id);
        if (!run || run.status !== "failed" || run.persistenceError) throw new Error("仅可重试已确认失败且保存成功的任务");
        const child = useAudioRunStore.getState().runs.find((item) => item.retryOf === id);
        if (child) return child;
        return startAudioRun({
            prompt: run.request.prompt,
            config: { ...useConfigStore.getState().config, ...run.request.settings, model: run.request.model, audioModel: run.request.model },
            expectedFingerprint: run.request.channelFingerprint,
            retryOf: id,
            canvas: run.request.canvas,
        });
    });
}
