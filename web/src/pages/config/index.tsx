import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <main className="workspace-page">
            <div className="workspace-content">
                <div className="workspace-page-heading">
                    <div>
                        <p className="workspace-eyebrow">{t("config.title")}</p>
                        <h1>{t("config.title")}</h1>
                        <p className="workspace-page-description">{t("config.description")}</p>
                    </div>
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
