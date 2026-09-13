import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { imageToDataUrl } from "@/services/image-storage";
import { startImageRun } from "@/services/image-runner";
import { startVideoRun } from "@/services/video-runner";
import { startAudioRun } from "@/services/audio-runner";
import { startTextRun } from "@/services/text-runner";
import { decodeChannelModel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition, getNodePluginId } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { loadImageRuns, useImageRunStore } from "@/stores/use-image-run-store";
import { loadVideoRuns, useVideoRunStore } from "@/stores/use-video-run-store";
import { loadAudioRuns, useAudioRunStore } from "@/stores/use-audio-run-store";
import { loadTextRuns, useTextRunStore } from "@/stores/use-text-run-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasRunContext } from "@/types/image-run";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PluginHostParams = {
    projectId: string;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

type PluginStoredRun = {
    id: string;
    status: string;
    request: {
        prompt: string;
        model: string;
        canvas?: CanvasRunContext;
    };
    error?: string;
    persistenceError?: string;
};

type PluginGenerationCapability = "image" | "video" | "audio" | "text";

/**
 * Plugin node host capabilities: expose host-side AI generation, canvas access, and panel controls
 * through plugin-callable host/ai objects. Loads installed remote plugins on mount and returns renderers for plugin panels and toolbars.
 */
