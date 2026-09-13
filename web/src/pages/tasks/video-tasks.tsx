import { App, Button, Empty, Image, Input, Segmented, Tag, Tooltip } from "antd";
import { ArrowLeft, ArrowUpRight, Download, FolderPlus, LoaderCircle, Play, RefreshCw, RotateCcw, Save, Search, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { formatBytes, formatDuration } from "@/lib/image-utils";
import { getGenerationRunSource } from "@/lib/generation-run-source";
import { initializeVideoRuns, localizeVideoRun, resaveVideoRun, resumeVideoRun, retryVideoRun } from "@/services/video-runner";
import { addAssetDurably, useAssetStore } from "@/stores/use-asset-store";
import { useVideoRunStore } from "@/stores/use-video-run-store";
import { isActiveVideoRun, videoRunStatusLabels, type VideoRunStatus } from "@/types/video-run";

const colors: Record<VideoRunStatus, string> = { queued: "default", running: "processing", succeeded: "success", failed: "error", interrupted: "warning" };
const dateLabel = (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export function VideoTasks() {
    const { message, modal } = App.useApp();
    const { runs, hydrated, loadError } = useVideoRunStore();
    const assets = useAssetStore((state) => state.assets);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [busy, setBusy] = useState(false);
    const id = params.get("run");
    const filtered = runs.filter((run) => `${run.request.prompt} ${run.request.modelLabel} ${run.id} ${run.task?.id || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        && (filter === "all" || (filter === "active" ? isActiveVideoRun(run) : filter === "done" ? run.status === "succeeded" : ["failed", "interrupted"].includes(run.status) || run.persistenceError)));
    const selected = id ? runs.find((run) => run.id === id) : filtered[0];
    const active = runs.filter(isActiveVideoRun).length;
    const video = selected?.video;
    const asset = selected && assets.find((item) => item.metadata?.generationRunId === selected.id);
    const select = (run?: string) => setParams(run ? { kind: "video", run } : { kind: "video" });
    const act = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try { await action(); } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); }
        finally { setBusy(false); }
    };
    const retry = () => {
        if (!selected) return;
        modal.confirm({
            title: "使用原参数重试视频？", content: "使用冻结的提示词、参考素材、参数与原渠道创建新任务，保留本次失败记录。新请求可能产生计费。",
            okText: "确认重试", cancelText: "取消",
            onOk: () => act(async () => { const run = await retryVideoRun(selected.id); select(run.id); }),
        });
    };

    return <main className="mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-hidden px-4 sm:px-6" data-testid="video-tasks">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border py-4">
            <div className="flex flex-wrap items-baseline gap-3"><h1 className="text-xl font-semibold">视频任务</h1><span className="hidden text-sm text-muted-foreground sm:inline">{runs.length} 次任务 · {active} 次进行中</span></div>
            <div className="flex items-center gap-2">
                <Tooltip title="刷新视频任务"><Button type="text" aria-label="刷新视频任务" icon={<RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />} disabled={busy} onClick={() => void act(initializeVideoRuns)} /></Tooltip>
                <Link to="/video"><Button icon={<Video className="size-4" />}>视频工作台</Button></Link>
            </div>
        </header>
        {loadError && <div role="alert" className="border-b border-border py-3 text-sm text-red-600">{loadError}</div>}
        <div className={`${id ? "hidden lg:flex" : "flex"} shrink-0 flex-wrap items-center gap-3 py-4`}>
            <Segmented value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: "全部", value: "all" }, { label: "进行中", value: "active" }, { label: "已完成", value: "done" }, { label: "待处理", value: "attention" }]} />
            <Input aria-label="搜索视频任务" value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-4 text-muted-foreground" />} placeholder="搜索提示词、模型或任务 ID" className="!w-full sm:!w-72" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
            <section aria-label="视频任务列表" className={`min-w-0 lg:overflow-y-auto lg:border-r lg:border-border lg:pr-4 ${id ? "hidden lg:block" : ""}`}>
                {!hydrated ? <LoaderCircle className="m-8 size-5 animate-spin" /> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配的视频任务" /> : filtered.map((run) => {
                    const source = getGenerationRunSource(run.request.canvas);
                    return <button key={run.id} type="button" data-testid="video-task-row" data-run-id={run.id} aria-current={selected?.id === run.id} onClick={() => select(run.id)} className={`flex w-full min-w-0 gap-3 border-b border-border px-2 py-4 text-left hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === run.id ? "bg-black/5 dark:bg-white/5" : ""}`}>
                        <span className="flex size-12 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">{isActiveVideoRun(run) ? <LoaderCircle className="size-5 animate-spin" /> : <Video className="size-5" />}</span>
                        <div className="min-w-0 flex-1 space-y-1.5"><p className="truncate text-sm font-medium">{run.request.prompt}</p>
                            <p className="truncate text-xs text-muted-foreground" data-testid="video-task-origin">{source.label}{source.detail ? ` · ${source.detail}` : ""}</p>
                            <div className="flex flex-wrap gap-1 text-xs"><Tag className="!m-0" color={colors[run.status]}>{videoRunStatusLabels[run.status]}</Tag>{run.persistenceError && <span className="text-red-600">未保存</span>}</div>
                            <p className="truncate text-xs text-muted-foreground">{dateLabel(run.createdAt)}</p></div>
                    </button>;
                })}
            </section>
            <section aria-label="视频任务详情" className={`min-w-0 pb-8 pt-4 lg:overflow-y-auto lg:pl-6 lg:pt-0 ${!id ? "hidden lg:block" : ""}`}>
                {selected ? <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Tooltip title="返回视频任务列表"><Button type="text" className="lg:!hidden" aria-label="返回视频任务列表" icon={<ArrowLeft className="size-4" />} onClick={() => select()} /></Tooltip>
                            <Tag color={colors[selected.status]}>{videoRunStatusLabels[selected.status]}</Tag>
                            {selected.retryOf && <Link className="text-sm text-muted-foreground" to={`/tasks?kind=video&run=${selected.retryOf}`}>查看原任务</Link>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Tooltip title="查看工作台结果"><Link to={`/video?run=${selected.id}`}><Button type="text" aria-label="查看工作台结果" icon={<ArrowUpRight className="size-4" />} /></Link></Tooltip>
                            {selected.status === "interrupted" && selected.task && !selected.pendingResult && <Button icon={<Play className="size-4" />} disabled={busy || Boolean(selected.persistenceError)} onClick={() => void act(() => resumeVideoRun(selected.id))}>继续查询原任务</Button>}
                            {selected.status === "failed" && <Button icon={<RotateCcw className="size-4" />} disabled={busy || active > 0 || Boolean(selected.persistenceError)} onClick={retry}>使用原参数重试</Button>}
                        </div>
                    </div>
                    {(selected.persistenceError || selected.pendingResult) && <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 border-l-2 border-amber-500 pl-3 text-sm text-amber-700 dark:text-amber-300">
                        <span>{selected.persistenceError || "已取得结果，等待完成本地保存"}</span>
                        <Button size="small" disabled={busy} icon={<Save className="size-4" />} onClick={() => void act(() => resaveVideoRun(selected.id))}>重新保存</Button>
                    </div>}
                    {selected.error && <p role="alert" className="mb-4 whitespace-pre-wrap border-l-2 border-amber-500 pl-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{selected.error}</p>}
                    <div className="min-w-0 border-b border-border pb-5">
                        <h2 className="mb-3 text-base font-semibold">请求快照</h2>
                        <p data-testid="video-task-prompt" className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{selected.request.prompt}</p>
                        <details className="mt-3" open={!video}>
                        <summary className="cursor-pointer text-xs text-muted-foreground">任务信息 · {selected.request.settings.vquality}p · {selected.request.settings.videoSeconds}s</summary>
                        <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                            <dt className="text-muted-foreground">来源</dt><dd data-testid="video-task-origin-detail" className="break-all">{getGenerationRunSource(selected.request.canvas).description}</dd>
                            <dt className="text-muted-foreground">模型</dt><dd className="break-all">{selected.request.modelLabel}</dd>
                            <dt className="text-muted-foreground">参数</dt><dd className="break-all">{selected.request.settings.size} · {selected.request.settings.vquality}p · {selected.request.settings.videoSeconds}s</dd>
                            <dt className="text-muted-foreground">提交时间</dt><dd>{dateLabel(selected.createdAt)}</dd>
                            <dt className="text-muted-foreground">本地任务</dt><dd className="break-all font-mono">{selected.id}</dd>
                            <dt className="text-muted-foreground">远端任务</dt><dd className="break-all font-mono">{selected.task?.id || "未取得，需到原服务核对"}</dd>
                            {selected.task?.videoId && <><dt className="text-muted-foreground">视频 ID</dt><dd className="break-all font-mono">{selected.task.videoId}</dd></>}
                        </dl>
                        </details>
                        {selected.request.references.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selected.request.references.map((ref) =>
                            ref.dataUrl ? <Image key={ref.id} src={ref.dataUrl} alt={ref.name} width={56} height={56} className="object-contain" /> : <span key={ref.id} className="text-xs text-red-600">{ref.name}：本地参考图已丢失</span>)}</div>}
                    </div>
                    {video ? <article className="mt-5 min-w-0 overflow-hidden rounded-lg border border-border" data-testid="video-task-result">
                        {video.url ? <video src={video.url} controls className="aspect-video max-h-[420px] w-full bg-black object-contain" /> : <p className="p-5 text-sm text-red-600">本地视频已丢失</p>}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
                            <span className="text-xs text-muted-foreground">{video.width && video.height ? `${video.width}x${video.height}` : "尺寸未知"} · {video.storageKey ? formatBytes(video.bytes) : "远程结果，尚未保存到本地"} · {video.durationMs ? formatDuration(video.durationMs) : "时长未知"}</span>
                            <div className="flex flex-wrap gap-1">
                                {!video.storageKey && <Button size="small" icon={<Save className="size-4" />} disabled={busy} onClick={() => void act(() => localizeVideoRun(selected.id))}>保存到本地</Button>}
                                <Tooltip title={asset ? "已存入素材" : "存入素材"}><Button type="text" aria-label={asset ? "已存入素材" : "存入素材"} icon={<FolderPlus className="size-4" />} disabled={busy || !!asset || !assetsHydrated || !video.url} onClick={() => void act(async () => {
                                    await addAssetDurably({ kind: "video", title: selected.request.prompt.slice(0, 40), coverUrl: "", tags: [], source: "视频任务",
                                        data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                                        metadata: { generationRunId: selected.id, prompt: selected.request.prompt, model: selected.request.model } });
                                    message.success("已存入素材");
                                })} /></Tooltip>
                                <Tooltip title="下载视频"><Button type="text" aria-label="下载视频" icon={<Download className="size-4" />} disabled={!video.url} onClick={() => saveAs(video.url, `huabu-${selected.id}.mp4`)} /></Tooltip>
                            </div>
                        </div>
                    </article> : isActiveVideoRun(selected) && !selected.persistenceError ? <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />生成中</div> : null}
                </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={id ? "此浏览器中未找到该任务" : "未选择任务"} />}
            </section>
        </div>
    </main>;
}
