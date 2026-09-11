import { useLayoutEffect, useRef, useState } from "react";
import type { Position } from "@/types/canvas";

export function useCanvasMenu(anchor: Position, onClose: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState(anchor);
    useLayoutEffect(() => {
        const menu = ref.current;
        if (!menu) return;
        const previousFocus = document.activeElement;
        const place = () => {
            const box = menu.getBoundingClientRect();
            setPosition({
                x: Math.max(8, Math.min(anchor.x, window.innerWidth - box.width - 8)),
                y: Math.max(8, Math.min(anchor.y, window.innerHeight - box.height - 8)),
            });
        };
        const outside = (event: PointerEvent) => {
            if (!menu.contains(event.target as Node)) onClose();
        };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        place();
        menu.focus();
        const observer = new ResizeObserver(place);
        observer.observe(menu);
        window.addEventListener("resize", place);
        document.addEventListener("pointerdown", outside, true);
        menu.addEventListener("keydown", keyboard);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", place);
            document.removeEventListener("pointerdown", outside, true);
            menu.removeEventListener("keydown", keyboard);
            if (menu.contains(document.activeElement) && previousFocus instanceof HTMLElement) previousFocus.focus();
        };
    }, [anchor.x, anchor.y, onClose]);
    return { ref, position };
}
