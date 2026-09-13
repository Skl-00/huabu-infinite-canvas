import localforage from "localforage";
import { create } from "zustand";

import { resolveImageUrl } from "@/services/image-storage";
import type { TextRun } from "@/types/text-run";

export const textRunStorage = localforage.createInstance({ name: "infinite-canvas", storeName: "text_runs" });
export const textRunLockName = (id: string) => `huabu:text-run:${id}`;
export const ownedTextRuns = new Set<string>();
const writes = new Map<string, Promise<void>>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("huabu:text-runs");
let loading: Promise<void> | undefined;
let refreshQueued = false;

export const useTextRunStore = create<{
    runs: TextRun[];
    hydrated: boolean;
    loadError?: string;
}>()(() => ({ runs: [], hydrated: false }));

function publish(run: TextRun) {
    useTextRunStore.setState((state) => ({
        runs: [run, ...state.runs.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

function serialize(run: TextRun): TextRun {
    return {
        ...run,
        persistenceError: undefined,
        request: {
            ...run.request,
            references: run.request.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        },
    };
}

async function hydrate(run: TextRun): Promise<TextRun> {
    return {
        ...run,
        request: {
            ...run.request,
            references: await Promise.all(run.request.references.map(async (item) => ({
                ...item,
                dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
            }))),
        },
    };
}

export async function createTextRun(run: TextRun) {
    try {
        await textRunStorage.setItem(run.id, serialize(run));
    } catch {
        throw new Error("文本任务无法保存，未提交生成请求");
    }
    publish(run);
    channel?.postMessage(run.id);
}

export function updateTextRun(id: string, change: (run: TextRun) => TextRun): Promise<void> {
    const operation = (writes.get(id) || Promise.resolve()).catch(() => undefined).then(async () => {
        const previous = useTextRunStore.getState().runs.find((run) => run.id === id);
        if (!previous) throw new Error("文本任务记录不存在");
        const next = { ...change(previous), revision: previous.revision + 1, updatedAt: Date.now(), persistenceError: undefined };
        publish(next);
        try {
            await textRunStorage.setItem(id, serialize(next));
            channel?.postMessage(id);
        } catch {
            publish({ ...next, persistenceError: "任务记录未能保存。请保留本页并重新保存，避免丢失文本结果。" });
            throw new Error("文本任务保存失败，未自动重新提交");
        }
    });
    writes.set(id, operation);
    void operation.finally(() => {
        if (writes.get(id) === operation) writes.delete(id);
    }).catch(() => undefined);
    return operation;
}

export function resaveTextRun(id: string) {
    return updateTextRun(id, (run) => run);
}

export async function refreshTextRun(id: string) {
    const local = useTextRunStore.getState().runs.find((run) => run.id === id);
    if (local?.persistenceError) return local;
    const saved = await textRunStorage.getItem<TextRun>(id);
    if (!saved) return undefined;
    const run = await hydrate(saved);
    publish(run);
    return run;
}

export function loadTextRuns(): Promise<void> {
    if (loading) {
        refreshQueued = true;
        return loading;
    }
    const startedAt = Date.now();
    loading = (async () => {
        try {
            const records: TextRun[] = [];
            await textRunStorage.iterate<TextRun, void>((value) => {
                if (value.version !== 1 || value.kind !== "text" || !value.request) throw new Error("存在无法识别的文本任务，已保留原数据");
                records.push(value);
            });
            const incoming = await Promise.all(records.map(hydrate));
            const saved = new Map(incoming.map((run) => [run.id, run]));
            const local = useTextRunStore.getState().runs.filter((run) => ownedTextRuns.has(run.id) || run.persistenceError
                || (saved.has(run.id) ? run.revision > saved.get(run.id)!.revision : run.createdAt >= startedAt));
            useTextRunStore.setState({
                runs: [...local, ...incoming.filter((run) => !local.some((item) => item.id === run.id))].sort((a, b) => b.createdAt - a.createdAt),
                hydrated: true,
                loadError: undefined,
            });
        } catch (error) {
            useTextRunStore.setState({ hydrated: true, loadError: error instanceof Error ? error.message : "文本任务读取失败" });
            throw error;
        }
    })().finally(async () => {
        loading = undefined;
        if (refreshQueued) {
            refreshQueued = false;
            await loadTextRuns();
        }
    });
    return loading;
}

export async function initializeTextRuns() {
    await loadTextRuns();
    if (!navigator.locks) return;
    for (const run of useTextRunStore.getState().runs.filter((item) => item.status === "queued" || item.status === "running")) {
        await navigator.locks.request(textRunLockName(run.id), { ifAvailable: true }, async (lock) => {
            if (!lock) return;
            const latest = await textRunStorage.getItem<TextRun>(run.id);
            if (!latest || (latest.status !== "queued" && latest.status !== "running")) return;
            publish(await hydrate(latest));
            await updateTextRun(run.id, (current) => ({
                ...current,
                status: "interrupted",
                error: current.partialContent
                    ? "页面执行已中断，已保留已接收文本；服务端状态未知。重试会创建新请求。"
                    : "页面执行已中断，服务端状态未知。重试会创建新请求。",
            }));
        });
    }
}

if (channel) channel.onmessage = () => { void loadTextRuns().catch(() => undefined); };
