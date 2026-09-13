import { Alert, App, Button, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, Download, HardDrive, Layers3, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { exportLocalBackup, importLocalBackup } from "@/services/local-backup";
import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const backupInputRef = useRef<HTMLInputElement>(null);
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [backupBusy, setBackupBusy] = useState(false);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setUsage(await readLocalStorageUsage());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const indexedDbBytes = usage?.contentBytes ?? 0;
    const percent = usage ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

    const exportBackup = async () => {
        setBackupBusy(true);
        try {
            const result = await exportLocalBackup();
            message.success(t("config.localStorage.backup.exported", result));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.backup.exportFailed"));
        } finally {
            setBackupBusy(false);
        }
    };

    const confirmImport = (file: File) => {
        modal.confirm({
            title: t("config.localStorage.backup.importTitle"),
            content: t("config.localStorage.backup.importDescription"),
            okText: t("config.localStorage.backup.import"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
                setBackupBusy(true);
                try {
                    const result = await importLocalBackup(file);
                    message.success(t("config.localStorage.backup.imported", result));
                    await refresh();
                } catch (reason) {
                    message.error(reason instanceof Error ? reason.message : t("config.localStorage.backup.importFailed"));
                    throw reason;
                } finally {
                    setBackupBusy(false);
                }
            },
        });
    };

    return (
        <div className="space-y-3">
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />
                            {t("config.localStorage.title")}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">{t("config.localStorage.description")}</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        {t("config.localStorage.refresh")}
                    </Button>
                </div>
                <div className="mt-4 rounded-lg border border-dashed border-stone-300 p-3 dark:border-stone-700">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">{t("config.localStorage.backup.title")}</div>
                            <div className="mt-1 text-xs leading-5 text-stone-500">{t("config.localStorage.backup.description")}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <Button icon={<Upload className="size-4" />} loading={backupBusy} disabled={backupBusy} onClick={() => backupInputRef.current?.click()}>
                                {t("config.localStorage.backup.import")}
                            </Button>
                            <Button type="primary" icon={<Download className="size-4" />} loading={backupBusy} disabled={backupBusy} onClick={() => void exportBackup()}>
                                {t("config.localStorage.backup.export")}
                            </Button>
                            <input
                                ref={backupInputRef}
                                type="file"
                                accept=".zip,application/zip"
                                aria-label={t("config.localStorage.backup.import")}
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) confirmImport(file);
                                    event.target.value = "";
                                }}
                            />
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-stone-500">{t("config.localStorage.backup.security")}</div>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message={t("config.localStorage.readFailed")} description={error} /> : null}
                {!usage && loading ? (
                    <div className="flex min-h-48 items-center justify-center"><Spin /></div>
                ) : usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.indexedDbUsage")} value={formatStorageBytes(indexedDbBytes)} hint={t("config.localStorage.contentEstimate")} />
                            <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.siteUsage")} value={formatStorageBytes(usage.usage)} hint={t("config.localStorage.siteUsageHint")} />
                            <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.quota")} value={formatStorageBytes(usage.quota)} hint={t("config.localStorage.quotaHint")} />
                        </div>
                        <div className="mt-4">
                            <div className="mb-1 flex justify-between text-xs text-stone-500">
                                <span>{t("config.localStorage.quotaProgress")}</span>
                                <span className="tabular-nums">{percent.toFixed(2)}%</span>
                            </div>
                            <Progress percent={percent} showInfo={false} />
                        </div>
                    </>
                ) : null}
            </section>
            {usage?.databases.map((database) => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{database.name} · v{database.version}</div>
                        </div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map((store) => (
                            <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{storeLabel(store.name, t)}</div>
                                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{store.name}</div>
                                </div>
                                <div className="text-right text-xs text-stone-500 tabular-nums">{t("config.localStorage.records", { count: store.records })}</div>
                                <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(store.bytes)}</div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
