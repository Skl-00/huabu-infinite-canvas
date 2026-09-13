import localforage from "localforage";
import { create } from "zustand";

import { resolveMediaUrl } from "@/services/file-storage";
import type { AudioRun } from "@/types/audio-run";

export const audioRunStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "audio_runs" });
export const audioRunPendingStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "audio_run_pending" });
export const audioRunLockName = (id: string) => `huabu:audio-run:${id}`;
export const ownedAudioRuns = new Set<string>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("huabu:audio-runs");
const writes = new Map<string, Promise<void>>();
let loading: Promise<void> | undefined;
let refreshQueued = false;

export const useAudioRunStore = create<{
    runs: AudioRun[];
    hydrated: boolean;
    loadError?: string;
}>()(() => ({ runs: [], hydrated: false }));

function publish(run: AudioRun) {
    useAudioRunStore.setState((state) => ({
        runs: [run, ...state.runs.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

function serialize(run: AudioRun): AudioRun {
    return {
        ...run,
        persistenceError: undefined,
        audio: run.audio ? { ...run.audio, url: run.audio.storageKey ? "" : run.audio.url } : undefined,
    };
}

async function hydrate(run: AudioRun): Promise<AudioRun> {
    return {
        ...run,
        audio: run.audio ? { ...run.audio, url: await resolveMediaUrl(run.audio.storageKey, run.audio.url) } : undefined,
    };
}

export async function createAudioRun(run: AudioRun) {
    try {
        await audioRunStorage.setItem(run.id, serialize(run));
    } catch {
        throw new Error("音频任务无法保存，未提交生成请求");
    }
    publish(run);
    channel?.postMessage(run.id);
}

export function updateAudioRun(id: string, change: (run: AudioRun) => AudioRun): Promise<void> {
    const operation = (writes.get(id) || Promise.resolve()).catch(() => undefined).then(async () => {
        const previous = useAudioRunStore.getState().runs.find((run) => run.id === id);
        if (!previous) throw new Error("音频任务记录不存在");
        const next = { ...change(previous), revision: previous.revision + 1, updatedAt: Date.now(), persistenceError: undefined };
        publish(next);
        try {
            await audioRunStorage.setItem(id, serialize(next));
            channel?.postMessage(id);
        } catch {
            publish({ ...next, persistenceError: "任务记录未能保存。请保留本页并重新保存，避免丢失任务或结果。" });
            throw new Error("音频任务保存失败，未自动重新提交");
        }
    });
    writes.set(id, operation);
    void operation.finally(() => {
        if (writes.get(id) === operation) writes.delete(id);
    }).catch(() => undefined);
    return operation;
}

export function resaveAudioRun(id: string) {
    return updateAudioRun(id, (run) => run);
}

export async function refreshAudioRun(id: string) {
    const local = useAudioRunStore.getState().runs.find((run) => run.id === id);
    if (local?.persistenceError) return local;
    const saved = await audioRunStorage.getItem<AudioRun>(id);
    if (!saved) return undefined;
    const run = await hydrate(saved);
    publish(run);
    return run;
}

export function loadAudioRuns(): Promise<void> {
    if (loading) {
        refreshQueued = true;
        return loading;
    }
    const startedAt = Date.now();
    loading = (async () => {
        try {
            const records: AudioRun[] = [];
            await audioRunStorage.iterate<AudioRun, void>((value) => {
                if (value.version !== 1 || value.kind !== "audio" || !value.request) throw new Error("存在无法识别的音频任务，已保留原数据");
                records.push(value);
            });
            const incoming = await Promise.all(records.map(hydrate));
            const saved = new Map(incoming.map((run) => [run.id, run]));
            const local = useAudioRunStore.getState().runs.filter((run) => ownedAudioRuns.has(run.id) || run.persistenceError
                || (saved.has(run.id) ? run.revision > saved.get(run.id)!.revision : run.createdAt >= startedAt));
            useAudioRunStore.setState({
                runs: [...local, ...incoming.filter((run) => !local.some((item) => item.id === run.id))].sort((a, b) => b.createdAt - a.createdAt),
                hydrated: true,
                loadError: undefined,
            });
        } catch (error) {
            useAudioRunStore.setState({ hydrated: true, loadError: error instanceof Error ? error.message : "音频任务读取失败" });
            throw error;
        }
    })().finally(async () => {
        loading = undefined;
        if (refreshQueued) {
            refreshQueued = false;
            await loadAudioRuns();
        }
    });
    return loading;
}

export async function withAudioRunLock<T>(id: string, action: (run: AudioRun | undefined) => Promise<T>) {
    if (!navigator.locks) throw new Error("当前浏览器不支持可靠任务锁，请使用支持 Web Locks 的浏览器");
    return navigator.locks.request(audioRunLockName(id), { ifAvailable: true }, async (lock) => {
        if (!lock) return undefined;
        ownedAudioRuns.add(id);
        try {
            return await action(await refreshAudioRun(id));
        } finally {
            ownedAudioRuns.delete(id);
        }
    });
}

export async function deleteAudioRun(id: string) {
    const deleted = await withAudioRunLock(id, async (run) => {
        if (run && (run.status === "queued" || run.status === "running" || run.persistenceError || run.pendingResult)) throw new Error("请先完成任务或保存结果");
        await audioRunStorage.removeItem(id);
        await audioRunPendingStorage.removeItem(run?.pendingResult?.blobKey || id);
        useAudioRunStore.setState((state) => ({ runs: state.runs.filter((item) => item.id !== id) }));
        channel?.postMessage(id);
        return true;
    });
    if (!deleted) throw new Error("任务正在其他页面执行");
}

if (channel) channel.onmessage = () => { void loadAudioRuns().catch(() => undefined); };
