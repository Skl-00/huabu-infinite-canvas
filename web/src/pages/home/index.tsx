import { ArrowRight, FileText, ImagePlus, Images, Maximize2, Sparkles, Video } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App, Button, Empty } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import i18n from "@/i18n";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export default function IndexPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const assets = useAssetStore((state) => state.assets);
    const recentProjects = projects.filter((project) => !project.workspaceId || project.workspaceId === project.id).slice(0, 4);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : i18n.t("home.promptError")));
    }, [message]);

    return (
        <main className="workspace-page">
            <div className="workspace-content">
                <section className="workspace-welcome">
                    <div className="workspace-welcome-copy">
                        <p className="workspace-eyebrow"><Sparkles size={14} />{t("home.workspaceEyebrow")}</p>
                        <h1>{t("home.workspaceTitle")}</h1>
                        <p className="workspace-lede">{t("home.workspaceDescription")}</p>
                    </div>
                    <Button type="primary" size="large" onClick={() => navigate("/canvas")} icon={<Maximize2 size={17} />}>{t("home.openCanvas")}</Button>
                </section>

                <section className="workspace-section">
                    <div className="workspace-section-heading"><div><h2>{t("home.quickCreate")}</h2><p>{t("home.description")}</p></div></div>
                    <div className="quick-create-grid">
                        <QuickCreate icon={<Maximize2 />} title={t("home.createCanvas")} description={t("home.createCanvasDescription")} onClick={() => navigate(`/canvas/${createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))}`)} />
                        <QuickCreate icon={<ImagePlus />} title={t("home.createImage")} description={t("home.createImageDescription")} onClick={() => navigate("/image")} />
                        <QuickCreate icon={<Video />} title={t("home.createVideo")} description={t("home.createVideoDescription")} onClick={() => navigate("/video")} />
                    </div>
                </section>

                <section className="workspace-community-entry">
                    <div className="workspace-community-copy">
                        <span className="workspace-community-icon"><FileText size={18} /></span>
                        <div>
                            <h2>{t("home.communityTitle")}</h2>
                            <p>{t("home.communityDescription")}</p>
                        </div>
                    </div>
                    <Button type="link" onClick={() => navigate("/prompts")} icon={<ArrowRight size={15} />}>{t("home.openCommunity")}</Button>
                </section>

                <section className="workspace-section">
                    <div className="workspace-section-heading"><div><h2>{t("home.libraryTitle")}</h2><p>{t("home.libraryDescription")}</p></div></div>
                    <div className="workspace-library-grid">
                        <LibraryPanel icon={<Maximize2 />} title={t("home.recentCanvases")} count={recentProjects.length} action={t("home.openLibrary")} onClick={() => navigate("/canvas")}>
                            {recentProjects.length ? recentProjects.map((project) => <button key={project.id} type="button" className="workspace-list-row" onClick={() => navigate(`/canvas/${project.id}`)}><span>{project.title}</span><small>{project.nodes.length} 个节点</small></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("home.emptyCanvases")} />}
                        </LibraryPanel>
                        <LibraryPanel icon={<Images />} title={t("home.recentAssets")} count={assets.length} action={t("home.openLibrary")} onClick={() => navigate("/assets")}>
                            <div className="workspace-stat"><strong>{assets.length}</strong><span>{t("home.recentAssets")}</span></div>
                            <Button type="link" onClick={() => navigate("/assets")} icon={<ArrowRight size={15} />}>{t("home.openLibrary")}</Button>
                        </LibraryPanel>
                        <LibraryPanel icon={<FileText />} title={t("home.recentPrompts")} count={promptShowcase.length} action={t("home.openLibrary")} onClick={() => navigate("/prompts")}>
                            <div className="workspace-prompt-preview">{promptShowcase.slice(0, 2).map((item) => <button key={item.id} type="button" onClick={() => navigate("/prompts")}><strong>{item.title}</strong><span>{item.prompt}</span></button>)}</div>
                        </LibraryPanel>
                    </div>
                </section>
            </div>
        </main>
    );
}

function QuickCreate({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
    return <button type="button" className="quick-create-card" onClick={onClick}><span className="quick-create-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={16} /></button>;
}

function LibraryPanel({ icon, title, count, action, onClick, children }: { icon: ReactNode; title: string; count: number; action: string; onClick: () => void; children: ReactNode }) {
    return <section className="library-panel"><header><div><span className="library-panel-icon">{icon}</span><h3>{title}</h3><small>{count}</small></div><button type="button" onClick={onClick}>{action}</button></header><div className="library-panel-body">{children}</div></section>;
}
