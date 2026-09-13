import { App, Button, Empty, Input, Segmented, Tag, Tooltip } from "antd";
import { ArrowLeft, ArrowUpRight, Clipboard, Download, FileText, LoaderCircle, Play, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import { saveAs } from "file-saver";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getGenerationRunSource } from "@/lib/generation-run-source";
import { retryTextRun } from "@/services/text-runner";
import { initializeTextRuns, resaveTextRun, useTextRunStore } from "@/stores/use-text-run-store";
import { isActiveTextRun, textRunStatusLabels, type TextRunStatus } from "@/types/text-run";

const colors: Record<TextRunStatus, string> = { queued: "default", running: "processing", succeeded: "success", failed: "error", interrupted: "warning" };
const dateLabel = (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export function TextTasks() {
    const { message, modal } = App.useApp();
    const { runs, hydrated, loadError } = useTextRunStore();
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [busy, setBusy] = useState(false);
    const id = params.get("run");
    const filtered = runs.filter((run) => `${run.request.prompt} ${run.request.modelLabel} ${run.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        && (filter === "all" || (filter === "active" ? isActiveTextRun(run) : filter === "done" ? run.status === "succeeded" : ["failed", "interrupted"].includes(run.status) || Boolean(run.persistenceError))));
    const selected = id ? runs.find((run) => run.id === id) : filtered[0];
    const active = runs.filter(isActiveTextRun).length;
    const select = (run?: string) => setParams(run ? { kind: "text", run } : { kind: "text" });
    const act = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try { await action(); } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); }
        finally { setBusy(false); }
    };
    const retry = () => {
        if (!selected) return;
        modal.confirm({
            title: "使用原参数重试文本？",
            content: "使用冻结的提示词、参考图和原渠道创建新任务，保留本次失败记录。",
            okText: "确认重试",
            cancelText: "取消",
            onOk: () => act(async () => { const run = await retryTextRun(selected.id); select(run.id); }),
        });
    };
    const content = selected?.content || selected?.partialContent || "";
    const copyContent = async () => {
        if (!content) return;
        await navigator.clipboard.writeText(content);
        message.success("文本已复制");
    };

    return <main className="mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-hidden px-4 sm:px-6" data-testid="text-tasks">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border py-4">
            <div className="flex flex-wrap items-baseline gap-3"><h1 className="text-xl font-semibold">文本任务</h1><span className="hidden text-sm text-muted-foreground sm:inline">{runs.length} 次任务 · {active} 次进行中</span></div>
            <div className="flex items-center gap-2">
                <Tooltip title="刷新文本任务"><Button type="text" aria-label="刷新文本任务" icon={<RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />} disabled={busy} onClick={() => void act(initializeTextRuns)} /></Tooltip>
                <Link to="/canvas"><Button icon={<FileText className="size-4" />}>返回画布</Button></Link>
            </div>
        </header>
        {loadError && <div role="alert" className="border-b border-border py-3 text-sm text-red-600">{loadError}</div>}
        <div className={`${id ? "hidden lg:flex" : "flex"} shrink-0 flex-wrap items-center gap-3 py-4`}>
            <Segmented value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: "全部", value: "all" }, { label: "进行中", value: "active" }, { label: "已完成", value: "done" }, { label: "待处理", value: "attention" }]} />
            <Input aria-label="搜索文本任务" value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search className="size-4 text-muted-foreground" />} placeholder="搜索提示词、模型或任务 ID" className="!w-full sm:!w-72" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
            <section aria-label="文本任务列表" className={`min-w-0 lg:overflow-y-auto lg:border-r lg:border-border lg:pr-4 ${id ? "hidden lg:block" : ""}`}>
                {!hydrated ? <LoaderCircle className="m-8 size-5 animate-spin" /> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配的文本任务" /> : filtered.map((run) => {
                    const source = getGenerationRunSource(run.request.canvas);
                    return <button key={run.id} type="button" data-testid="text-task-row" data-run-id={run.id} aria-current={selected?.id === run.id} onClick={() => select(run.id)} className={`flex w-full min-w-0 gap-3 border-b border-border px-2 py-4 text-left hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === run.id ? "bg-black/5 dark:bg-white/5" : ""}`}>
                        <span className="flex size-12 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">{isActiveTextRun(run) ? <LoaderCircle className="size-5 animate-spin" /> : <FileText className="size-5" />}</span>
                        <div className="min-w-0 flex-1 space-y-1.5"><p className="truncate text-sm font-medium">{run.request.prompt}</p>
                            <p className="truncate text-xs text-muted-foreground" data-testid="text-task-origin">{source.label}{source.detail ? ` · ${source.detail}` : ""}</p>
                            <div className="flex flex-wrap gap-1 text-xs"><Tag className="!m-0" color={colors[run.status]}>{textRunStatusLabels[run.status]}</Tag>{run.persistenceError && <span className="text-red-600">未保存</span>}</div>
                            <p className="truncate text-xs text-muted-foreground">{dateLabel(run.createdAt)}</p></div>
                    </button>;
                })}
            </section>
            <section aria-label="文本任务详情" className={`min-w-0 pb-8 pt-4 lg:overflow-y-auto lg:pl-6 lg:pt-0 ${!id ? "hidden lg:block" : ""}`}>
                {selected ? <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Tooltip title="返回文本任务列表"><Button type="text" className="lg:!hidden" aria-label="返回文本任务列表" icon={<ArrowLeft className="size-4" />} onClick={() => select()} /></Tooltip>
                            <Tag color={colors[selected.status]}>{textRunStatusLabels[selected.status]}</Tag>
                            {selected.retryOf && <Link className="text-sm text-muted-foreground" to={`/tasks?kind=text&run=${selected.retryOf}`}>查看原任务</Link>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {selected.request.canvas?.projectId && <Tooltip title="查看来源画布"><Link to={`/canvas/${selected.request.canvas.projectId}`}><Button type="text" aria-label="查看来源画布" icon={<ArrowUpRight className="size-4" />} /></Link></Tooltip>}
                            {selected.status === "failed" || selected.status === "interrupted" ? <Button icon={<RotateCcw className="size-4" />} disabled={busy || Boolean(selected.persistenceError)} onClick={retry}>使用原参数重试</Button> : null}
                        </div>
                    </div>
                    {selected.persistenceError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 border-l-2 border-red-500 pl-3 text-sm text-red-600">
                        <span>{selected.persistenceError}</span>
                        <Button size="small" icon={<Save className="size-4" />} onClick={() => void act(() => resaveTextRun(selected.id))}>重新保存</Button>
                    </div>}
                    {selected.error && <p role="alert" className="mb-4 whitespace-pre-wrap border-l-2 border-amber-500 pl-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{selected.error}</p>}
                    <div className="min-w-0 border-b border-border pb-5">
                        <h2 className="mb-3 text-base font-semibold">请求快照</h2>
                        <p data-testid="text-task-prompt" className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{selected.request.prompt}</p>
                        <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                            <dt className="text-muted-foreground">来源</dt><dd data-testid="text-task-origin-detail" className="break-all">{getGenerationRunSource(selected.request.canvas).description}</dd>
                            <dt className="text-muted-foreground">模型</dt><dd className="break-all">{selected.request.modelLabel}</dd>
                            <dt className="text-muted-foreground">推理</dt><dd>{selected.request.settings.reasoningEffort}</dd>
                            <dt className="text-muted-foreground">提交时间</dt><dd>{dateLabel(selected.createdAt)}</dd>
                            <dt className="text-muted-foreground">本地任务</dt><dd className="break-all font-mono">{selected.id}</dd>
                        </dl>
                    </div>
                    {isActiveTextRun(selected) && !selected.persistenceError ? <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />生成中</div> : <article className="mt-5 min-w-0 overflow-hidden rounded-lg border border-border" data-testid="text-task-result">
                        <div className="whitespace-pre-wrap break-words p-5 text-sm leading-7 [overflow-wrap:anywhere]">{content || "没有保存的文本结果"}</div>
                        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border p-3">
                            <Tooltip title="复制文本"><Button type="text" aria-label="复制文本" icon={<Clipboard className="size-4" />} disabled={!content} onClick={() => void copyContent()} /></Tooltip>
                            <Tooltip title="下载文本"><Button type="text" aria-label="下载文本" icon={<Download className="size-4" />} disabled={!content} onClick={() => saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), `huabu-${selected.id}.txt`)} /></Tooltip>
                        </div>
                    </article>}
                </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={id ? "此浏览器中未找到该任务" : "未选择任务"} />}
            </section>
        </div>
    </main>;
}
