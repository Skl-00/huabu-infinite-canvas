import { App, Button, Empty, Image, Input, Segmented, Tag, Tooltip } from "antd";
import { ArrowLeft, ArrowUpRight, AudioLines, Download, FolderPlus, ImageIcon, LoaderCircle, RefreshCw, RotateCcw, Save, Search, Video, FileText } from "lucide-react";
import { saveAs } from "file-saver";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { formatBytes, formatDuration } from "@/lib/image-utils";
import { getGenerationRunSource } from "@/lib/generation-run-source";
import { retryImageRun } from "@/services/image-runner";
import { addAssetDurably, useAssetStore } from "@/stores/use-asset-store";
import { initializeImageRuns, resaveImageRun, useImageRunStore } from "@/stores/use-image-run-store";
import { imageRunStatusLabels, isActiveImageRun, type ImageRunStatus } from "@/types/image-run";
import { VideoTasks } from "./video-tasks";
import { AudioTasks } from "./audio-tasks";
import { TextTasks } from "./text-tasks";

const statusColors: Record<ImageRunStatus, string> = {
    queued: "default", running: "processing", succeeded: "success", partial: "warning", failed: "error", interrupted: "warning",
};
const dateLabel = (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export default function TasksPage() {
    const [params, setParams] = useSearchParams();
    const kind = params.get("kind");
    const video = kind === "video";
    const audio = kind === "audio";
    const text = kind === "text";
    return <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-[1440px] shrink-0 px-4 pt-3 sm:px-6">
            <Segmented aria-label="任务类型" value={text ? "text" : audio ? "audio" : video ? "video" : "image"} onChange={(nextKind) => setParams(nextKind === "video" || nextKind === "audio" || nextKind === "text" ? { kind: String(nextKind) } : {})} options={[
                { label: "图片", value: "image", icon: <ImageIcon className="inline size-4" /> },
                { label: "视频", value: "video", icon: <Video className="inline size-4" /> },
                { label: "音频", value: "audio", icon: <AudioLines className="inline size-4" /> },
                { label: "文本", value: "text", icon: <FileText className="inline size-4" /> },
            ]} />
        </div>
        <div className="min-h-0 flex-1">{text ? <TextTasks /> : audio ? <AudioTasks /> : video ? <VideoTasks /> : <ImageTasks />}</div>
    </div>;
}

function ImageTasks() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const runs = useImageRunStore((state) => state.runs);
    const hydrated = useImageRunStore((state) => state.hydrated);
    const loadError = useImageRunStore((state) => state.loadError);
    const assets = useAssetStore((state) => state.assets);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const [savingAssetIds, setSavingAssetIds] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [busy, setBusy] = useState(false);
    const selectedId = searchParams.get("run");
    const filtered = runs.filter((run) => {
        const matches = `${run.request.prompt} ${run.request.modelLabel} ${run.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
        return matches && (filter === "all" || (filter === "active" ? isActiveImageRun(run) : filter === "done" ? run.status === "succeeded" : ["failed", "partial", "interrupted"].includes(run.status) || Boolean(run.persistenceError)));
    });
    const selected = selectedId ? runs.find((run) => run.id === selectedId) : filtered[0];
    const activeCount = runs.filter(isActiveImageRun).length;
    const retryable = selected && !isActiveImageRun(selected) && selected.slots.some((slot) => slot.status !== "success");

    const refresh = () => {
        setBusy(true);
        void initializeImageRuns().catch((error: Error) => message.error(error.message)).finally(() => setBusy(false));
    };
    const retry = () => {
        if (!selected) return;
        const run = selected;
        modal.confirm({
            title: "使用原参数重试未完成项？",
            content: run.status === "interrupted"
                ? "原任务的服务端状态未知，请先核对服务端记录。重试会提交新请求，可能再次计费；已成功的图片不会重发。"
                : "将创建新的任务记录，原记录保留。新请求可能产生新的计费，已成功的图片不会重发。",
            okText: "确认重试",
            cancelText: "取消",
            onOk: () => {
                setBusy(true);
                void retryImageRun(run.id).then((next) => {
                    setSearchParams({ run: next.id });
                    if (next.persistenceError) message.error(next.persistenceError);
                }).catch((error: Error) => message.error(error.message)).finally(() => setBusy(false));
            },
        });
    };

    return (
        <main className="mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-hidden px-4 sm:px-6" data-testid="image-tasks">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border py-4">
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="text-xl font-semibold">图片任务</h1>
                    <span className="hidden text-sm text-muted-foreground sm:inline">{runs.length} 次任务 · {activeCount} 次进行中</span>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title="刷新任务记录"><Button type="text" aria-label="刷新任务记录" icon={<RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />} disabled={busy} onClick={refresh} /></Tooltip>
                    <Link to="/image"><Button icon={<ImageIcon className="size-4" />}>图片工作台</Button></Link>
                </div>
            </header>
            {loadError && <div role="alert" className="border-b border-border py-3 text-sm text-red-600">{loadError}</div>}
            <div className={`${selectedId ? "hidden lg:flex" : "flex"} shrink-0 flex-wrap items-center gap-3 py-4`}>
                <Segmented value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: "全部", value: "all" }, { label: "进行中", value: "active" }, { label: "已完成", value: "done" }, { label: "待处理", value: "attention" }]} />
                <Input aria-label="搜索任务" value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-4 text-muted-foreground" />} placeholder="搜索提示词、模型或任务 ID" className="!w-full sm:!w-72" />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
                <section aria-label="任务列表" className={`min-w-0 lg:overflow-y-auto lg:border-r lg:border-border lg:pr-4 ${selectedId ? "hidden lg:block" : ""}`}>
                    {!hydrated ? <LoaderCircle className="m-8 size-5 animate-spin" /> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query || filter !== "all" ? "没有匹配的任务" : "暂无图片任务"} /> : filtered.map((run) => {
                        const cover = run.slots.find((slot) => slot.image)?.image;
                        const success = run.slots.filter((slot) => slot.status === "success").length;
                        const source = getGenerationRunSource(run.request.canvas);
                        return (
                            <button type="button" key={run.id} data-testid="task-row" data-run-id={run.id} aria-current={selected?.id === run.id} onClick={() => setSearchParams({ run: run.id })} className={`flex w-full min-w-0 gap-3 border-b border-border px-2 py-4 text-left transition hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === run.id ? "bg-black/5 dark:bg-white/5" : ""}`}>
                                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border border-border">
                                    {cover?.dataUrl ? <img src={cover.dataUrl} className="size-full object-cover" alt="" /> : isActiveImageRun(run) ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : <ImageIcon className="size-5 text-muted-foreground" />}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <p className="truncate text-sm font-medium">{run.request.prompt}</p>
                                    <div className="truncate text-xs text-muted-foreground" data-testid="task-origin">{source.label}{source.detail ? ` · ${source.detail}` : ""}</div>
                                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                        <Tag color={statusColors[run.status]} className="!m-0">{imageRunStatusLabels[run.status]}</Tag>
                                        <span>{success}/{run.slots.length} 张</span>
                                        {run.persistenceError && <span className="text-red-600">未保存</span>}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">{dateLabel(run.createdAt)}</div>
                                </div>
                            </button>
                        );
                    })}
                </section>
                <section aria-label="任务详情" className={`min-w-0 pb-8 pt-4 lg:overflow-y-auto lg:pl-6 lg:pt-0 ${!selectedId ? "hidden lg:block" : ""}`}>
                    {selected ? (
                        <>
                            <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <Tooltip title="返回任务列表"><Button type="text" className="lg:!hidden" aria-label="返回任务列表" icon={<ArrowLeft className="size-4" />} onClick={() => setSearchParams({})} /></Tooltip>
                                    <Tag color={statusColors[selected.status]}>{imageRunStatusLabels[selected.status]}</Tag>
                                    {selected.retryOf && <Link to={`/tasks?run=${selected.retryOf}`} className="text-sm text-muted-foreground">查看原任务</Link>}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Tooltip title="查看结果"><Link to={`/image?run=${selected.id}`}><Button type="text" aria-label="查看结果" icon={<ArrowUpRight className="size-4" />}><span className="hidden sm:inline">查看结果</span></Button></Link></Tooltip>
                                    {retryable && <Button icon={<RotateCcw className="size-4" />} disabled={busy || activeCount > 0 || Boolean(selected.persistenceError)} onClick={retry}>重试未完成项</Button>}
                                </div>
                            </div>
                            {selected.persistenceError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 border-l-2 border-red-500 pl-3 text-sm text-red-600">
                                <span>{selected.persistenceError}</span>
                                <Button size="small" icon={<Save className="size-4" />} onClick={() => void resaveImageRun(selected.id).catch((error: Error) => message.error(error.message))}>重新保存</Button>
                            </div>}
                            {selected.status === "interrupted" && <p className="mb-4 border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">本地执行已中断，服务端状态未知，未自动重新提交。</p>}
                            <div className="min-w-0 border-b border-border pb-5">
                                <h2 className="mb-3 text-base font-semibold">请求快照</h2>
                                <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]" data-testid="task-prompt">{selected.request.prompt}</p>
                                <dl className="mt-4 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                                    <dt className="text-muted-foreground">来源</dt><dd data-testid="task-origin-detail" className="break-all">{getGenerationRunSource(selected.request.canvas).description}</dd>
                                    <dt className="text-muted-foreground">模型</dt><dd className="break-all">{selected.request.modelLabel}</dd>
                                    <dt className="text-muted-foreground">参数</dt><dd className="break-all">{selected.request.settings.size || "auto"} · {selected.request.settings.quality || "默认"} · {selected.slots.length} 张</dd>
                                    <dt className="text-muted-foreground">提交时间</dt><dd>{dateLabel(selected.createdAt)}</dd>
                                    <dt className="text-muted-foreground">任务 ID</dt><dd className="break-all font-mono">{selected.id}</dd>
                                </dl>
                                {selected.request.references.length > 0 && <div className="mt-4 flex flex-wrap gap-2">
                                    {selected.request.references.map((reference) => <Image key={reference.id} src={reference.dataUrl} alt={reference.name} width={56} height={56} className="object-contain" />)}
                                </div>}
                            </div>
                            <div className="mt-5 grid items-start gap-4 sm:grid-cols-2" aria-label="生成结果">
                                {selected.slots.map((slot, index) => {
                                    const image = slot.image;
                                    const asset = assets.find((item) => item.metadata?.generationRunId === selected.id && item.metadata?.generationSlotId === slot.id);
                                    return (
                                        <article key={slot.id} className="min-w-0 overflow-hidden rounded-lg border border-border" data-testid="task-result">
                                            {image ? <div className="flex aspect-square items-center justify-center overflow-hidden bg-black/5 dark:bg-white/5">
                                                {image.dataUrl ? <Image src={image.dataUrl} alt={`生成图片 ${index + 1}`} styles={{ root: { display: "flex", height: "100%", width: "100%", alignItems: "center", justifyContent: "center" }, image: { height: "100%", width: "100%", objectFit: "contain" } }} /> : <span className="text-sm text-red-600">本地图片已丢失</span>}
                                            </div> : <div className="flex min-h-36 flex-col justify-center gap-3 p-4">
                                                <span className="flex items-center gap-2 text-sm font-medium">{slot.status === "pending" && <LoaderCircle className="size-4 animate-spin" />}{slot.status === "pending" ? "生成中" : slot.status === "interrupted" ? "中断待核对" : "生成失败"}</span>
                                                {slot.error && <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{slot.error}</p>}
                                            </div>}
                                            {image && !image.storageKey && <p className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400">远程结果，尚未本地保存</p>}
                                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                                                <span className="text-xs text-muted-foreground">#{index + 1}{image && ` · ${image.width}×${image.height} · ${formatBytes(image.bytes)} · ${formatDuration(image.durationMs)}`}</span>
                                                {image && <div className="flex gap-1">
                                                    <Tooltip title={asset ? "查看素材" : "存入素材"}>
                                                        <Button type="text" size="small" aria-label={asset ? `查看素材 ${index + 1}` : `存入素材 ${index + 1}`} icon={<FolderPlus className="size-4" />} disabled={!image.dataUrl || !assetsHydrated || savingAssetIds.includes(slot.id)} onClick={() => {
                                                            if (asset) return navigate("/assets");
                                                            setSavingAssetIds((ids) => [...ids, slot.id]);
                                                            void addAssetDurably({
                                                                kind: "image", title: selected.request.prompt.slice(0, 40), coverUrl: image.dataUrl, tags: [], source: "图片任务",
                                                                data: { dataUrl: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                                                                metadata: { generationRunId: selected.id, generationSlotId: slot.id, prompt: selected.request.prompt, model: selected.request.model },
                                                            }).then(() => message.success(image.storageKey ? "已存入素材" : "已保存远程素材引用"))
                                                                .catch((error: Error) => message.error(error.message))
                                                                .finally(() => setSavingAssetIds((ids) => ids.filter((id) => id !== slot.id)));
                                                        }} />
                                                    </Tooltip>
                                                    <Tooltip title="下载图片"><Button type="text" size="small" aria-label={`下载图片 ${index + 1}`} icon={<Download className="size-4" />} disabled={!image.dataUrl} onClick={() => saveAs(image.dataUrl, `huabu-${selected.id}-${index + 1}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png"}`)} /></Tooltip>
                                                </div>}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </>
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selectedId ? "找不到该任务，原记录可能不在此浏览器中" : "未选择任务"} />}
                </section>
            </div>
        </main>
    );
}
