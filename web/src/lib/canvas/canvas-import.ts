import { nanoid } from "nanoid";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";

export async function readCanvasArchive(file: File) {
    const zip = await readZip(file);
    const manifest = zip.get("projects.json");
    if (!manifest) throw new Error("Missing projects.json");
    const data = JSON.parse(await manifest.text()) as CanvasExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 3 || !Array.isArray(data.projects) || !data.projects.length)
        throw new Error("Unsupported canvas archive");
    const projectIds = new Set<string>();
    const fileKeys = new Map<string, string>();
    // Validate the complete archive before storing any media or adding projects.
    for (const item of data.projects) {
        const project = item.project;
        if (!project || !project.id || projectIds.has(project.id) || !Array.isArray(project.nodes) || !Array.isArray(project.connections) || !Array.isArray(item.files))
            throw new Error("Invalid or duplicate canvas");
        projectIds.add(project.id);
        const nodeIds = new Set<string>();
        for (const node of project.nodes) {
            if (!node.id || nodeIds.has(node.id) || typeof node.type !== "string" || !node.position
                || ![node.position.x, node.position.y, node.width, node.height].every(Number.isFinite))
                throw new Error("Invalid node");
            nodeIds.add(node.id);
        }
        if (project.connections.some((edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)))
            throw new Error("Dangling connection");
        for (const asset of item.files) {
            if (!zip.has(asset.path) || typeof asset.storageKey !== "string") throw new Error("Missing media");
            if (!fileKeys.has(asset.storageKey)) fileKeys.set(asset.storageKey, `${asset.storageKey.split(":")[0]}:${nanoid()}`);
        }
    }
    const rewriteKeys = (value: unknown): unknown => {
        if (typeof value === "string") return fileKeys.get(value) || value;
        if (Array.isArray(value)) return value.map(rewriteKeys);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteKeys(child)]));
        return value;
    };
    for (const item of data.projects) {
        for (const asset of item.files) {
            const blob = zip.get(asset.path)!;
            const typedBlob = blob.slice(0, blob.size, asset.mimeType);
            const key = fileKeys.get(asset.storageKey)!;
            await (key.startsWith("image:") ? setImageBlob(key, typedBlob) : setMediaBlob(key, typedBlob));
        }
    }
    return data.projects.map((item) => rewriteKeys(item.project) as typeof item.project);
}
