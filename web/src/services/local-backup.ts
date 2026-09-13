import localforage from "localforage";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { createZip, readZip } from "@/lib/zip";
import { useCanvasStore, type CanvasDeletedProject, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { imageRunStorage, loadImageRuns, useImageRunStore } from "@/stores/use-image-run-store";
import { videoRunStorage, loadVideoRuns, useVideoRunStore } from "@/stores/use-video-run-store";
import { audioRunStorage, loadAudioRuns, useAudioRunStore } from "@/stores/use-audio-run-store";
import { textRunStorage, loadTextRuns, useTextRunStore } from "@/stores/use-text-run-store";
import { deleteStoredImages, getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { hydrateAssistantImages, hydrateCanvasImages } from "@/lib/canvas/canvas-generation-helpers";
import type { ImageRun } from "@/types/image-run";
import type { VideoRun } from "@/types/video-run";
import type { AudioRun } from "@/types/audio-run";
import type { TextRun } from "@/types/text-run";

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;
const BACKUP_APP = "infinite-canvas";
const BACKUP_VERSION = 1;

type StoredLog = Record<string, unknown> & { id?: string };
type GenerationRun = ImageRun | VideoRun | AudioRun | TextRun;
type BackupFile = { storageKey: string; path: string; mimeType: string; bytes: number };
type BackupData = {
    app: typeof BACKUP_APP;
    version: typeof BACKUP_VERSION;
    exportedAt: string;
    canvas: { projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[] };
    assets: Asset[];
    runs: GenerationRun[];
    legacyLogs: { image: StoredLog[]; video: StoredLog[] };
    files: BackupFile[];
};

export async function exportLocalBackup(fileName = "huabu-local-backup") {
    const canvas = useCanvasStore.getState();
    const assets = useAssetStore.getState().assets;
    const runs: GenerationRun[] = [
        ...useImageRunStore.getState().runs,
        ...useVideoRunStore.getState().runs,
        ...useAudioRunStore.getState().runs,
        ...useTextRunStore.getState().runs,
    ].map((run) => sanitizeStoredUrls(structuredClone(run)) as GenerationRun);
    const legacyLogs = {
        image: (await readStore(imageLogStore)).map((item) => sanitizeStoredUrls(item) as StoredLog),
        video: (await readStore(videoLogStore)).map((item) => sanitizeStoredUrls(item) as StoredLog),
    };
    const data = {
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        canvas: {
            projects: sanitizeStoredUrls(structuredClone(canvas.projects)) as CanvasProject[],
            deletedProjects: structuredClone(canvas.deletedProjects),
        },
        assets: sanitizeStoredUrls(structuredClone(assets)) as Asset[],
        runs,
        legacyLogs,
        files: [] as BackupFile[],
    } satisfies BackupData;

    const keys = collectStorageKeys(data);
    const zipFiles: { name: string; data: BlobPart }[] = [];
    for (const storageKey of keys) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob) continue;
        const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
        data.files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
        zipFiles.push({ name: path, data: blob });
    }
    const zip = await createZip([{ name: "backup.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
    return { projects: data.canvas.projects.length, assets: data.assets.length, runs: data.runs.length, files: data.files.length };
}

export async function importLocalBackup(file: File) {
    const zip = await readZip(file);
    const manifest = zip.get("backup.json");
    if (!manifest) throw new Error("备份包缺少 backup.json");
    const data = JSON.parse(await manifest.text()) as BackupData;
    validateBackup(data, zip);

    const keyMap = new Map(data.files.map((item) => [item.storageKey, newStorageKey(item.storageKey)]));
    const rewrite = (value: unknown): unknown => {
        if (typeof value === "string") return keyMap.get(value) || value;
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
        return value;
    };
    const rewrittenProjects = rewrite(data.canvas.projects) as CanvasProject[];
    const assets = rewrite(data.assets) as Asset[];
    const runs = rewrite(data.runs) as GenerationRun[];
    const legacyLogs = rewrite(data.legacyLogs) as BackupData["legacyLogs"];
    const previous = {
        projects: useCanvasStore.getState().projects,
        deletedProjects: useCanvasStore.getState().deletedProjects,
        assets: useAssetStore.getState().assets,
        imageRuns: useImageRunStore.getState().runs,
        videoRuns: useVideoRunStore.getState().runs,
        audioRuns: useAudioRunStore.getState().runs,
        textRuns: useTextRunStore.getState().runs,
        imageLogs: await readStore(imageLogStore),
        videoLogs: await readStore(videoLogStore),
    };
    const writtenKeys: string[] = [];
    try {
        for (const item of data.files) {
            const blob = zip.get(item.path)!;
            const typed = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            const nextKey = keyMap.get(item.storageKey)!;
            await (nextKey.startsWith("image:") ? setImageBlob(nextKey, typed) : setMediaBlob(nextKey, typed));
            writtenKeys.push(nextKey);
        }

        const projects = await Promise.all(rewrittenProjects.map(async (project) => ({
            ...project,
            nodes: await hydrateCanvasImages(project.nodes),
            chatSessions: await hydrateAssistantImages(project.chatSessions || []),
        })));
        const hydratedAssets = await hydrateAssets(assets);
        useCanvasStore.getState().replaceProjects(projects, data.canvas.deletedProjects);
        useAssetStore.getState().replaceAssets(hydratedAssets);
        await replaceRunStore(imageRunStorage, runs.filter((run): run is ImageRun => run.kind === "image"));
        await replaceRunStore(videoRunStorage, runs.filter((run): run is VideoRun => run.kind === "video"));
        await replaceRunStore(audioRunStorage, runs.filter((run): run is AudioRun => run.kind === "audio"));
        await replaceRunStore(textRunStorage, runs.filter((run): run is TextRun => run.kind === "text"));
        await replaceStore(imageLogStore, legacyLogs.image);
        await replaceStore(videoLogStore, legacyLogs.video);
        await Promise.all([loadImageRuns(), loadVideoRuns(), loadAudioRuns(), loadTextRuns()]);
        return { projects: projects.length, assets: assets.length, runs: runs.length, files: data.files.length };
    } catch (error) {
        await Promise.all([
            deleteStoredImages(writtenKeys.filter((key) => key.startsWith("image:"))),
            deleteStoredMedia(writtenKeys.filter((key) => !key.startsWith("image:"))),
        ]);
        useCanvasStore.getState().replaceProjects(previous.projects, previous.deletedProjects);
        useAssetStore.getState().replaceAssets(previous.assets);
        useImageRunStore.setState({ runs: previous.imageRuns });
        useVideoRunStore.setState({ runs: previous.videoRuns });
        useAudioRunStore.setState({ runs: previous.audioRuns });
        useTextRunStore.setState({ runs: previous.textRuns });
        await Promise.all([
            replaceRunStore(imageRunStorage, previous.imageRuns),
            replaceRunStore(videoRunStorage, previous.videoRuns),
            replaceRunStore(audioRunStorage, previous.audioRuns),
            replaceRunStore(textRunStorage, previous.textRuns),
            replaceStore(imageLogStore, previous.imageLogs),
            replaceStore(videoLogStore, previous.videoLogs),
        ]);
        throw error;
    }
}

function validateBackup(data: BackupData, zip: Map<string, Blob>) {
    if (data.app !== BACKUP_APP || data.version !== BACKUP_VERSION || !data.canvas || !Array.isArray(data.canvas.projects)
        || !Array.isArray(data.canvas.deletedProjects) || !Array.isArray(data.assets) || !Array.isArray(data.runs)
        || !data.legacyLogs || !Array.isArray(data.legacyLogs.image) || !Array.isArray(data.legacyLogs.video) || !Array.isArray(data.files))
        throw new Error("备份包格式不受支持");
    const paths = new Set<string>();
    const keys = new Set<string>();
    for (const item of data.files) {
        if (!item || !storageKeyPattern.test(item.storageKey) || keys.has(item.storageKey) || !item.path || item.path.includes("..") || paths.has(item.path) || !zip.has(item.path)) throw new Error("备份包媒体文件不完整");
        keys.add(item.storageKey);
        paths.add(item.path);
    }
}

function sanitizeStoredUrls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeStoredUrls);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const storageBacked = typeof record.storageKey === "string" && storageKeyPattern.test(record.storageKey);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => {
        if (storageBacked && (key === "dataUrl" || key === "url" || key === "coverUrl")) return [key, ""];
        return [key, sanitizeStoredUrls(child)];
    }));
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return keys;
    }
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return keys;
}

function newStorageKey(value: string) {
    return `${value.split(":")[0]}:${nanoid()}`;
}

async function hydrateAssets(assets: Asset[]) {
    return Promise.all(assets.map(async (asset) => {
        if (asset.kind === "image" && asset.data.storageKey) {
            const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
            return { ...asset, coverUrl: dataUrl, data: { ...asset.data, dataUrl } };
        }
        if (asset.kind === "video" && asset.data.storageKey) {
            const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
            return { ...asset, coverUrl: url, data: { ...asset.data, url } };
        }
        return asset;
    }));
}

async function replaceRunStore<T extends GenerationRun>(store: LocalForage, runs: T[]) {
    await store.clear();
    await Promise.all(runs.map((run) => store.setItem(run.id, run)));
}

async function readStore(store: LocalForage) {
    const records: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object") records.push(value);
    });
    return records;
}

async function replaceStore(store: LocalForage, records: StoredLog[]) {
    await store.clear();
    await Promise.all(records.map((record) => record.id ? store.setItem(record.id, record) : undefined));
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
