import localforage from "localforage";
import { create } from "zustand";

import { resolveImageUrl } from "@/services/image-storage";
import { completedImageRunStatus, isActiveImageRun, type ImageRun, type ImageRunSlot } from "@/types/image-run";

export const imageRunStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "image_runs" });
export const imageRunLockName = (id: string) => `huabu:image-run:${id}`;
export const ownedImageRuns = new Set<string>();
const writes = new Map<string, Promise<void>>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("huabu:image-runs");
let initialization: Promise<void> | undefined;
let loading: Promise<void> | undefined;
let refreshQueued = false;

export const useImageRunStore = create<{
    runs: ImageRun[];
    hydrated: boolean;
    loadError?: string;
}>(() => ({ runs: [], hydrated: false }));

function publish(run: ImageRun) {
    useImageRunStore.setState((state) => ({
        runs: [run, ...state.runs.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

function serialize(run: ImageRun): ImageRun {
    return {
        ...run,
        persistenceError: undefined,
        request: {
            ...run.request,
            references: run.request.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        },
        slots: run.slots.map((slot) => ({
            ...slot,
            image: slot.image ? { ...slot.image, dataUrl: slot.image.storageKey ? "" : slot.image.dataUrl } : undefined,
        })),
    };
}

async function hydrate(run: ImageRun): Promise<ImageRun> {
    return {
        ...run,
        request: {
            ...run.request,
            references: await Promise.all(run.request.references.map(async (item) => ({
                ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
            }))),
        },
        slots: await Promise.all(run.slots.map(async (slot) => ({
            ...slot,
            image: slot.image ? { ...slot.image, dataUrl: await resolveImageUrl(slot.image.storageKey, slot.image.dataUrl) } : undefined,
        }))),
    };
}

export async function createImageRun(run: ImageRun) {
    await imageRunStorage.setItem(run.id, serialize(run));
    publish(run);
    channel?.postMessage(run.id);
}

// Slot completions race; derive each write from the latest state inside this queue.
export function updateImageRun(id: string, change: (run: ImageRun) => ImageRun): Promise<void> {
    const operation = (writes.get(id) || Promise.resolve()).catch(() => undefined).then(async () => {
        const previous = useImageRunStore.getState().runs.find((run) => run.id === id);
        if (!previous) throw new Error("任务记录不存在");
        const next = { ...change(previous), revision: (previous.revision || 0) + 1, updatedAt: Date.now(), persistenceError: undefined };
        publish(next);
        try {
            await imageRunStorage.setItem(id, serialize(next));
            channel?.postMessage(id);
        } catch {
            publish({ ...next, persistenceError: "任务记录未能保存。请保留本页并重新保存，避免丢失结果。" });
            throw new Error("任务记录未能保存，未自动重新提交生成请求");
        }
    });
    writes.set(id, operation);
    void operation.finally(() => {
        if (writes.get(id) === operation) writes.delete(id);
    }).catch(() => undefined);
    return operation;
}

export function resaveImageRun(id: string) {
    return updateImageRun(id, (run) => run);
}

export function loadImageRuns(): Promise<void> {
    if (loading) {
        refreshQueued = true;
        return loading;
    }
    const startedAt = Date.now();
    loading = (async () => {
        try {
            const records: ImageRun[] = [];
            await imageRunStorage.iterate<ImageRun, void>((value) => {
                if (value.version !== 1 || value.kind !== "image" || !Array.isArray(value.slots) || !value.request) {
                    throw new Error("存在无法识别的任务记录，已保留原数据");
                }
                records.push(value);
            });
            const runs = await Promise.all(records.map(hydrate));
            const incoming = new Map(runs.map((run) => [run.id, run]));
            const local = useImageRunStore.getState().runs.filter((run) => {
                const saved = incoming.get(run.id);
                return ownedImageRuns.has(run.id) || run.persistenceError
                    || (saved ? (run.revision || 0) > (saved.revision || 0) : run.createdAt >= startedAt);
            });
            useImageRunStore.setState({
                runs: [...local, ...runs.filter((run) => !local.some((item) => item.id === run.id))].sort((a, b) => b.createdAt - a.createdAt),
                hydrated: true,
                loadError: undefined,
            });
        } catch (error) {
            useImageRunStore.setState({ hydrated: true, loadError: error instanceof Error ? error.message : "任务记录读取失败" });
            throw error;
        }
    })().finally(async () => {
        loading = undefined;
        if (refreshQueued) {
            refreshQueued = false;
            await loadImageRuns();
        }
    });
    return loading;
}

export function initializeImageRuns(): Promise<void> {
    if (initialization) return initialization;
    initialization = (async () => {
        await loadImageRuns();
        if (!navigator.locks) return;
        for (const run of useImageRunStore.getState().runs.filter(isActiveImageRun)) {
            await navigator.locks.request(imageRunLockName(run.id), { ifAvailable: true }, async (lock) => {
                if (!lock) return;
                const latest = await imageRunStorage.getItem<ImageRun>(run.id);
                if (!latest || !isActiveImageRun(latest)) return;
                publish(await hydrate(latest));
                await updateImageRun(run.id, (current) => {
                    const slots: ImageRunSlot[] = current.slots.map((slot) => slot.status === "pending"
                        ? { ...slot, status: "interrupted", error: "页面执行已中断，服务端状态未知。重试会创建新请求，请先核对服务端记录。" }
                        : slot);
                    return { ...current, slots, status: completedImageRunStatus(slots) };
                });
            });
        }
    })().finally(() => {
        initialization = undefined;
    });
    return initialization;
}

if (channel) channel.onmessage = () => { void loadImageRuns().catch(() => undefined); };
