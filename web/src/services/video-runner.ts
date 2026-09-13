import { nanoid } from "nanoid";

import { AGNES_VIDEO_FLASH_LIMITS, createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { normalizeAgnesVideoSeconds } from "@/services/api/agnes";
import { captureModelBinding, redactProviderError, resolveBoundModelConfig, type ModelBinding } from "@/services/api/model-binding";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { createVideoRun, loadVideoRuns, ownedVideoRuns, updateVideoRun, useVideoRunStore, withVideoRunLock } from "@/stores/use-video-run-store";
import { modelMatchesCapability, modelOptionLabel, resolveModelRequestConfig, resolveModelScript, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { isActiveVideoRun, type VideoRun, type VideoRunSettings } from "@/types/video-run";
import type { CanvasRunContext } from "@/types/image-run";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

let submitting = false;
let initialization: Promise<void> | undefined;
const currentRun = (id: string) => useVideoRunStore.getState().runs.find((run) => run.id === id)!;
const remoteUrl = (url: string) => /^https?:\/\//i.test(url);
const taskForPersistence = (task: VideoRun["task"]) => {
    if (!task || task.provider !== "plugin") return task;
    const { inlineResult: _inlineResult, ...safeTask } = task;
    return safeTask;
};

function frozenSettings(config: AiConfig, agnes: boolean): VideoRunSettings {
    return {
        size: config.size, vquality: agnes ? "720" : config.vquality,
        videoSeconds: agnes ? normalizeAgnesVideoSeconds(config.videoSeconds) : config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark, videoMode: config.videoMode,
    };
}

async function freezeImages(references: ReferenceImage[], agnes: boolean) {
    const result: ReferenceImage[] = [];
    for (const item of references) {
        if (remoteUrl(item.dataUrl) && !item.storageKey) { result.push({ ...item }); continue; }
        if (agnes) throw new Error("Agnes 不接收本地参考素材，请使用可访问的图片链接");
        if (item.storageKey) {
            if (!(await getImageBlob(item.storageKey))) throw new Error(`参考图「${item.name}」已丢失，未提交`);
            result.push({ ...item, dataUrl: await resolveImageUrl(item.storageKey) });
        } else {
            const stored = await uploadImage(item.dataUrl);
            if (!stored.storageKey) throw new Error(`参考图「${item.name}」保存失败，未提交`);
            result.push({ ...item, storageKey: stored.storageKey, dataUrl: stored.url });
        }
    }
    return result;
}

async function freezeMedia<T extends ReferenceVideo | ReferenceAudio>(references: T[], agnes: boolean, kind: string): Promise<T[]> {
    const result: T[] = [];
    for (const item of references) {
        if (remoteUrl(item.url) && !item.storageKey) { result.push({ ...item }); continue; }
        if (agnes) throw new Error("Agnes 不接收本地参考素材，请使用可访问的媒体链接");
        if (item.storageKey) {
            if (!(await getMediaBlob(item.storageKey))) throw new Error(`参考素材「${item.name}」已丢失，未提交`);
            result.push({ ...item, url: await resolveMediaUrl(item.storageKey) });
        } else {
            const stored = await uploadMediaFile(item.url, kind);
            result.push({ ...item, storageKey: stored.storageKey, url: stored.url });
        }
    }
    return result;
}

function notifyAgent(run: VideoRun) {
    if (!run.agentTaskId) return;
    useWorkbenchAgentStore.getState().updateTask(run.agentTaskId, {
        status: run.status === "interrupted" ? "failed" : run.status,
        successCount: run.video ? 1 : 0, failCount: run.status === "failed" ? 1 : 0,
        error: run.persistenceError || run.error,
    });
}

async function finishResult(id: string) {
    const run = currentRun(id);
    if (!run.pendingResult) return;
    const stored = await storeGeneratedVideo(run.pendingResult);
    await updateVideoRun(id, (item) => ({
        ...item, status: "succeeded", error: undefined, pendingResult: undefined,
        video: { ...stored, id: nanoid(), width: stored.width || 0, height: stored.height || 0, durationMs: stored.durationMs || 0 },
    }));
}

async function queryRun(id: string, signal?: AbortSignal) {
    let config = useConfigStore.getState().config;
    try {
        const run = currentRun(id);
        if (run.pendingResult) { await finishResult(id); return; }
        if (!run.task) throw new Error("提交时中断，尚无远端任务 ID。请在原服务核对，不会自动重新生成");
        config = { ...config, ...run.request.settings, model: run.request.model, videoModel: run.request.model };
        await resolveBoundModelConfig(config, run.request.model, run.request.binding);
        await updateVideoRun(id, (item) => ({ ...item, status: "running", error: undefined }));
        const result = await waitForVideoGenerationTask(config, run.task, { signal });
        if (result.url && [config.apiKey, ...config.channels.map((channel) => channel.apiKey)].filter(Boolean).some((key) => result.url!.includes(key) || result.url!.includes(encodeURIComponent(key)))) {
            throw new Error("结果链接含渠道凭据，未保存。请恢复下载后继续查询原任务");
        }
        // Stage the provider result before localizing it, so storage failures never turn into new generation.
        await updateVideoRun(id, (item) => ({ ...item, pendingResult: result }));
        await finishResult(id);
    } catch (error) {
        if (!currentRun(id).persistenceError) {
            await updateVideoRun(id, (item) => ({ ...item, status: isVideoTaskFailed(error) ? "failed" : "interrupted", error: redactProviderError(error, config) })).catch(() => undefined);
        }
    } finally { notifyAgent(currentRun(id)); }
}

export async function startVideoRun(input: {
    prompt: string; config: AiConfig; references: ReferenceImage[];
    videos?: ReferenceVideo[]; audios?: ReferenceAudio[]; agentTaskId?: string;
    retryOf?: string; expectedBinding?: ModelBinding; onCreated?: (id: string) => void;
    canvas?: CanvasRunContext; signal?: AbortSignal;
}): Promise<VideoRun> {
    if (submitting || useVideoRunStore.getState().runs.some((run) => ownedVideoRuns.has(run.id) && isActiveVideoRun(run))) throw new Error("视频生成正在执行，请等待本次任务完成");
    submitting = true;
    try {
        if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
        const config = structuredClone(input.config);
        const model = config.videoModel || config.model;
        config.model = model;
        const prompt = input.prompt.trim();
        if (!prompt) throw new Error("请输入提示词");
        await loadVideoRuns();
        if (!useConfigStore.getState().isAiConfigReady(config, model) || !modelMatchesCapability(config, model, "video")) throw new Error("原视频渠道或模型不可用");
        if (input.expectedBinding) await resolveBoundModelConfig(config, model, input.expectedBinding);
        const binding = await captureModelBinding(config, model);
        const agnes = resolveModelRequestConfig(config, model).apiFormat === "agnes" && !resolveModelScript(config, model);
        if (agnes && (input.references.length > AGNES_VIDEO_FLASH_LIMITS.maxImages || (input.videos?.length || 0) > 0 || (input.audios?.length || 0) > AGNES_VIDEO_FLASH_LIMITS.maxAudios)) throw new Error("参考素材超出 Agnes Video Flash 的支持范围，未提交任务");
        const references = await freezeImages(structuredClone(input.references), agnes);
        const videos = await freezeMedia(structuredClone(input.videos || []), agnes, "video");
        const audios = await freezeMedia(structuredClone(input.audios || []), agnes, "audio");
        const settings = frozenSettings(config, agnes);
        Object.assign(config, settings);
        const now = Date.now();
        const run: VideoRun = {
            version: 1, revision: 0, id: nanoid(), kind: "video", source: "video",
            agentTaskId: input.agentTaskId, retryOf: input.retryOf, createdAt: now, updatedAt: now, status: "queued",
            request: { prompt, model, modelLabel: modelOptionLabel(config, model), binding, settings, references, videos, audios, canvas: input.canvas },
        };
        return (await withVideoRunLock(run.id, async () => {
            await createVideoRun(run);
            input.onCreated?.(run.id);
            try {
                await updateVideoRun(run.id, (item) => ({ ...item, status: "running" }));
                notifyAgent(currentRun(run.id));
                if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
                const task = await createVideoGenerationTask(config, prompt, references, { videos, audios, signal: input.signal });
                const persistedTask = taskForPersistence({ ...task, binding });
                if (task.provider === "plugin") {
                    if (!task.inlineResult) throw new Error("插件视频任务没有可保存的结果");
                    if (task.inlineResult.blob) {
                        // A Blob is safe to stage locally. If final media storage fails, the pending result
                        // remains durable and can be completed from the task center without another Provider call.
                        await updateVideoRun(run.id, (item) => ({ ...item, task: persistedTask, pendingResult: task.inlineResult }));
                        await finishResult(run.id);
                    } else if (task.inlineResult.url) {
                        // Do not persist a remote plugin URL: it may contain a credential or expire quickly.
                        const stored = await uploadMediaFile(task.inlineResult.url, "video");
                        await updateVideoRun(run.id, (item) => ({
                            ...item,
                            task: persistedTask,
                            status: "succeeded",
                            error: undefined,
                            video: { ...stored, id: nanoid(), width: stored.width || 0, height: stored.height || 0, durationMs: stored.durationMs || 0 },
                        }));
                    } else {
                        throw new Error("插件视频任务没有可播放的结果");
                    }
                } else {
                    await updateVideoRun(run.id, (item) => ({ ...item, task: persistedTask }));
                    await queryRun(run.id, input.signal);
                }
            } catch (error) {
                if (!currentRun(run.id).persistenceError) await updateVideoRun(run.id, (item) => ({
                    ...item, status: "interrupted", error: redactProviderError(error, config),
                })).catch(() => undefined);
            }
            const completed = currentRun(run.id);
            notifyAgent(completed);
            return completed;
        }))!;
    } finally { submitting = false; }
}

export async function resumeVideoRun(id: string) {
    return withVideoRunLock(id, async (run) => {
        if (!run || run.status === "succeeded" || run.status === "failed") return run;
        if (run.persistenceError) throw new Error("请先重新保存任务记录");
        if (run.task?.provider === "plugin" && !run.pendingResult) {
            await updateVideoRun(id, (item) => ({ ...item, status: "interrupted", error: "脚本任务无法跨刷新恢复，请先核对原服务记录" }));
        } else await queryRun(id);
        return currentRun(id);
    });
}

export function initializeVideoRuns(): Promise<void> {
    if (initialization) return initialization;
    initialization = loadVideoRuns().then(() => {
        for (const run of useVideoRunStore.getState().runs.filter(isActiveVideoRun)) {
            void resumeVideoRun(run.id).catch(() => undefined);
        }
    }).finally(() => { initialization = undefined; });
    return initialization;
}

export async function resaveVideoRun(id: string) {
    return withVideoRunLock(id, async (run) => {
        if (!run) throw new Error("视频任务不存在");
        await updateVideoRun(id, (item) => item);
        if (run.pendingResult) await finishResult(id);
        else if (run.status === "running" || run.status === "queued") await updateVideoRun(id, (item) => ({ ...item, status: "interrupted", error: "记录已保存，请核对或继续查询原任务" }));
        notifyAgent(currentRun(id));
    });
}

export async function retryVideoRun(id: string) {
    if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁");
    return navigator.locks.request(`huabu:video-retry:${id}`, async () => {
        await loadVideoRuns();
        const run = currentRun(id);
        if (!run || run.status !== "failed" || run.persistenceError) throw new Error("仅可重试已确认失败且保存成功的任务");
        const child = useVideoRunStore.getState().runs.find((item) => item.retryOf === id);
        if (child) return child;
        return startVideoRun({
            prompt: run.request.prompt, references: run.request.references, videos: run.request.videos, audios: run.request.audios,
            config: { ...useConfigStore.getState().config, ...run.request.settings, model: run.request.model, videoModel: run.request.model },
            expectedBinding: run.request.binding, retryOf: id,
            canvas: run.request.canvas,
        });
    });
}

export async function localizeVideoRun(id: string) {
    return withVideoRunLock(id, async (run) => {
        if (!run?.video || run.video.storageKey) return;
        const stored = await uploadMediaFile(run.video.url, "video");
        await updateVideoRun(id, (item) => ({ ...item, video: { ...item.video!, ...stored, width: stored.width || 0, height: stored.height || 0, durationMs: stored.durationMs || 0 } }));
    });
}
