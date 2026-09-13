import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { CanvasRunContext } from "@/types/image-run";

export type TextRunStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type TextRunSettings = Pick<AiConfig, "systemPrompt" | "reasoningEffort">;

export type TextRun = {
    version: 1;
    revision: number;
    id: string;
    kind: "text";
    source: "text";
    agentTaskId?: string;
    retryOf?: string;
    createdAt: number;
    updatedAt: number;
    status: TextRunStatus;
    request: {
        prompt: string;
        model: string;
        modelLabel: string;
        channelFingerprint: string;
        settings: TextRunSettings;
        references: ReferenceImage[];
        canvas?: CanvasRunContext;
    };
    partialContent?: string;
    content?: string;
    error?: string;
    persistenceError?: string;
};

export const textRunStatusLabels: Record<TextRunStatus, string> = {
    queued: "等待提交",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    interrupted: "中断待核对",
};

export const isActiveTextRun = (run: TextRun) => run.status === "queued" || run.status === "running";
