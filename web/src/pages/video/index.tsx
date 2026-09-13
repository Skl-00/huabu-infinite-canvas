import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, Link2, ListChecks, LoaderCircle, Plus, Save, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoModeLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { clampVideoSeconds } from "@/lib/media-size";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { AGNES_VIDEO_FLASH_LIMITS, type VideoGenerationTask } from "@/services/api/video";
import { localizeVideoRun, resaveVideoRun, resumeVideoRun, retryVideoRun, startVideoRun } from "@/services/video-runner";
import { deleteVideoRun, useVideoRunStore } from "@/stores/use-video-run-store";
import { isActiveVideoRun, type VideoRun } from "@/types/video-run";
import { addAssetDurably } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, modelOptionLabel, resolveModelRequestConfig, resolveModelScript, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    needsReview?: boolean;
    taskFailed?: boolean;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const submittingRef = useRef(false);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const runs = useVideoRunStore((state) => state.runs);
    const loadError = useVideoRunStore((state) => state.loadError);
    const [searchParams, setSearchParams] = useSearchParams();
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [legacyLogs, setLegacyLogs] = useState<GenerationLog[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [referenceUrlOpen, setReferenceUrlOpen] = useState(false);
    const [referenceUrl, setReferenceUrl] = useState("");
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selection, setSelection] = useState<string | null>();
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const logs = [...runs.map(projectVideoRun), ...legacyLogs.filter((log) => !runs.some((run) => run.id === log.id))].sort((a, b) => b.createdAt - a.createdAt);
    const selectedId = searchParams.get("run") || (selection === undefined ? runs[0]?.id : selection);
    const currentLog = logs.find((log) => log.id === selectedId) || null;
    const currentRun = runs.find((run) => run.id === selectedId);
    const previewLog = currentLog;
    const running = submitting || runs.some(isActiveVideoRun);
    const results: GenerationResult[] = currentLog
        ? [{ id: currentLog.id, status: currentLog.status, video: currentLog.video, error: currentLog.error }]
        : submitting ? [{ id: "submitting", status: "pending" }] : [];

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const requestConfig = resolveModelRequestConfig(effectiveConfig, model);
    const isAgnesFlash = requestConfig.apiFormat === "agnes" && !resolveModelScript(effectiveConfig, model);
    const referenceLimit = isAgnesFlash ? AGNES_VIDEO_FLASH_LIMITS.maxImages : 7;
    const referenceOverflow = references.length > referenceLimit;
    const canGenerate = Boolean(prompt.trim()) && !referenceOverflow;

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void readStoredLogs().then(setLegacyLogs);
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/"));
        if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, referenceLimit - references.length));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, 7));
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, referenceLimit - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, 7));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        if (submittingRef.current || running) return;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        submittingRef.current = true;
        setElapsedMs(0);
        setSubmitting(true);
        setStartedAt(performance.now());
        try {
            const run = await startVideoRun({
                prompt: snapshot.text, config: snapshot.config, references: snapshot.references, agentTaskId,
                onCreated: (id) => { setSelection(id); setSearchParams({ run: id }); },
            });
            if (run.persistenceError || run.error) message.error(run.persistenceError || run.error);
            else if (run.status === "succeeded") message.success(t("videoWorkbench.generated"));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "视频任务创建失败";
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            message.error(errorMessage);
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        if (isAgnesFlash && references.length > AGNES_VIDEO_FLASH_LIMITS.maxImages) {
            message.error(t("videoWorkbench.agnesReferenceLimit"));
            return null;
        }
        return { text, config: structuredClone(buildVideoConfig(effectiveConfig, model)), references: structuredClone(references) };
    };

    const retryResult = () => {
        if (!currentRun) {
            message.warning("旧任务仅保留历史。请先到原服务核对执行状态");
            return;
        }
        if (currentRun.task && currentRun.status === "interrupted") {
            void resumeVideoRun(currentRun.id).catch((error: Error) => message.error(error.message));
            return;
        }
        if (currentRun.status !== "failed") return;
        Modal.confirm({
            title: "使用原参数重试视频？",
            content: "将使用原任务的提示词、参考素材、参数和渠道创建新任务，保留原失败记录。",
            okText: "确认重试",
            onOk: async () => {
                const run = await retryVideoRun(currentRun.id);
                setSelection(run.id);
                setSearchParams({ run: run.id });
            },
        });
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveVideoLocally = async (video: GeneratedVideo) => {
        try {
            if (currentRun) {
                await localizeVideoRun(currentRun.id);
                message.success("视频已保存到本地");
                return;
            }
            const stored = await uploadMediaFile(video.url, "video");
            const next = { ...video, ...stored, width: stored.width || video.width, height: stored.height || video.height, durationMs: stored.durationMs || 0 };
            if (currentLog) {
                const log = { ...currentLog, video: next };
                await logStore.setItem(log.id, serializeLog(log));
                setLegacyLogs(await readStoredLogs());
            }
            message.success("视频已保存到本地");
        } catch {
            message.error("视频保存失败。若被跨域阻止，请在配置中启用本地代理后重试");
        }
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        try {
        await addAssetDurably({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", generationRunId: currentRun?.id, prompt: currentLog?.prompt || prompt },
        });
        message.success(t("common.addedToAssets"));
        } catch {
            message.error("素材保存失败，请重试");
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, 7));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        if (running || submittingRef.current) return;
        setSelection(null);
        setSearchParams({});
        setPrompt("");
        setReferences([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
    };

    const deleteSelectedLogs = () => {
        if (running) return;
        // Assets and canvas nodes may share these files; deleting history must not delete their media.
        void Promise.all(selectedLogIds.map((id) => runs.some((run) => run.id === id) ? deleteVideoRun(id) : logStore.removeItem(id)))
            .then(() => readStoredLogs()).then(setLegacyLogs).catch((error: Error) => message.error(error.message));
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setSelection(null);
            setSearchParams({});
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setSelection(log.id);
        setSearchParams({ run: log.id });
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
    };

    return (
        <div className="studio-page flex h-full flex-col overflow-hidden text-stone-900 dark:text-stone-100">
            {loadError && <div role="alert" className="px-4 py-2 text-sm text-red-600">{loadError}</div>}
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
                </aside>

                <section className="grid min-w-0 gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex min-w-0 flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("videoWorkbench.title")}</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button aria-label={t("workbench.logs")} title={t("workbench.logs")} icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    <span className="hidden sm:inline">{t("workbench.logs")}</span>
                                </Button>
                                <Button aria-label={t("workbench.settings")} title={t("workbench.settings")} icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    <span className="hidden sm:inline">{t("workbench.settings")}</span>
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("videoWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("videoWorkbench.references")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<Link2 className="size-3.5" />} onClick={() => setReferenceUrlOpen(true)} aria-label="添加参考图链接" title="添加参考图链接" />
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                    <div
                                    className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                    >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={t("videoWorkbench.removeImage")}>
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{referenceDragTarget ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noImages")}</div> : null}
                                    </div>
                                    {referenceOverflow && isAgnesFlash ? <div role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{t("videoWorkbench.agnesReferenceLimit")}</div> : null}
                                </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="min-w-0 flex-1 truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {normalizeResolution(effectiveConfig.vquality)}p · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s · {videoModeLabel(effectiveConfig.videoMode)}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} agnesFlash={isAgnesFlash} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            <Link to={`/tasks?kind=video${currentRun ? `&run=${currentRun.id}` : ""}`}><Button type="text" icon={<ListChecks className="size-4" />}>视频任务</Button></Link>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {currentRun?.persistenceError && <div role="alert" className="mb-4 flex flex-wrap gap-2 text-sm text-red-600">
                            {currentRun.persistenceError}<Button size="small" icon={<Save className="size-4" />} onClick={() => void resaveVideoRun(currentRun.id).catch((error: Error) => message.error(error.message))}>重新保存</Button>
                        </div>}
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) => (result.status === "success" && result.video ? <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} onSaveLocal={saveVideoLocally} /> : result.status === "failed" ? <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} resume={Boolean(currentRun?.task) && currentRun?.status === "interrupted"} canRetry={Boolean(currentRun && !currentRun.persistenceError && (currentRun.status === "failed" || (currentRun.status === "interrupted" && currentRun.task)))} onRetry={retryResult} /> : <PendingVideoCard key={result.id} />))}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" height="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} agnesFlash={isAgnesFlash} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <Modal title="添加参考图链接" open={referenceUrlOpen} onCancel={() => setReferenceUrlOpen(false)} okText="添加" onOk={() => {
                try {
                    const url = new URL(referenceUrl.trim());
                    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
                    setReferences((items) => [...items, { id: nanoid(), name: url.pathname.split("/").pop() || "参考图", type: "image/png", dataUrl: url.toString() }]);
                    setReferenceUrl("");
                    setReferenceUrlOpen(false);
                } catch { message.error("请输入有效的 HTTP 或 HTTPS 图片链接"); }
            }}>
                <Input aria-label="参考图链接" value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="https://..." />
            </Modal>
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog, agnesFlash }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void; agnesFlash: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" agnesFlash={agnesFlash} />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset, onSaveLocal }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void; onSaveLocal: (video: GeneratedVideo) => Promise<void> }) {
    const { t } = useTranslation();
    const [saving, setSaving] = useState(false);
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width && video.height ? `${video.width}x${video.height}` : "尺寸未知"}
                    </span>
                    <span>{video.storageKey ? formatBytes(video.bytes) : "远程结果，尚未保存到本地"}</span>
                    <span>{video.durationMs ? formatDuration(video.durationMs) : video.storageKey ? "时长未知" : "时长待下载"}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    {!video.storageKey ? <Button size="small" loading={saving} icon={<Download className="size-3.5" />} onClick={async () => {
                        setSaving(true);
                        try { await onSaveLocal(video); } finally { setSaving(false); }
                    }}>保存到本地</Button> : null}
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry, resume, canRetry }: { error: string; onRetry: () => void; resume: boolean; canRetry: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{resume ? "查询暂停" : t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger disabled={!canRetry} onClick={onRetry}>
                    {resume ? "继续查询原任务" : t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard key={log.id} log={log} selected={selectedLogIds.includes(log.id)} active={activeLogId === log.id} onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} onClick={() => onPreviewLog(log)} />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`} onClick={onClick}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                        {log.needsReview ? "待核对" : t(`workbench.${log.status === "success" ? "success" : log.status === "pending" ? "generating" : "failed"}`)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status === "pending" ? "failed" : log.status || "success",
        task: log.task,
        video,
        needsReview: log.needsReview || log.status === "pending",
        taskFailed: log.taskFailed,
        error: log.error || (log.status === "pending" ? "旧任务待核对，请先在原服务检查。不会自动重新生成" : undefined),
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
    };
}

function projectVideoRun(run: VideoRun): GenerationLog {
    return {
        id: run.id, createdAt: run.createdAt, title: run.request.prompt.slice(0, 12),
        prompt: run.request.prompt, time: new Date(run.createdAt).toLocaleString(), model: run.request.model,
        config: { ...run.request.settings, model: run.request.model, videoModel: run.request.model },
        references: run.request.references, durationMs: run.updatedAt - run.createdAt,
        size: run.request.settings.size, resolution: run.request.settings.vquality, seconds: run.request.settings.videoSeconds,
        status: run.video ? "success" : isActiveVideoRun(run) && !run.persistenceError ? "pending" : "failed",
        task: run.task, video: run.video, error: run.persistenceError || run.error,
        needsReview: run.status === "interrupted", taskFailed: run.status === "failed",
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}
