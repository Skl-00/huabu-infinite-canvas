import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type ImageRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "interrupted";
export type ImageRunSettings = Pick<AiConfig, "quality" | "size" | "background" | "systemPrompt" | "reasoningEffort">;

export type RunImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type ImageRunSlot = {
    id: string;
    status: "pending" | "success" | "failed" | "interrupted";
    image?: RunImage;
    error?: string;
};
export type CanvasRunContext = {
    projectId: string;
    sceneId: string;
    targetNodeId: string;
    originNodeId?: string;
    targetItemId?: string;
    pluginId?: string;
    pluginNodeType?: string;
};

export type ImageRun = {
    version: 1;
    revision: number;
    id: string;
    kind: "image";
    source: "image";
    agentTaskId?: string;
    retryOf?: string;
    createdAt: number;
    updatedAt: number;
    status: ImageRunStatus;
    request: {
        prompt: string;
        model: string;
        modelLabel: string;
        channelFingerprint: string;
        settings: ImageRunSettings;
        references: ReferenceImage[];
        canvas?: CanvasRunContext;
    };
    slots: ImageRunSlot[];
    persistenceError?: string;
};

export const imageRunStatusLabels: Record<ImageRunStatus, string> = {
    queued: "等待提交",
    running: "生成中",
    succeeded: "已完成",
    partial: "部分成功",
    failed: "失败",
    interrupted: "中断待核对",
};

export function isActiveImageRun(run: ImageRun) {
    return run.status === "queued" || run.status === "running";
}

export function completedImageRunStatus(slots: ImageRunSlot[]): ImageRunStatus {
    if (slots.some((slot) => slot.status === "interrupted" || slot.status === "pending")) return "interrupted";
    const succeeded = slots.filter((slot) => slot.status === "success").length;
    return succeeded === slots.length ? "succeeded" : succeeded ? "partial" : "failed";
}
