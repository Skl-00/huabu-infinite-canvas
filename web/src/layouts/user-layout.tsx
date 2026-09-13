import { useEffect, type ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { initializeImageRuns } from "@/stores/use-image-run-store";
import { initializeVideoRuns } from "@/services/video-runner";
import { initializeAudioRuns } from "@/services/audio-runner";
import { initializeTextRuns } from "@/stores/use-text-run-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    useEffect(() => {
        const refresh = () => {
            void initializeImageRuns().catch(() => undefined);
            void initializeVideoRuns().catch(() => undefined);
            void initializeAudioRuns().catch(() => undefined);
            void initializeTextRuns().catch(() => undefined);
        };
        refresh();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, []);
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