export function usePluginHost(params: PluginHostParams) {
    const { t } = useTranslation();
    const { projectId, effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;
    const inFlightGenerationRef = useRef(new Map<string, { promise: Promise<unknown>; onDelta?: (text: string) => void }>());
    const findExistingRun = async <T extends PluginStoredRun>(
        capability: PluginGenerationCapability,
        nodeId: string | undefined,
        prompt: string,
        model: string,
        requestKey: string | undefined,
        allowRepeat: boolean | undefined,
        load: () => Promise<void>,
        getRuns: () => T[],
    ) => {
        if (!nodeId || allowRepeat) return undefined;
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const runId = node?.metadata?.generationRunId;
        if (!runId || node.metadata?.generationRunKind !== capability) return undefined;
        const pluginId = node ? getNodePluginId(node.type) : undefined;
        await load();
        const run = getRuns().find((item) => item.id === runId);
        if (!run
            || run.request.canvas?.projectId !== projectId
            || run.request.canvas.targetNodeId !== nodeId
            || run.request.canvas.pluginId !== pluginId
            || run.request.canvas.pluginNodeType !== node?.type
            || run.request.prompt !== prompt.trim()
            || run.request.model !== model) return undefined;
        if (run.persistenceError) throw new Error(run.persistenceError);
        if (run.status === "succeeded") return run;
        if (requestKey && inFlightGenerationRef.current.has(requestKey)) return undefined;
        throw new Error(run.error || "该节点已有未完成或失败的生成任务，未自动重新提交，请到任务中心核对。");
    };

    const pluginAi = useMemo<CanvasPluginAi>(() => {
        // Convert plugin reference images (data URLs or URLs) into the ReferenceImage[] expected by the host generation API.
        const toReferences = (refs?: string[]): ReferenceImage[] => (refs || []).filter(Boolean).map((src, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));
        const referenceSignature = (refs: ReferenceImage[]) => refs.map((ref) => `${ref.dataUrl.length}:${ref.dataUrl.slice(0, 32)}:${ref.dataUrl.slice(-32)}`).join("|");
        const runKey = (capability: string, nodeId: string | undefined, prompt: string, model: string, extra: unknown) => {
            if (!nodeId) return undefined;
            return JSON.stringify({ capability, nodeId, prompt: prompt.trim(), model, extra });
        };
        const runInFlight = <T,>(key: string | undefined, task: (onDelta?: (text: string) => void) => Promise<T>, onDelta?: (text: string) => void) => {
            if (!key) return task(onDelta);
            const existing = inFlightGenerationRef.current.get(key);
            if (existing) {
                existing.onDelta = onDelta;
                return existing.promise as Promise<T>;
            }
            const entry = { promise: Promise.resolve() as Promise<unknown>, onDelta };
            const promise = task((text) => entry.onDelta?.(text)).finally(() => {
                if (inFlightGenerationRef.current.get(key)?.promise === promise) inFlightGenerationRef.current.delete(key);
            });
            entry.promise = promise;
            inFlightGenerationRef.current.set(key, entry);
            return promise;
        };
        const runContext = (nodeId: string | undefined, explicit?: CanvasRunContext): CanvasRunContext | undefined => {
            if (!projectId || !nodeId) return explicit;
            const node = nodesRef.current.find((item) => item.id === nodeId);
            return {
                ...explicit,
                projectId,
                sceneId: projectId,
                targetNodeId: nodeId,
                ...(node ? { pluginId: getNodePluginId(node.type), pluginNodeType: node.type } : {}),
            };
        };
        const nodeModelConfig = (capability: "image" | "video" | "text" | "audio", model?: string) => {
            const selected = model || buildGenerationConfig(effectiveConfig, undefined, capability).model;
            const config = { ...buildGenerationConfig(effectiveConfig, undefined, capability), model: selected };
            if (capability === "image") config.imageModel = selected;
            if (capability === "video") config.videoModel = selected;
            if (capability === "text") config.textModel = selected;
            if (capability === "audio") config.audioModel = selected;
            return config;
        };
        // Open the configuration dialog and throw when AI is not configured, allowing the plugin to handle the error.
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openConfigDialog(true);
                throw new Error(t("canvas.plugins.aiConfigRequired"));
            }
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...nodeModelConfig("image", options?.model), count: String(options?.count || 1), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = toReferences(options?.references);
                const targetNodeId = options?.runContext?.targetNodeId;
                const requestKey = runKey("image", targetNodeId, prompt, config.model, { count: config.count, size: config.size, references: referenceSignature(references) });
                const existing = await findExistingRun("image", targetNodeId, prompt, config.model, requestKey, options?.allowRepeat, loadImageRuns, () => useImageRunStore.getState().runs);
                if (existing?.status === "succeeded") {
                    const images = await Promise.all(existing.slots.filter((slot) => slot.status === "success" && slot.image).map(async (slot) => {
                        return imageToDataUrl({ storageKey: slot.image!.storageKey, dataUrl: slot.image!.dataUrl }, { signal: options?.signal });
                    }));
                    if (images.length) return { images };
                }
                return runInFlight(
                    requestKey,
                    async () => {
                        const run = await startImageRun({
                            prompt,
                            config,
                            references,
                            count: Math.max(1, Math.floor(options?.count || 1)),
                            canvas: runContext(targetNodeId, options?.runContext),
                            signal: options?.signal,
                            onCreated: (id) => {
                                if (targetNodeId) setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, generationRunId: id, generationRunKind: "image", status: "loading", model: config.model } } : node));
                            },
                        });
                        if (!run.slots.some((slot) => slot.status === "success")) throw new Error(run.slots.find((slot) => slot.error)?.error || run.persistenceError || "图片任务未生成结果");
                        const images = await Promise.all(run.slots.filter((slot) => slot.status === "success" && slot.image).map(async (slot) => {
                            return imageToDataUrl({ storageKey: slot.image!.storageKey, dataUrl: slot.image!.dataUrl }, { signal: options?.signal });
                        }));
                        return { images };
                    },
                );
            },
            generateVideo: async (prompt, options) => {
                const config = { ...nodeModelConfig("video", options?.model), ...(options?.size ? { size: options.size } : {}), ...(options?.seconds ? { videoSeconds: options.seconds } : {}) };
                ensureReady(config);
                const targetNodeId = options?.runContext?.targetNodeId;
                const references = toReferences(options?.references);
                const requestKey = runKey("video", targetNodeId, prompt, config.model, { size: config.size, seconds: config.videoSeconds, references: referenceSignature(references) });
                const existing = await findExistingRun("video", targetNodeId, prompt, config.model, requestKey, options?.allowRepeat, loadVideoRuns, () => useVideoRunStore.getState().runs);
                if (existing?.status === "succeeded" && existing.video) {
                    return { url: existing.video.url, mimeType: existing.video.mimeType, width: existing.video.width, height: existing.video.height, durationMs: existing.video.durationMs };
                }
                return runInFlight(
                    requestKey,
                    async () => {
                        const run = await startVideoRun({
                            prompt,
                            config,
                            references,
                            canvas: runContext(targetNodeId, options?.runContext),
                            signal: options?.signal,
                            onCreated: (id) => {
                                if (targetNodeId) setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, generationRunId: id, generationRunKind: "video", status: "loading", model: config.model } } : node));
                            },
                        });
                        if (!run.video) throw new Error(run.error || run.persistenceError || "视频任务未生成结果");
                        return { url: run.video.url, mimeType: run.video.mimeType, width: run.video.width, height: run.video.height, durationMs: run.video.durationMs };
                    },
                );
            },
            generateText: async (prompt, options) => {
                const config = { ...nodeModelConfig("text", options?.model), ...(options?.system !== undefined ? { systemPrompt: options.system } : {}) };
                ensureReady(config);
                const targetNodeId = options?.runContext?.targetNodeId;
                const references = toReferences(options?.references);
                const requestKey = runKey("text", targetNodeId, prompt, config.model, { system: config.systemPrompt, references: options?.references || [] });
                const existing = await findExistingRun("text", targetNodeId, prompt, config.model, requestKey, options?.allowRepeat, loadTextRuns, () => useTextRunStore.getState().runs);
                if (existing?.status === "succeeded") {
                    const text = existing.content || existing.partialContent;
                    if (text) return { text };
                }
                return runInFlight(
                    requestKey,
                    async (onDelta) => {
                        const run = await startTextRun({
                            prompt,
                            config,
                            references,
                            canvas: runContext(targetNodeId, options?.runContext),
                            signal: options?.signal,
                            onDelta,
                            onCreated: (id) => {
                                if (targetNodeId) setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, generationRunId: id, generationRunKind: "text", status: "loading", model: config.model } } : node));
                            },
                        });
                        const text = run.content || run.partialContent;
                        if (!text || run.status !== "succeeded") throw new Error(run.error || run.persistenceError || "文本任务未生成结果");
                        return { text };
                    },
                    options?.onDelta,
                );
            },
            generateAudio: async (prompt, options) => {
                const config = {
                    ...nodeModelConfig("audio", options?.model),
                    ...(options?.voice !== undefined ? { audioVoice: options.voice } : {}),
                    ...(options?.format !== undefined ? { audioFormat: options.format } : {}),
                    ...(options?.speed !== undefined ? { audioSpeed: options.speed } : {}),
                    ...(options?.instructions !== undefined ? { audioInstructions: options.instructions } : {}),
                };
                ensureReady(config);
                const targetNodeId = options?.runContext?.targetNodeId;
                const requestKey = runKey("audio", targetNodeId, prompt, config.model, { voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions });
                const existing = await findExistingRun("audio", targetNodeId, prompt, config.model, requestKey, options?.allowRepeat, loadAudioRuns, () => useAudioRunStore.getState().runs);
                if (existing?.status === "succeeded" && existing.audio) {
                    return { url: existing.audio.url, mimeType: existing.audio.mimeType, durationMs: existing.audio.durationMs };
                }
                return runInFlight(
                    requestKey,
                    async () => {
                        const run = await startAudioRun({
                            prompt,
                            config,
                            canvas: runContext(targetNodeId, options?.runContext),
                            signal: options?.signal,
                            onCreated: (id) => {
                                if (targetNodeId) setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, generationRunId: id, generationRunKind: "audio", status: "loading", model: config.model } } : node));
                            },
                        });
                        if (!run.audio) throw new Error(run.error || run.persistenceError || "音频任务未生成结果");
                        return { url: run.audio.url, mimeType: run.audio.mimeType, durationMs: run.audio.durationMs };
                    },
                );
            },
            // List configured models for a capability; labels use the model name without the channel prefix.
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog, projectId, setNodes, t]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            ai: pluginAi,
            aiForNode: (nodeId) => ({
                ...pluginAi,
                generateImage: (prompt, options) => pluginAi.generateImage(prompt, { ...options, runContext: { ...options?.runContext, projectId, sceneId: projectId, targetNodeId: nodeId } }),
                generateVideo: (prompt, options) => pluginAi.generateVideo(prompt, { ...options, runContext: { ...options?.runContext, projectId, sceneId: projectId, targetNodeId: nodeId } }),
                generateText: (prompt, options) => pluginAi.generateText(prompt, { ...options, runContext: { ...options?.runContext, projectId, sceneId: projectId, targetNodeId: nodeId } }),
                generateAudio: (prompt, options) => pluginAi.generateAudio(prompt, { ...options, runContext: { ...options?.runContext, projectId, sceneId: projectId, targetNodeId: nodeId } }),
            }),
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, pluginAi, projectId, setDialogNodeId, setNodes],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // Build the node toolbar from plugin items and a host-provided interaction/move toggle when enabled.
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle"),
                label: t(interactive ? "canvas.plugins.move" : "canvas.plugins.interact"),
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, t, theme],
    );

    // Load installed remote plugins on startup.
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
