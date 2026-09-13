import localforage from "localforage";
import { create } from "zustand";

import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import type { VideoRun } from "@/types/video-run";

export const videoRunStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "video_runs" });
export const videoRunLockName = (id: string) => `huabu:video-run:${id}`;
export const ownedVideoRuns = new Set<string>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("huabu:video-runs");
const writes = new Map<string, Promise<void>>();
let loading: Promise<void> | undefined;
let refreshQueued = false;

export const useVideoRunStore = create<{
    runs: VideoRun[]; hydrated: boolean; loadError?: string;
}>(() => ({ runs: [], hydrated: false }));

function publish(run: VideoRun) {
    useVideoRunStore.setState((state) => ({
        runs: [run, ...state.runs.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

function serialize(run: VideoRun): VideoRun {
    return {
        ...run, persistenceError: undefined,
        request: {
            ...run.request,
            references: run.request.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
            videos: run.request.videos.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
            audios: run.request.audios.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        },
        video: run.video ? { ...run.video, url: run.video.storageKey ? "" : run.video.url } : undefined,
    };
}

async function hydrate(run: VideoRun): Promise<VideoRun> {
    return {
        ...run,
        request: {
            ...run.request,
            references: await Promise.all(run.request.references.map(async (item) => ({ ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) }))),
            videos: await Promise.all(run.request.videos.map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) }))),
            audios: await Promise.all(run.request.audios.map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) }))),
        },
        video: run.video ? { ...run.video, url: await resolveMediaUrl(run.video.storageKey, run.video.url) } : undefined,
    };
}

export async function createVideoRun(run: VideoRun) {
    try { await videoRunStorage.setItem(run.id, serialize(run)); }
    catch { throw new Error("视频任务无法保存，未提交生成请求"); }
    publish(run);
    channel?.postMessage(run.id);
}

// Call under the task lock. Preserve newer in-memory facts when a write fails.
export function updateVideoRun(id: string, change: (run: VideoRun) => VideoRun): Promise<void> {
    const operation = (writes.get(id) || Promise.resolve()).catch(() => undefined).then(async () => {
        const previous = useVideoRunStore.getState().runs.find((run) => run.id === id);
        if (!previous) throw new Error("视频任务记录不存在");
        const next = { ...change(previous), revision: previous.revision + 1, updatedAt: Date.now(), persistenceError: undefined };
        publish(next);
        try {
            await videoRunStorage.setItem(id, serialize(next));
            channel?.postMessage(id);
        } catch {
            publish({ ...next, persistenceError: "任务记录未能保存。请保留本页并重新保存，避免丢失任务或结果。" });
            throw new Error("视频任务保存失败，未自动重新提交");
        }
    });
    writes.set(id, operation);
    void operation.finally(() => { if (writes.get(id) === operation) writes.delete(id); }).catch(() => undefined);
    return operation;
}

export async function refreshVideoRun(id: string) {
    const local = useVideoRunStore.getState().runs.find((run) => run.id === id);
    if (local?.persistenceError) return local;
    const saved = await videoRunStorage.getItem<VideoRun>(id);
    if (!saved) return undefined;
    const run = await hydrate(saved);
    publish(run);
    return run;
}

export function loadVideoRuns(): Promise<void> {
    if (loading) { refreshQueued = true; return loading; }
    const startedAt = Date.now();
    loading = (async () => {
        try {
            const records: VideoRun[] = [];
            await videoRunStorage.iterate<VideoRun, void>((value) => {
                if (value.version !== 1 || value.kind !== "video" || !value.request?.binding || !Array.isArray(value.request.references)
                    || !Array.isArray(value.request.videos) || !Array.isArray(value.request.audios)) throw new Error("存在无法识别的视频任务，已保留原数据");
                records.push(value);
            });
            const incoming = await Promise.all(records.map(hydrate));
            const saved = new Map(incoming.map((run) => [run.id, run]));
            const local = useVideoRunStore.getState().runs.filter((run) => ownedVideoRuns.has(run.id) || run.persistenceError
                || (saved.has(run.id) ? run.revision > saved.get(run.id)!.revision : run.createdAt >= startedAt));
            useVideoRunStore.setState({
                runs: [...local, ...incoming.filter((run) => !local.some((item) => item.id === run.id))].sort((a, b) => b.createdAt - a.createdAt),
                hydrated: true, loadError: undefined,
            });
        } catch (error) {
            useVideoRunStore.setState({ hydrated: true, loadError: error instanceof Error ? error.message : "视频任务读取失败" });
            throw error;
        }
    })().finally(async () => {
        loading = undefined;
        if (refreshQueued) { refreshQueued = false; await loadVideoRuns(); }
    });
    return loading;
}

export async function withVideoRunLock<T>(id: string, action: (run: VideoRun | undefined) => Promise<T>) {
    if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁，请使用支持 Web Locks 的浏览器");
    return navigator.locks.request(videoRunLockName(id), { ifAvailable: true }, async (lock) => {
        if (!lock) return undefined;
        ownedVideoRuns.add(id);
        try { return await action(await refreshVideoRun(id)); }
        finally { ownedVideoRuns.delete(id); }
    });
}

export async function deleteVideoRun(id: string) {
    const deleted = await withVideoRunLock(id, async (run) => {
        if (run && (run.status === "queued" || run.status === "running" || run.persistenceError || run.pendingResult)) throw new Error("请先完成任务或保存结果");
        await videoRunStorage.removeItem(id);
        useVideoRunStore.setState((state) => ({ runs: state.runs.filter((item) => item.id !== id) }));
        channel?.postMessage(id);
        return true;
    });
    if (!deleted) throw new Error("任务正在其他页面执行");
}

if (channel) channel.onmessage = () => { void loadVideoRuns().catch(() => undefined); };
