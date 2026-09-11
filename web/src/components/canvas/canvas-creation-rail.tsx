import { Tooltip } from "antd";
import { BookOpen, FolderOpen, Group, Image, Music2, Settings2, Type, Upload, Video } from "lucide-react";
import { CanvasNodeType } from "@/types/canvas";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";

const tools = [
    { type: CanvasNodeType.Text, label: "文本", Icon: Type },
    { type: CanvasNodeType.Image, label: "图片", Icon: Image },
    { type: CanvasNodeType.Video, label: "视频", Icon: Video },
    { type: CanvasNodeType.Audio, label: "音频", Icon: Music2 },
    { type: CanvasNodeType.Config, label: "配置", Icon: Settings2 },
    { type: CanvasNodeType.Group, label: "分组", Icon: Group },
];

export function CanvasCreationRail({ onCreate, onUpload }: { onCreate: (type: CanvasNodeType) => void; onUpload: () => void }) {
    const openPanel = useCanvasSidePanelStore((state) => state.openPanel);
    const setTab = useCanvasSidePanelStore((state) => state.setTab);
    return (
        <nav className="canvas-creation-rail" aria-label="创建工具" data-canvas-no-zoom>
            {tools.map(({ type, label, Icon }) => (
                <Tooltip key={type} title={label} placement="right">
                    <button type="button" aria-label={label} onClick={() => onCreate(type)}><Icon size={18} /></button>
                </Tooltip>
            ))}
            <span className="canvas-rail-divider" />
            <Tooltip title="导入素材" placement="right">
                <button type="button" aria-label="导入素材" onClick={onUpload}><Upload size={18} /></button>
            </Tooltip>
            <Tooltip title="素材库" placement="right">
                <button type="button" aria-label="素材库" onClick={() => { setTab("assets"); openPanel(); }}><FolderOpen size={18} /></button>
            </Tooltip>
            <Tooltip title="提示词库" placement="right">
                <button type="button" aria-label="提示词库" onClick={() => { setTab("prompts"); openPanel(); }}><BookOpen size={18} /></button>
            </Tooltip>
        </nav>
    );
}
