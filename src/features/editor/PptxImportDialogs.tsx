import { CircleAlert, FileText, FileUp, ShieldCheck, X } from "lucide-react";
import type { ImportReport } from "../../core/commands/pptx-import";

export function ImportModeDialog({
  fileName,
  busy,
  progress,
  onCancelImport,
  onClose,
  onImportContent,
  onExtractTemplate,
}: {
  fileName: string;
  busy: boolean;
  progress?: { current: number; total: number };
  onCancelImport?: () => void;
  onClose: () => void;
  onImportContent: () => void;
  onExtractTemplate: () => void;
}) {
  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog import-mode-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-mode-title"
        aria-busy={busy}
      >
        <div className="upload-dialog-heading">
          <div>
            <FileUp />
            <div>
              <h2 id="import-mode-title">打开 PowerPoint 文件</h2>
              <p>{fileName}</p>
            </div>
          </div>
          <button type="button" aria-label="关闭导入" onClick={onClose} disabled={busy}>
            <X />
          </button>
        </div>
        <div className="import-mode-options">
          <button type="button" className="import-mode-option" disabled={busy} onClick={onImportContent}>
            <FileText />
            <span>
              <strong>导入内容（Level A）</strong>
              <small>页面尺寸与顺序、文字、图片、基础形状和基础表格；不支持的对象会逐项报告。</small>
            </span>
          </button>
          <button type="button" className="import-mode-option" disabled={busy} onClick={onExtractTemplate}>
            <ShieldCheck />
            <span>
              <strong>仅提取模板主题</strong>
              <small>只读取主题色、字体、母版和版式，不导入幻灯片内容。</small>
            </span>
          </button>
        </div>
        {busy && (
          <div className="import-mode-progress" role="status">
            <span>
              {progress && progress.total > 0
                ? `正在解析第 ${progress.current} / ${progress.total} 页…`
                : "正在解析文件并生成可编辑页面，请稍候…"}
            </span>
            {progress && (
              <div
                className="import-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total || 1}
                aria-valuenow={progress.current}
              >
                <i style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
              </div>
            )}
            {onCancelImport && (
              <button type="button" className="secondary-action" onClick={onCancelImport}>
                取消导入
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function ImportReportDialog({
  fileName,
  report,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  report: ImportReport;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const issues = [...report.unsupported];
  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="upload-dialog import-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-report-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <FileUp />
            <div>
              <h2 id="import-report-title">导入报告</h2>
              <p>{fileName}</p>
            </div>
          </div>
          <button type="button" aria-label="关闭导入报告" onClick={onCancel}>
            <X />
          </button>
        </div>
        <dl className="import-report-summary">
          <div>
            <dt>兼容等级</dt>
            <dd>Level {report.compatibility}</dd>
          </div>
          <div>
            <dt>页面</dt>
            <dd>{report.slideCount} 页</dd>
          </div>
          <div>
            <dt>文本 / 图片</dt>
            <dd>
              {report.counts.text} / {report.counts.image}
            </dd>
          </div>
          <div>
            <dt>形状 / 表格</dt>
            <dd>
              {report.counts.shape} / {report.counts.table}
            </dd>
          </div>
          <div>
            <dt>图表</dt>
            <dd>{report.counts.chart ?? 0}</dd>
          </div>
        </dl>
        {issues.length > 0 && (
          <div className="import-report-issues">
            <h3>未导入或不完整的内容</h3>
            <ul>
              {issues.slice(0, 20).map((issue, index) => (
                <li key={`${issue.slideIndex}-${issue.kind}-${index}`}>
                  <CircleAlert />
                  <span>
                    <strong>
                      第 {issue.slideIndex + 1} 页 · {issue.kind}
                    </strong>
                    {issue.detail}
                  </span>
                </li>
              ))}
            </ul>
            {issues.length > 20 && <p>另有 {issues.length - 20} 条记录未展开。</p>}
          </div>
        )}
        {report.warnings.length > 0 && (
          <div className="import-report-warnings">
            <h3>提示</h3>
            <ul>
              {report.warnings.slice(0, 10).map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="import-report-note">导入内容是未审核状态；源文件不会被修改。确认后请另存为新的 .pptd 项目。</p>
        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary-action" onClick={onConfirm}>
            导入到编辑器
          </button>
        </div>
      </section>
    </div>
  );
}
