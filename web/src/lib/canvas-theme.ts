export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f3f5f6",
            dot: "rgba(72,82,94,.24)",
            line: "rgba(72,82,94,.09)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#535b65",
            fill: "#edf0f2",
            panel: "#ffffff",
            stroke: "#d7dce1",
            activeStroke: "#168c80",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(255,255,255,.97)",
            border: "#d7dce1",
            item: "#535b65",
            itemHover: "#edf0f2",
            activeBg: "#dbeeea",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#17191c",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#25282d",
            panel: "#202327",
            stroke: "#3c4249",
            activeStroke: "#59c8b5",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        toolbar: {
            panel: "rgba(32,35,39,.97)",
            border: "#3c4249",
            item: "#d6d3d1",
            itemHover: "#30353b",
            activeBg: "#29473f",
            activeText: "#f5f5f4",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
