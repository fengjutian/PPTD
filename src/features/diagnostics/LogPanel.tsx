import { RefreshCw, ScrollText, X } from "lucide-react";
import { useMemo } from "react";
import type { AppLogRecord } from "../../services/app-log";
import { createTranslator, type UiLanguage } from "../../services/i18n";

export interface LogPanelProps {
  language: UiLanguage;
  records: AppLogRecord[];
  loading: boolean;
  /** 日志文件的绝对路径；浏览器预览或读取失败时为 undefined。 */
  location?: string;
  onRefresh: () => void;
  onClose: () => void;
}

/** 时间按本地时区显示；解析不了就原样显示，不吞掉原始值。 */
export function formatLogTime(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 诊断日志面板。
 *
 * 只读视图：失败记录按时间倒序排列，最新一条在最上面。这里不做过滤、不做
 * 聚合，一条记录一行，因为它存在的意义是让用户和开发者看到原始的错误码与
 * 阶段，而不是再翻译一次。
 */
export function LogPanel({ language, records, loading, location, onRefresh, onClose }: LogPanelProps) {
  const t = useMemo(() => createTranslator(language), [language]);
  const ordered = useMemo(() => [...records].reverse(), [records]);
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
        <div className="diagnostics-meta">
          <button type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? t("diagnostics.panel.loading") : t("diagnostics.panel.refresh")}
          </button>
          <code className="diagnostics-location">
            {location ?? t("diagnostics.panel.unavailable")}
          </code>
        </div>
        {ordered.length === 0 ? (
          <p className="diagnostics-empty">
            {loading ? t("diagnostics.panel.loading") : t("diagnostics.panel.empty")}
          </p>
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
      </section>
    </div>
  );
}
