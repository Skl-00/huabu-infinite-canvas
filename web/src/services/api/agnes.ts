import axios from "axios";
import { nanoid } from "nanoid";

import { inferVideoRatio } from "@/lib/media-size";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type Options = { signal?: AbortSignal };
type AgnesVideo = { id?: string; video_id?: string; status?: string; url?: string; metadata?: { url?: string }; error?: { message?: string } };

export const AGNES_VIDEO_FLASH_LIMITS = { minSeconds: 4, maxSeconds: 12, maxImages: 5, maxAudios: 3 } as const;

const headers = (config: AiConfig) => ({ Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" });

export async function requestAgnesImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: Options) {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const size = config.size.trim();
    const tier = ({ low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K" } as Record<string, string>)[config.quality] || "1K";
    const body = {
        model: config.model, prompt,
        size: /^\d+x\d+$/i.test(size) ? size : tier,
        ...(size.includes(":") ? { ratio: size } : {}),
        extra_body: { response_format: "b64_json", ...(images.length ? { image: images } : {}) },
    };
    // Each call returns one image; count does not rely on undocumented n semantics.
    const results: Array<{ id: string; dataUrl: string }> = [];
    for (let index = 0; index < count; index++) {
        const { data } = await axios.post(buildApiUrl(config.baseUrl, "/images/generations"), body, { headers: headers(config), signal: options?.signal });
        if (data.error) throw new Error(data.error.message || "Agnes 图片生成失败");
        const item = data.data?.[0];
        const dataUrl = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url;
        if (typeof dataUrl !== "string" || !dataUrl) throw new Error("Agnes 未返回图片结果");
        results.push({ id: nanoid(), dataUrl });
    }
    return results;
}

function publicMediaUrl(value: string | undefined) {
    let url: URL;
    try { url = new URL(value || ""); } catch { throw new Error("Agnes 视频参考素材需要公开可访问的 HTTPS 链接"); }
    if (!["https:", "http:"].includes(url.protocol) || url.hostname === "localhost" || url.hostname === "[::1]" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
        throw new Error("Agnes 视频暂不支持本地参考素材。请使用公开链接；不会自动上传到第三方图床");
    }
    if (url.username || url.password) throw new Error("参考素材链接不能包含登录凭据");
    return url.toString();
}

export async function createAgnesVideo(config: AiConfig, prompt: string, references: ReferenceImage[], options?: Options & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] }) {
    if (options?.videos?.length) throw new Error("Agnes Video Flash 不支持参考视频，未提交任务");
    const images = references.map((image) => publicMediaUrl(image.dataUrl));
    const audios = (options?.audios || []).map((audio) => publicMediaUrl(audio.url));
    const mode = !images.length && !audios.length ? "text" : config.videoMode === "reference" || images.length > 2 || audios.length ? "reference" : "keyframe";
    if (mode === "reference" && images.length > AGNES_VIDEO_FLASH_LIMITS.maxImages) throw new Error(`Agnes Video Flash 参考图片最多支持 ${AGNES_VIDEO_FLASH_LIMITS.maxImages} 张，未提交任务`);
    if (audios.length > AGNES_VIDEO_FLASH_LIMITS.maxAudios) throw new Error(`Agnes Video Flash 参考音频最多支持 ${AGNES_VIDEO_FLASH_LIMITS.maxAudios} 段，未提交任务`);
    const ratio = inferVideoRatio(config.size);
    const { data } = await axios.post<AgnesVideo>(buildApiUrl(config.baseUrl, "/videos"), {
        model: config.model, prompt, seconds: normalizeAgnesVideoSeconds(config.videoSeconds),
        size: "720P",
        aspect_ratio: ratio === "auto" ? "16:9" : ratio,
        mode,
        ...(mode === "keyframe" ? { first_frame: images[0], ...(images[1] ? { last_frame: images[1] } : {}) } : {}),
        ...(mode === "reference" ? { ...(images.length ? { images } : {}), ...(audios.length ? { audios } : {}) } : {}),
    }, { headers: headers(config), signal: options?.signal });
    if (data.error) throw new Error(data.error.message || "Agnes 视频任务创建失败");
    if (!data.id || !data.video_id) throw new Error("Agnes 未返回完整的任务 ID 和 video_id，请先核对服务端记录，不要重复提交");
    return { id: data.id, videoId: data.video_id };
}

export function normalizeAgnesVideoSeconds(value: string) {
    const parsed = Math.floor(Number(value));
    const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    return String(Math.max(AGNES_VIDEO_FLASH_LIMITS.minSeconds, Math.min(AGNES_VIDEO_FLASH_LIMITS.maxSeconds, seconds)));
}

export async function pollAgnesVideo(config: AiConfig, videoId: string, options?: Options) {
    const url = new URL(config.baseUrl);
    url.pathname = `${url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "")}/agnesapi`;
    url.search = new URLSearchParams({ video_id: videoId, model_name: config.model }).toString();
    const { data } = await axios.get<AgnesVideo>(withLocalProxy(url.toString()), { headers: headers(config), signal: options?.signal });
    if (data.status === "failed") return { status: "failed" as const, error: data.error?.message || "Agnes 视频生成失败" };
    if (data.status === "completed") {
        const resultUrl = data.metadata?.url || data.url;
        if (!resultUrl) throw new Error("Agnes 已完成但没有返回视频地址，请继续查询");
        return { status: "completed" as const, url: publicMediaUrl(resultUrl) };
    }
    // The live Flash endpoint also returns pending, unlike the documentation's queued example.
    if (data.status !== "queued" && data.status !== "pending" && data.status !== "in_progress") throw new Error(data.error?.message || `Agnes 返回未知任务状态 (${data.status || "空"})，请核对后继续查询`);
    return { status: "pending" as const };
}
