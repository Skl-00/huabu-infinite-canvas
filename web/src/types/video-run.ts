import type { ModelBinding } from "@/services/api/model-binding";
import type { VideoGenerationResult, VideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { CanvasRunContext } from "@/types/image-run";

export type VideoRunStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type VideoRunSettings = Pick<AiConfig, "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;
export type RunVideo = {
    id: string; url: string; storageKey: string; durationMs: number;
    width: number; height: number; bytes: number; mimeType: string;
};
export type VideoRun = {
    version: 1;
    revision: number;
    id: string;
    kind: "video";
    source: "video";
    agentTaskId?: string;
    retryOf?: string;
    createdAt: number;
    updatedAt: number;
    status: VideoRunStatus;
    request: {
        prompt: string; model: string; modelLabel: string; binding: ModelBinding;
        settings: VideoRunSettings; references: ReferenceImage[];
        videos: ReferenceVideo[]; audios: ReferenceAudio[];
        canvas?: CanvasRunContext;
    };
    task?: VideoGenerationTask;
    pendingResult?: VideoGenerationResult;
    video?: RunVideo;
    error?: string;
    persistenceError?: string;
};
export const videoRunStatusLabels: Record<VideoRunStatus, string> = {
    queued: "等待提交", running: "生成中", succeeded: "已完成", failed: "失败", interrupted: "中断待核对",
};
export const isActiveVideoRun = (run: VideoRun) => run.status === "queued" || run.status === "running";
