import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { Position } from "@/types/canvas";

export function CanvasEditorOverlay({ anchor, title, onClose, children }: {
    anchor: Position; title: string; onClose: () => void; children: ReactNode;
}) {
    const ref = useRef<HTMLElement>(null);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [position, setPosition] = useState({ x: 0, y: 0 });
    useLayoutEffect(() => {
        const panel = ref.current;
        if (!panel) return;
        const place = () => {
            const parent = panel.parentElement!.getBoundingClientRect();
            const box = panel.getBoundingClientRect();
            const top = parent.width < 768 ? 100 : 64;
            const left = 64;
            setPosition({
                x: Math.max(left, Math.min(anchor.x - box.width / 2, parent.width - box.width - 12)),
                y: Math.max(top, Math.min(anchor.y + 16, parent.height - box.height - 138)),
            });
        };
        const observer = new ResizeObserver(place);
        observer.observe(panel);
        observer.observe(panel.parentElement!);
        place();
        return () => observer.disconnect();
    }, [anchor.x, anchor.y]);
    return (
        <section ref={ref} aria-label={`${title}编辑器`} data-canvas-no-zoom
            className="canvas-editor-overlay absolute z-[65] overflow-y-auto rounded-lg border shadow-lg"
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke }}
            onPointerDown={(event) => event.stopPropagation()}>
            <header className="flex h-8 items-center justify-between border-b px-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                <span className="truncate">{title}</span>
                <button type="button" aria-label="关闭节点编辑器" title="关闭节点编辑器" className="grid size-7 shrink-0 place-items-center" onClick={onClose}><X size={14} /></button>
            </header>
            {children}
        </section>
    );
}
