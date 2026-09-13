import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasRunContext } from "@/types/image-run";

export type AudioRunStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type AudioRunSettings = Pick<AiConfig, "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions">;

export type RunAudio = {
    id: string;
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    durationMs?: number;
};

export type AudioRun = {
    version: 1;
    revision: number;
    id: string;
    kind: "audio";
    source: "audio";
    agentTaskId?: string;
    retryOf?: string;
    createdAt: number;
    updatedAt: number;
    status: AudioRunStatus;
    request: {
        prompt: string;
        model: string;
        modelLabel: string;
        channelFingerprint: string;
        settings: AudioRunSettings;
        canvas?: CanvasRunContext;
    };
    pendingResult?: {
        blobKey: string;
        mimeType: string;
    };
    audio?: RunAudio;
    error?: string;
    persistenceError?: string;
};

export const audioRunStatusLabels: Record<AudioRunStatus, string> = {
    queued: "等待提交",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    interrupted: "中断待核对",
};

export const isActiveAudioRun = (run: AudioRun) => run.status === "queued" || run.status === "running";
