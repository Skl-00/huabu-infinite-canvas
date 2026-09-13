import { decodeChannelModel, resolveModelRequestConfig, resolveModelScript, type AiConfig, type ApiCallFormat } from "@/stores/use-config-store";

export type ModelBinding = { channelId: string; baseUrl: string; apiFormat: ApiCallFormat; model: string; scriptHash: string };

export async function captureModelBinding(config: AiConfig, model: string): Promise<ModelBinding> {
    const decoded = decodeChannelModel(model);
    const channel = config.channels.find((item) => item.id === decoded?.channelId && item.models.some((entry) => entry.name === decoded?.model));
    if (!channel) throw new Error("原渠道或模型不存在，请检查模型配置");
    const baseUrl = new URL(channel.baseUrl);
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("渠道地址不能包含凭据、查询参数或片段");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resolveModelScript(config, model)));
    return {
        channelId: channel.id, baseUrl: baseUrl.toString().replace(/\/+$/, ""),
        apiFormat: channel.apiFormat, model: decoded!.model,
        scriptHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
}

export async function resolveBoundModelConfig(config: AiConfig, model: string, binding?: ModelBinding) {
    if (!binding) throw new Error("此旧任务没有原渠道记录，无法安全恢复查询。请先在原服务核对任务");
    const current = await captureModelBinding(config, model);
    if ((Object.keys(current) as Array<keyof ModelBinding>).some((key) => current[key] !== binding[key])) throw new Error("原渠道地址、协议、模型或脚本已改变，未发送查询。请恢复原渠道配置");
    return resolveModelRequestConfig(config, model);
}

export function redactProviderError(error: unknown, config: AiConfig) {
    let text = error instanceof Error ? error.message : "生成失败";
    for (const key of [config.apiKey, ...config.channels.map((channel) => channel.apiKey)].filter(Boolean)) text = text.split(key).join("[已隐藏凭据]");
    return text;
}
