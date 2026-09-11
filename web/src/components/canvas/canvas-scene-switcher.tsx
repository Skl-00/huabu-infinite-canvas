import { useState } from "react";
import { App, Button, Dropdown, Input, Modal, Select, Tooltip } from "antd";
import { Copy, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { sceneKinds, workspaceProjects, type SceneKind } from "@/lib/canvas/canvas-workspaces";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function CanvasSceneSwitcher({ projectId, busy, onNavigate, onSave }: {
    projectId: string; busy: boolean; onNavigate: (id: string) => void; onSave: () => void;
}) {
    const { modal } = App.useApp();
    const projects = useCanvasStore((state) => state.projects);
    const project = projects.find((item) => item.id === projectId);
    const [renameOpen, setRenameOpen] = useState(false);
    const [title, setTitle] = useState("");
    if (!project) return null;
    const scenes = workspaceProjects(projects, project);
    const create = (kind: SceneKind, duplicate = false) => {
        if (busy) return;
        onSave();
        const id = useCanvasStore.getState().createScene(projectId, kind, duplicate);
        if (id) onNavigate(id);
    };
    const isMaster = (project.workspaceId || project.id) === project.id;
    return (
        <div className="canvas-scene-switcher" data-canvas-no-zoom>
            <Layers size={15} className="shrink-0 opacity-60" />
            <Select
                aria-label="工作画布"
                disabled={busy}
                variant="borderless"
                value={project.id}
                className="min-w-0 flex-1"
                popupMatchSelectWidth={false}
                options={scenes.map((scene) => ({ value: scene.id, label: scene.sceneTitle || "主画布" }))}
                onChange={onNavigate}
            />
            <Dropdown trigger={["click"]} disabled={busy} menu={{
                items: sceneKinds.map((kind) => ({ key: kind.value, label: kind.label, onClick: () => create(kind.value) })),
            }}>
                <Button type="text" aria-label="添加工作画布" disabled={busy} icon={<Plus size={16} />} />
            </Dropdown>
            <Dropdown trigger={["click"]} disabled={busy} menu={{ items: [
                { key: "rename", icon: <Pencil size={14} />, label: "重命名画布", onClick: () => {
                    setTitle(project.sceneTitle || "主画布"); setRenameOpen(true);
                } },
                { key: "copy", icon: <Copy size={14} />, label: "复制工作画布", onClick: () => create(project.sceneKind === "master" ? "custom" : project.sceneKind || "custom", true) },
                { key: "delete", icon: <Trash2 size={14} />, label: "删除工作画布", danger: true, disabled: isMaster, onClick: () => modal.confirm({
                    title: `删除「${project.sceneTitle || project.title}」？`,
                    content: "此画布的节点和连线将被删除，项目内其他画布保留。",
                    okText: "删除画布", cancelText: "取消", okButtonProps: { danger: true },
                    onOk: () => {
                        if (busy) return;
                        useCanvasStore.getState().deleteProjects([projectId]);
                        onNavigate(project.workspaceId!);
                    },
                }) },
            ] }}>
                <Button type="text" aria-label="工作画布菜单" disabled={busy} icon={<MoreHorizontal size={16} />} />
            </Dropdown>
            <Tooltip title={busy ? "生成中，暂不可切换画布" : `${scenes.length} 张工作画布`}>
                <span className="hidden text-xs tabular-nums opacity-45 sm:inline">{scenes.length}</span>
            </Tooltip>
            <Modal open={renameOpen} title="重命名画布" onCancel={() => setRenameOpen(false)}
                okText="保存" okButtonProps={{ "aria-label": "保存" }} cancelText="取消" onOk={() => {
                    if (!title.trim()) return;
                    useCanvasStore.getState().renameScene(projectId, title);
                    setRenameOpen(false);
                }}>
                <Input aria-label="画布名称" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
            </Modal>
        </div>
    );
}
