import { nanoid } from "nanoid";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export const sceneKinds = [
    { value: "story", label: "故事 / 剧本" },
    { value: "assets", label: "资产工坊" },
    { value: "storyboard", label: "分镜板" },
    { value: "shots", label: "镜头 / 生成" },
    { value: "custom", label: "自由画布" },
] as const;
export type SceneKind = "master" | (typeof sceneKinds)[number]["value"];

export function workspaceProjects(projects: CanvasProject[], project: CanvasProject) {
    const id = project.workspaceId || project.id;
    return projects.filter((item) => (item.workspaceId || item.id) === id)
        .sort((a, b) => Number(b.id === id) - Number(a.id === id) || a.createdAt.localeCompare(b.createdAt));
}

export function cloneSceneGraph(project: CanvasProject) {
    const ids = new Map(project.nodes.map((node) => [node.id, nanoid()]));
    const nodes = structuredClone(project.nodes).map((node) => {
        const metadata = node.metadata;
        if (metadata) {
            if (metadata.status === "loading") {
                metadata.status = "error";
                metadata.errorDetails = "复制不继承运行中的任务，请在原画布查看任务状态。";
            }
            delete metadata.videoTaskId;
            delete metadata.videoTaskProvider;
            delete metadata.videoTask;
            delete metadata.generationRunId;
            delete metadata.generationRunKind;
            metadata.groupId = metadata.groupId ? ids.get(metadata.groupId) : undefined;
            metadata.images?.forEach((image) => {
                const id = nanoid();
                if (metadata.primaryImageId === image.id) metadata.primaryImageId = id;
                image.id = id;
                if (image.status === "loading") image.status = "idle";
            });
            metadata.texts?.forEach((text) => {
                const id = nanoid();
                if (metadata.primaryTextId === text.id) metadata.primaryTextId = id;
                text.id = id;
                delete text.generationRunId;
                if (text.status === "loading") text.status = "idle";
            });
        }
        return { ...node, id: ids.get(node.id)! };
    });
    const connections = project.connections.flatMap((edge) => {
        const fromNodeId = ids.get(edge.fromNodeId);
        const toNodeId = ids.get(edge.toNodeId);
        return fromNodeId && toNodeId ? [{ id: nanoid(), fromNodeId, toNodeId }] : [];
    });
    return { nodes, connections };
}

export function importWorkspaceProjects(sources: Partial<CanvasProject>[]): CanvasProject[] {
    const ids = new Map(sources.filter((p) => p.id).map((p) => [p.id!, nanoid()]));
    const now = new Date().toISOString();
    return sources.map((source) => ({
        ...source,
        id: source.id ? ids.get(source.id)! : nanoid(),
        title: source.title || "导入的画布",
        createdAt: source.createdAt || now,
        updatedAt: now,
        nodes: source.nodes || [],
        connections: source.connections || [],
        chatSessions: source.chatSessions || [],
        activeChatId: source.activeChatId || null,
        backgroundMode: source.backgroundMode || "dots",
        showImageInfo: source.showImageInfo || false,
        defaultImageSize: source.defaultImageSize || "auto",
        showConnections: source.showConnections ?? true,
        viewport: source.viewport || { x: 0, y: 0, k: 1 },
        workspaceId: source.workspaceId ? ids.get(source.workspaceId) : undefined,
    }));
}
