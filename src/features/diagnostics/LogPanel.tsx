import { Check, Copy, RefreshCw, ScrollText, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLogRecord } from "../../services/app-log";
import { createTranslator, type UiLanguage } from "../../services/i18n";
import { formatLogRecords } from "./log-text";
import { formatLogTime } from "./log-time";

type CopyState = "idle" | "copied" | "failed";

/** 复制结果只在按钮上停留一会儿，避免一条旧提示一直挂着。 */
const COPY_FEEDBACK_MS = 2_000;

export interface LogPanelProps {
  language: UiLanguage;
  records: AppLogRecord[];
  loading: boolean;
  /** 日志文件的绝对路径；浏览器预览或读取失败时为 undefined。 */
  location?: string;
  onRefresh: () => void;
  onClose: () => void;
}

export type LogViewerProps = Omit<LogPanelProps, "onClose">;

/**
 * 诊断日志面板。
 *
 * 只读视图：失败记录按时间倒序排列，最新一条在最上面。这里不做过滤、不做
 * 聚合，一条记录一行，因为它存在的意义是让用户和开发者看到原始的错误码与
 * 阶段，而不是再翻译一次。
 */
export function LogViewer({ language, records, loading, location, onRefresh }: LogViewerProps) {
  const t = useMemo(() => createTranslator(language), [language]);
  const ordered = useMemo(() => [...records].reverse(), [records]);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyDisabled = loading || ordered.length === 0;
  const copyLogs = useCallback(async () => {
    if (copyDisabled) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(formatLogRecords(ordered, location));
      setCopyState("copied");
    } catch {
      // 浏览器预览没有剪贴板权限时也要给用户一个明确的失败提示。
      setCopyState("failed");
    }
  }, [copyDisabled, location, ordered]);

  return (
    <div className="diagnostics-viewer">
        <div className="diagnostics-meta">
          <button type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? t("diagnostics.panel.loading") : t("diagnostics.panel.refresh")}
          </button>
          <button
            type="button"
            className={`diagnostics-copy diagnostics-copy-${copyState}`}
            title={t("diagnostics.panel.copyTitle")}
            onClick={() => void copyLogs()}
            disabled={copyDisabled}
          >
            {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            {copyState === "copied"
              ? t("diagnostics.panel.copied")
              : copyState === "failed"
                ? t("diagnostics.panel.copyFailed")
                : t("diagnostics.panel.copy")}
          </button>
          <code className="diagnostics-location">{location ?? t("diagnostics.panel.unavailable")}</code>
        </div>
        {ordered.length === 0 ? (
          <p className="diagnostics-empty">{loading ? t("diagnostics.panel.loading") : t("diagnostics.panel.empty")}</p>
        ) : (
          <ul className="diagnostics-list">
            {ordered.map((record, index) => (
              <li key={`${record.at}-${index}`} className={`diagnostics-entry diagnostics-${record.level}`}>
                <div className="diagnostics-entry-head">
                  <span className="diagnostics-time">{formatLogTime(record.at)}</span>
                  <span className="diagnostics-level">{record.level}</span>
                  <code>{record.code}</code>
                </div>
                <p>{record.message}</p>
                {record.context && <pre>{JSON.stringify(record.context)}</pre>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function LogPanel({ language, records, loading, location, onRefresh, onClose }: LogPanelProps) {
  const t = useMemo(() => createTranslator(language), [language]);
  return (
    <div className="upload-dialog-backdrop" role="presentation">
      <section
        className="upload-dialog diagnostics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <ScrollText />
            <div>
              <h2 id="diagnostics-title">{t("diagnostics.panel.title")}</h2>
              <p>{t("diagnostics.panel.description")}</p>
            </div>
          </div>
          <button type="button" aria-label={t("diagnostics.panel.close")} onClick={onClose}>
            <X />
          </button>
        </div>
        <LogViewer
          language={language}
          records={records}
          loading={loading}
          location={location}
          onRefresh={onRefresh}
        />
      </section>
    </div>
  );
}
