import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Input } from "antd";
import { Download, FileUp, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readCanvasArchive } from "@/lib/canvas/canvas-import";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { workspaceProjects } from "@/lib/canvas/canvas-workspaces";
import "./workspace.css";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [search, setSearch] = useState("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const workspaceRoots = projects.filter((project) => !project.workspaceId || project.workspaceId === project.id || !projects.some((root) => root.id === project.workspaceId));
    const visibleRoots = useMemo(() => {
        const keyword = search.trim().toLocaleLowerCase();
        if (!keyword) return workspaceRoots;
        return workspaceRoots.filter((root) =>
            workspaceProjects(projects, root).some((scene) =>
                [scene.title, scene.sceneTitle, ...scene.nodes.map((node) => node.title)]
                    .some((value) => value?.toLocaleLowerCase().includes(keyword)),
            ),
        );
    }, [projects, search, workspaceRoots]);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProjects = useCanvasStore((state) => state.importProjects);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const imported = await readCanvasArchive(file);
            importProjects(imported);
            message.success(t("canvas.imported", { count: imported.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : projects[0]?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="workspace-page">
            <div className="workspace-content">
                <header className="workspace-page-heading">
                    <div>
                        <p className="workspace-eyebrow">{t("canvas.library")}</p>
                        <h1>{t("canvas.title")}</h1>
                        <p className="workspace-page-description">{t("canvas.emptyDescription")}</p>
                    </div>
                    <div className="workspace-page-actions">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.workspaceId || project.id)), `${t("canvas.title")}-${selectedIds.length}`)}>
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.filter((project) => selectedIds.includes(project.workspaceId || project.id)).map((project) => project.id))}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </div>
                </header>

                <div className="workspace-library-toolbar">
                    <Input
                        allowClear
                        prefix={<Search className="size-4 opacity-45" />}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("canvas.searchPlaceholder")}
                        aria-label={t("canvas.search")}
                    />
                    <div className="workspace-library-summary">
                        <span>{t("canvas.projectSummary.projects", { count: workspaceRoots.length })}</span>
                        <span>{t("canvas.projectSummary.scenes", { count: projects.length })}</span>
                        <span>{t("canvas.projectSummary.nodes", { count: projects.reduce((total, project) => total + project.nodes.length, 0) })}</span>
                        <span>{t("canvas.projectSummary.connections", { count: projects.reduce((total, project) => total + project.connections.length, 0) })}</span>
                    </div>
                </div>

                {!hydrated ? (
                    <section className="workspace-empty">{t("canvas.loading")}</section>
                ) : projects.length ? (
                    visibleRoots.length ? (
                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {visibleRoots.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                    ) : (
                        <section className="workspace-empty">
                            <h2>{t("canvas.noSearchResults")}</h2>
                            <p>{t("canvas.searchHint")}</p>
                        </section>
                    )
                ) : (
                    <section className="workspace-empty workspace-empty-large">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
