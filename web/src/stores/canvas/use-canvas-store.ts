import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { cloneSceneGraph, importWorkspaceProjects, sceneKinds, type SceneKind } from "@/lib/canvas/canvas-workspaces";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    defaultImageSize: string;
    showConnections: boolean;
    viewport: ViewportTransform;
    workspaceId?: string;
    sceneKind?: SceneKind;
    sceneTitle?: string;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    importProjects: (projects: Partial<CanvasProject>[]) => string[];
    createScene: (projectId: string, kind: SceneKind, duplicate?: boolean) => string | null;
    renameScene: (id: string, title: string) => void;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "defaultImageSize" | "showConnections" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    defaultImageSize: "auto",
                    showConnections: true,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => get().importProjects([source])[0],
            importProjects: (sources) => {
                const projects = importWorkspaceProjects(sources);
                set((state) => ({ projects: [...projects, ...state.projects] }));
                return projects.map((project) => project.id);
            },
            createScene: (projectId, kind, duplicate = false) => {
                const source = get().openProject(projectId);
                if (!source) return null;
                const now = new Date().toISOString();
                const workspaceId = source.workspaceId || source.id;
                const title = duplicate ? `${source.sceneTitle || source.title} 副本` : sceneKinds.find((item) => item.value === kind)?.label || "自由画布";
                const graph = duplicate ? cloneSceneGraph(source) : { nodes: [], connections: [] };
                const project: CanvasProject = {
                    id: nanoid(),
                    title,
                    sceneTitle: title,
                    sceneKind: kind,
                    workspaceId,
                    createdAt: now,
                    updatedAt: now,
                    ...graph,
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: source.backgroundMode,
                    showImageInfo: source.showImageInfo,
                    defaultImageSize: source.defaultImageSize,
                    showConnections: source.showConnections,
                    viewport: duplicate ? { ...source.viewport } : { ...initialViewport },
                };
                set((state) => ({
                    projects: [...state.projects.map((item) => item.id === workspaceId
                        ? { ...item, workspaceId, sceneTitle: item.sceneTitle || "主画布", sceneKind: "master" as const } : item), project],
                }));
                return project.id;
            },
            renameScene: (id, title) => {
                if (!title.trim()) return;
                set((state) => ({ projects: state.projects.map((project) =>
                    project.id === id ? { ...project, sceneTitle: title.trim(), updatedAt: new Date().toISOString() } : project) }));
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
