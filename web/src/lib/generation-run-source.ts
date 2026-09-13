import type { CanvasRunContext } from "@/types/image-run";

export function getGenerationRunSource(canvas?: CanvasRunContext) {
    if (canvas?.pluginId) {
        return {
            label: "插件",
            detail: canvas.pluginNodeType || canvas.pluginId,
            description: `${canvas.pluginId}${canvas.pluginNodeType ? ` · ${canvas.pluginNodeType}` : ""}`,
        };
    }
    if (canvas) {
        return {
            label: "画布",
            detail: canvas.targetNodeId,
            description: `节点 ${canvas.targetNodeId}`,
        };
    }
    return {
        label: "独立任务",
        detail: "",
        description: "未绑定画布节点",
    };
}
