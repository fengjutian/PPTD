import { CircleAlert, CircleCheck, Download, X } from "lucide-react";

import { DesignDirectionDialog } from "../features/ai/DesignDirectionDialog";

import type { AppRuntime } from "./app-runtime";
import { parityIssueLabel } from "./app-shared";

export function ExportDialogs({ app }: { app: AppRuntime }) {
  const {
    exportPreflightOpen,
    exportBusy,
    setExportPreflightOpen,
    revisionLabel,
    document,
    designQualityReport,
    qualityStaleIndexes,
    setDesignQualityReportOpen,
    handleExport,
    directionOptions,
    directionRegenerations,
    directionChoiceRef,
    renderDirectionPreview,
    exportReport,
    setExportReport,
  } = app;

  return (
    <>
      {exportPreflightOpen && !exportBusy && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExportPreflightOpen(false);
          }}
        >
          <section
            className="upload-dialog export-preflight-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-preflight-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <Download />
                <div>
                  <h2 id="export-preflight-title">导出前摘要</h2>
                  <p>本次导出将读取当前不可变文档快照，不会修改项目或撤销栈。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭导出前摘要" onClick={() => setExportPreflightOpen(false)}>
                <X />
              </button>
            </div>
            <dl className="export-preflight-summary">
              <div>
                <dt>文档版本</dt>
                <dd>{revisionLabel}</dd>
              </div>
              <div>
                <dt>内容审核</dt>
                <dd>
                  {document.slides.filter((slide) => slide.content.status === "approved").length}/
                  {document.slides.length} 页已确认
                </dd>
              </div>
              <div>
                <dt>视觉覆盖</dt>
                <dd>
                  {designQualityReport?.visualReviewCoverage
                    ? `${designQualityReport.visualReviewCoverage.reviewed}/${designQualityReport.visualReviewCoverage.total} 页`
                    : "未执行"}
                </dd>
              </div>
              <div>
                <dt>待复检页面</dt>
                <dd>{qualityStaleIndexes.length} 页</dd>
              </div>
              <div>
                <dt>视觉问题</dt>
                <dd>{designQualityReport?.visualReview?.issues.length ?? 0} 条</dd>
              </div>
              <div>
                <dt>确定性问题</dt>
                <dd>{designQualityReport?.issues.length ?? 0} 条</dd>
              </div>
            </dl>
            {qualityStaleIndexes.length > 0 && (
              <p className="design-quality-warning">
                有 {qualityStaleIndexes.length} 页在上次视觉评审后发生变化。可以继续导出，但建议先复检变化页。
              </p>
            )}
            {!designQualityReport?.visualReview && (
              <p className="design-quality-warning">当前没有可追溯的视觉评审结论；导出仍会执行字体、越界和结构预检。</p>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setExportPreflightOpen(false)}>
                返回编辑
              </button>
              {designQualityReport && qualityStaleIndexes.length > 0 && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setExportPreflightOpen(false);
                    setDesignQualityReportOpen(true);
                  }}
                >
                  先复检变化页
                </button>
              )}
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setExportPreflightOpen(false);
                  void handleExport();
                }}
              >
                继续导出 PPTX
              </button>
            </div>
          </section>
        </div>
      )}
      {directionOptions && (
        <DesignDirectionDialog
          options={directionOptions}
          regenerations={directionRegenerations}
          onSelect={(id, words) =>
            directionChoiceRef.current?.({
              kind: "select",
              id,
              ...(words?.trim() ? { words: words.trim() } : {}),
            })
          }
          onSkip={(words) =>
            directionChoiceRef.current?.({
              kind: "skip",
              ...(words?.trim() ? { words: words.trim() } : {}),
            })
          }
          onRetry={() => directionChoiceRef.current?.({ kind: "retry" })}
          renderPages={renderDirectionPreview}
        />
      )}
      {exportReport && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExportReport(undefined);
          }}
        >
          <section
            className="upload-dialog export-report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-report-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <CircleCheck />
                <div>
                  <h2 id="export-report-title">导出报告</h2>
                  <p>
                    {exportReport.slideCount} 页 · {exportReport.nativeObjectCount} 个原生对象
                    {exportReport.nativeChartCount > 0 ? ` · ${exportReport.nativeChartCount} 个原生图表` : ""}
                    {exportReport.nativeTableCount > 0 ? ` · ${exportReport.nativeTableCount} 个原生表格` : ""}
                    {exportReport.nativeGroupCount > 0 ? ` · ${exportReport.nativeGroupCount} 个原生组合` : ""}
                    {exportReport.nativeGroupSkipped > 0 ? ` · ${exportReport.nativeGroupSkipped} 个分组未成组` : ""} ·
                    ZIP {exportReport.package.entryCount} 个条目
                    {exportReport.masters.length > 0
                      ? ` · ${exportReport.masters.length} 个母版（${exportReport.masters.join("、")}）`
                      : ""}
                    {exportReport.themeColors.length > 0
                      ? ` · 主题色 ${exportReport.themeColors.join("、")}（${exportReport.themeColorReferences} 处对象引用）`
                      : ""}
                    {exportReport.nativeAnimationCount > 0 ? ` · ${exportReport.nativeAnimationCount} 个原生动画` : ""}
                    {exportReport.nativeAnimationSkipped > 0
                      ? ` · ${exportReport.nativeAnimationSkipped} 个动画未写入`
                      : ""}
                    {exportReport.nativeTransitionCount > 0
                      ? ` · ${exportReport.nativeTransitionCount} 页原生切换`
                      : ""}
                    {exportReport.tasteLint
                      ? ` · 体检 ${exportReport.tasteLint.hard} 硬底线 / ${exportReport.tasteLint.soft} 提示`
                      : " · 体检未执行"}
                    {exportReport.templateFit
                      ? exportReport.templateFit.checked
                        ? ` · 模板符合度 ${exportReport.templateFit.score}/100${exportReport.templateFit.passed ? "" : "（未达标）"}`
                        : " · 模板符合度未执行"
                      : ""}
                    {exportReport.parity
                      ? exportReport.parity.passed
                        ? ` · 回读 ${exportReport.parity.checked.slides} 页通过`
                        : ` · 回读 ${exportReport.parity.issues.length} 处不一致`
                      : " · 回读未执行"}
                    {exportReport.assetProvenance.verified +
                      exportReport.assetProvenance.pending +
                      exportReport.assetProvenance.user +
                      exportReport.assetProvenance.missing >
                    0
                      ? ` · 素材 已核验 ${exportReport.assetProvenance.verified} / 待核验 ${exportReport.assetProvenance.pending} / 未标注 ${exportReport.assetProvenance.missing}`
                      : ""}
                  </p>
                </div>
              </div>
              <button type="button" aria-label="关闭导出报告" onClick={() => setExportReport(undefined)}>
                <X />
              </button>
            </div>
            {exportReport.issues.length === 0 ? (
              <div className="template-empty">未发现导出问题</div>
            ) : (
              <ul className="export-report-list">
                {exportReport.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.slideIndex}-${issue.elementId ?? index}`} className={issue.severity}>
                    <CircleAlert />
                    <div>
                      <strong>
                        {issue.severity === "error" ? "错误" : "提示"} · 第 {issue.slideIndex + 1} 页
                      </strong>
                      <p>{issue.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {exportReport.parity && !exportReport.parity.passed && (
              <ul className="export-report-list">
                {exportReport.parity.issues.slice(0, 12).map((issue, index) => (
                  <li key={`parity-${issue.slideIndex}-${issue.kind}-${index}`} className="warning">
                    <CircleAlert />
                    <div>
                      <strong>回读不一致 · 第 {issue.slideIndex + 1} 页</strong>
                      <p>
                        {parityIssueLabel(issue.kind)}：期望 {String(issue.expected)}，实际 {String(issue.actual)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setExportReport(undefined)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
