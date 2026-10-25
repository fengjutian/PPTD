import { useState } from "react";
import { ArrowRight, Check, CircleAlert, FileUp, Palette, Sparkles, X } from "lucide-react";

import { THEME_PRESETS, findThemePreset } from "../core/design/theme-presets";
import { VariantGalleryDialog } from "../features/ai/VariantGalleryDialog";

import type { AppRuntime } from "./app-runtime";
import { visualIssueLabels, templateFitLabels, reviewEvidenceLabel, formatElapsed } from "./app-shared";

export function TemplateDialogs({ app }: { app: AppRuntime }) {
  const {
    templateUploadOpen,
    setTemplateUploadOpen,
    handleChooseTemplate,
    templatePickerOpen,
    designBusy,
    setTemplatePickerOpen,
    themePresetId,
    recommendedThemePreset,
    recommendedThemeReason,
    handleSelectThemePreset,
    templateLibrary,
    selectedTemplate,
    handleSelectTemplate,
    designProgress,
    designDetail,
    designElapsed,
    pickerThemePreset,
    aiDraft,
    pickerThemeGuidance,
    templatePreviewBusy,
    templatePreview,
    templateAnalysis,
    generateFromDraft,
    variantOptions,
    variantBatch,
    generateVariantBatch,
    chooseVariant,
    discardVariantBatch,
    cancelVariantBatch,
    designQualityReport,
    designQualityReportOpen,
    setDesignQualityReportOpen,
    manualReviewBusy,
    runManualReview,
    cancelManualReview,
    qualityStaleIndexes,
    openQualityTarget,
    refreshTemplateTarget,
    clearTemplateTarget,
    document,
    setDesignQualityReport,
    setActiveView,
    setEditorSurface,
  } = app;

  const [variantCount, setVariantCount] = useState(8);
  const batchRunning = designBusy && variantBatch !== undefined;

  return (
    <>
      {templateUploadOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTemplateUploadOpen(false);
          }}
        >
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-template-title">
            <div className="upload-dialog-heading">
              <div>
                <FileUp />
                <div>
                  <h2 id="upload-template-title">从 PPT 抽取主题</h2>
                  <p>PPTD 将解析主题色、字体、母版和版式，并保存为可复用主题。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭上传窗口" onClick={() => setTemplateUploadOpen(false)}>
                <X />
              </button>
            </div>
            <button type="button" className="template-dropzone" onClick={() => void handleChooseTemplate()}>
              <FileUp />
              <strong>选择 PPTX 文件</strong>
              <span>从电脑中选择一份设计风格参考</span>
              <small>支持 .pptx，最大 512 MB</small>
            </button>
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setTemplateUploadOpen(false)}>
                取消
              </button>
            </div>
          </section>
        </div>
      )}
      {templatePickerOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (!designBusy && event.target === event.currentTarget) setTemplatePickerOpen(false);
          }}
        >
          <section
            className="upload-dialog template-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-picker-title"
            aria-busy={designBusy}
          >
            <div className="upload-dialog-heading">
              <div>
                <Palette />
                <div>
                  <h2 id="template-picker-title">选择主题模板</h2>
                  <p>使用内置主题，或从已有 PPT 抽取设计语言，AI 不会改动已确认内容。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭模板选择窗口" onClick={() => setTemplatePickerOpen(false)}>
                <X />
              </button>
            </div>
            <div className="template-picker-toolbar">
              <strong>主题来源</strong>
              <span>
                {themePresetId
                  ? `内置 · ${findThemePreset(themePresetId)?.name ?? "主题"}${themePresetId === recommendedThemePreset.id ? "（AI 推荐）" : ""}`
                  : "已上传 PPT"}
              </span>
            </div>
            <div className="template-picker-batch">
              <div className="template-picker-batch-copy">
                <Sparkles />
                <div>
                  <strong>不想选也行：让 AI 按内容挑 {variantCount} 套模板，一次排完再对比</strong>
                  <small>
                    {batchRunning && variantBatch
                      ? `已完成 ${variantBatch.completed}/${variantBatch.total}${
                          variantBatch.failed > 0 ? `，${variantBatch.failed} 个失败` : ""
                        }`
                      : "每版都是完整排版，选定一版后其余丢弃；内容不会变，约需几分钟。"}
                  </small>
                </div>
              </div>
              <div className="template-picker-batch-controls">
                <label htmlFor="variant-count">
                  版本数
                  <select
                    id="variant-count"
                    value={variantCount}
                    disabled={designBusy}
                    onChange={(event) => setVariantCount(Number(event.target.value))}
                  >
                    {[4, 6, 8].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                {batchRunning ? (
                  <button type="button" className="batch-cancel" onClick={cancelVariantBatch}>
                    停止生成
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!aiDraft || designBusy}
                    onClick={() => void generateVariantBatch(variantCount)}
                  >
                    <Sparkles size={13} />
                    生成 {variantCount} 个版本
                  </button>
                )}
              </div>
            </div>
            <div className="template-picker-body">
              <div className="template-picker-sources">
                <section>
                  <div className="template-picker-section-heading">
                    <strong>内置主题</strong>
                    <span>{THEME_PRESETS.length} 套</span>
                  </div>
                  <div className="template-picker-preset-list">
                    {THEME_PRESETS.map((preset) => {
                      const color = (slot: string) => preset.theme.colors.find((item) => item.name === slot)?.value;
                      return (
                        <button
                          type="button"
                          disabled={designBusy}
                          className={`template-picker-preset${themePresetId === preset.id ? " active" : ""}`}
                          key={preset.id}
                          onClick={() => handleSelectThemePreset(preset.id, false)}
                          style={{ "--preset-accent": color("accent") } as React.CSSProperties}
                        >
                          <span className="template-picker-preset-colors" aria-hidden>
                            {["surface", "accent", "accent2", "accent3"].map((slot) => (
                              <i key={slot} style={{ background: color(slot) }} />
                            ))}
                          </span>
                          <span>
                            <strong>{preset.name}</strong>
                            <small>{preset.description}</small>
                          </span>
                          {preset.id === recommendedThemePreset.id && <em>AI 推荐</em>}
                          {themePresetId === preset.id && <Check />}
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section>
                  <div className="template-picker-section-heading">
                    <strong>从 PPT 抽取</strong>
                    <span>{templateLibrary.length} 套</span>
                  </div>
                  <div className="template-picker-upload-list">
                    {templateLibrary.map((template) => (
                      <button
                        type="button"
                        disabled={designBusy}
                        className={`template-card${selectedTemplate?.id === template.id ? " active" : ""}`}
                        key={template.id}
                        onClick={() => void handleSelectTemplate(template, false)}
                      >
                        <FileUp />
                        <span>
                          <strong>{template.name}</strong>
                          <small>
                            {(template.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                            {new Date(template.importedAt).toLocaleString("zh-CN")}
                          </small>
                        </span>
                        {selectedTemplate?.id === template.id && <Check />}
                      </button>
                    ))}
                    {templateLibrary.length === 0 && <div className="template-empty">尚未抽取 PPT 主题</div>}
                  </div>
                </section>
              </div>
              <div className="template-preview-panel">
                <div
                  className={`template-preview-stage ${designBusy ? "generating" : ""}${themePresetId ? " preset-selected" : ""}`}
                >
                  {designBusy ? (
                    <div className="design-progress" role="status" aria-live="polite">
                      <Sparkles />
                      <strong>{designProgress.label}</strong>
                      <span>{designProgress.percent}%</span>
                      <div
                        className="design-progress-track"
                        aria-label="AI 生成进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={designProgress.percent}
                        role="progressbar"
                      >
                        <i style={{ width: `${designProgress.percent}%` }} />
                      </div>
                      <p className="design-progress-detail">
                        {designDetail ? `${designDetail} · ` : ""}已用时 {formatElapsed(designElapsed)}
                      </p>
                      <small>设计阶段按模型流式写出的页数推进，校验与渲染按真实节点更新</small>
                      <small>任务已在后台执行，可以关闭此窗口并继续编辑。</small>
                    </div>
                  ) : themePresetId ? (
                    <div
                      className="theme-preset-preview picker-preset-preview"
                      style={
                        {
                          "--theme-primary": pickerThemePreset.theme.colors.find((color) => color.name === "primary")
                            ?.value,
                          "--theme-accent": pickerThemePreset.theme.colors.find((color) => color.name === "accent")
                            ?.value,
                          "--theme-muted": pickerThemePreset.theme.colors.find((color) => color.name === "muted")
                            ?.value,
                          "--theme-surface": pickerThemePreset.theme.colors.find((color) => color.name === "surface")
                            ?.value,
                          "--theme-major-font": pickerThemePreset.theme.majorFont,
                          "--theme-minor-font": pickerThemePreset.theme.minorFont,
                        } as React.CSSProperties
                      }
                    >
                      <span className="theme-preview-kicker">PPTD · {pickerThemePreset.name}</span>
                      <div>
                        <h2>{aiDraft?.title ?? pickerThemePreset.name}</h2>
                        <p>{pickerThemeGuidance.character}</p>
                      </div>
                      <div className="theme-preview-bars">
                        <i />
                        <i />
                        <i />
                      </div>
                      <small>{pickerThemeGuidance.pageRhythm}</small>
                    </div>
                  ) : templatePreviewBusy ? (
                    <span>正在解析模板…</span>
                  ) : templatePreview ? (
                    <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} />
                  ) : selectedTemplate ? (
                    <span>此 PPTX 没有内嵌封面预览</span>
                  ) : (
                    <span>选择左侧模板后查看预览</span>
                  )}
                </div>
                {themePresetId ? (
                  <div className="picker-theme-details">
                    <div className="theme-scenario-tags">
                      {pickerThemeGuidance.scenarios.map((scenario) => (
                        <span key={scenario}>{scenario}</span>
                      ))}
                    </div>
                    {themePresetId === recommendedThemePreset.id && recommendedThemeReason && (
                      <p>
                        <strong>AI 为什么推荐：</strong>
                        {recommendedThemeReason}
                      </p>
                    )}
                    <p>
                      <strong>图片建议：</strong>
                      {pickerThemeGuidance.imageStyle}
                    </p>
                    <p>
                      <strong>AI 设计：</strong>将使用该主题的 7 色色板、字体层级和页面节奏，且不会改动已审核内容。
                    </p>
                  </div>
                ) : (
                  templateAnalysis && (
                    <div className="template-picker-summary">
                      <span>{templateAnalysis.slideCount} 页面</span>
                      <span>{templateAnalysis.layoutCount} 版式</span>
                      <span>{templateAnalysis.themeCount} 主题</span>
                    </div>
                  )
                )}
              </div>
            </div>
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setTemplatePickerOpen(false)}>
                {designBusy ? "转至后台" : "取消"}
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={
                  (!themePresetId && (!selectedTemplate || !templateAnalysis)) || templatePreviewBusy || designBusy
                }
                onClick={() => void generateFromDraft(themePresetId ? "preset" : "template")}
              >
                {designBusy
                  ? `${designProgress.percent}%`
                  : `使用${themePresetId ? `「${pickerThemePreset.name}」` : "抽取主题"}生成 PPT`}
                {!designBusy && <ArrowRight />}
              </button>
            </div>
          </section>
        </div>
      )}
      {designQualityReport && designQualityReportOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDesignQualityReportOpen(false);
          }}
        >
          <section
            className="upload-dialog export-report-dialog design-quality-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-quality-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <CircleAlert />
                <div>
                  <h2 id="design-quality-title">设计质检报告</h2>
                  <p>{designQualityReport.templateName} · PPT 已生成并写入当前项目，以下问题不会阻止继续编辑或导出。</p>
                  {designQualityReport.concept && (
                    <p>
                      设计方向：{designQualityReport.concept.name} · {designQualityReport.concept.idea}
                    </p>
                  )}
                  {designQualityReport.themeDirectionAudit && (
                    <p>
                      主题方向：
                      {designQualityReport.themeDirectionAudit.status === "sent"
                        ? "已接入"
                        : designQualityReport.themeDirectionAudit.status === "partial"
                          ? "部分生效"
                          : "未接入"}
                      · {designQualityReport.themeDirectionAudit.notes.join(" ")}
                    </p>
                  )}
                </div>
              </div>
              <button type="button" aria-label="关闭设计质检报告" onClick={() => setDesignQualityReportOpen(false)}>
                <X />
              </button>
            </div>
            {designQualityReport.visualReviewCoverage &&
              designQualityReport.visualReviewCoverage.reviewed < designQualityReport.visualReviewCoverage.total && (
                <p className="design-quality-warning">
                  视觉评审未覆盖全部页面，下面的评分和建议只代表已评审页；未评审页不能视为通过。
                </p>
              )}
            <div className="design-review-toolbar" aria-label="视觉复检范围">
              <span>
                上次评审：{new Date(designQualityReport.reviewedAt).toLocaleString("zh-CN")} ·{" "}
                {designQualityReport.reviewSource ?? "来源未记录"}
              </span>
              <div>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("current")}>
                  复检当前页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("changed")}>
                  复检变化页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("issues")}>
                  复检问题页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("all")}>
                  复检整册
                </button>
                {manualReviewBusy && (
                  <button type="button" className="danger" onClick={cancelManualReview}>
                    停止复检
                  </button>
                )}
              </div>
              {manualReviewBusy && <small>正在导出真实 PPTX、检查指定页面并刷新整册总览…</small>}
              {!manualReviewBusy && qualityStaleIndexes.length > 0 && (
                <small className="warning">
                  上次评审后有 {qualityStaleIndexes.length} 页发生变化，建议复检变化页。
                </small>
              )}
            </div>
            {designQualityReport.issues.length === 0 ? (
              <div className="template-empty">
                {designQualityReport.visualReview
                  ? "确定性质量门没有列出问题，视觉评审结论见下方。"
                  : "质量门没有给出具体问题，但检查未完成。"}
              </div>
            ) : (
              <ul className="export-report-list">
                {designQualityReport.issues.map((issue, index) => (
                  <li key={`${issue.issue}-${issue.slideIndex}-${index}`} className="error">
                    <CircleAlert />
                    <div>
                      <strong>
                        第 {issue.slideIndex + 1} 页 · {issue.message}
                      </strong>
                      {issue.elementIds.length > 0 && <p>{issue.elementIds.length} 个对象需要调整</p>}
                      <button
                        type="button"
                        className="quality-target-button"
                        onClick={() => openQualityTarget(issue.slideIndex, issue.elementIds)}
                      >
                        打开第 {issue.slideIndex + 1} 页
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {designQualityReport.templateFit && (
              <div className="design-quality-template">
                <h3>模板符合度</h3>
                <div className="design-review-toolbar">
                  <span>模板目标</span>
                  <div>
                    <button
                      type="button"
                      disabled={!selectedTemplate || !templateAnalysis}
                      onClick={refreshTemplateTarget}
                    >
                      重新编译目标
                    </button>
                    <button type="button" onClick={clearTemplateTarget}>
                      清除目标
                    </button>
                  </div>
                </div>
                {designQualityReport.templateFit.checked ? (
                  <>
                    <p className="design-quality-notes">
                      模板「{designQualityReport.templateTargetName ?? designQualityReport.templateName}」·{" "}
                      {designQualityReport.templateFit.score}/100（阈值 {designQualityReport.templateFit.threshold}）·{" "}
                      {designQualityReport.templateFit.issues.length} 处偏差 · 版式覆盖{" "}
                      {designQualityReport.templateFit.layoutCoverage}/{designQualityReport.templateFit.checkedSlides}{" "}
                      页{designQualityReport.templateFit.passed ? " · 已达标" : " · 未达标"}
                    </p>
                    {designQualityReport.templateFit.issues.length === 0 ? (
                      <div className="template-empty">标题轴线、内容区和字号都贴合上传模板。</div>
                    ) : (
                      <ul className="export-report-list">
                        {designQualityReport.templateFit.issues.map((issue, index) => (
                          <li
                            key={`${issue.code}-${issue.slideIndex}-${index}`}
                            className={issue.severity === "error" ? "error" : "warning"}
                          >
                            <CircleAlert />
                            <div>
                              <strong>
                                第 {issue.slideIndex + 1} 页 · {templateFitLabels[issue.code]}
                              </strong>
                              <p>{issue.message}</p>
                              <button
                                type="button"
                                className="quality-target-button"
                                onClick={() => openQualityTarget(issue.slideIndex, issue.elementIds)}
                              >
                                打开第 {issue.slideIndex + 1} 页
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="design-quality-warning">
                    上传模板没有可用的标题或内容占位符，模板符合度未执行；本次视觉结论不能视为已按模板验收。
                  </p>
                )}
              </div>
            )}
            {designQualityReport.visualReview && (
              <div className="design-quality-visual">
                <h3>视觉评审建议</h3>
                {designQualityReport.contactSheet && (
                  <figure className="design-quality-contact-sheet">
                    <div className="contact-sheet-image-wrap">
                      <img src={designQualityReport.contactSheet} alt="整册页面缩略图总览" />
                      <div
                        className="contact-sheet-page-map"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(4, document.slides.length)}, 1fr)`,
                        }}
                      >
                        {document.slides.map((slide, slideIndex) => {
                          const issueCount =
                            designQualityReport.visualReview?.issues.filter((issue) => issue.slideIndex === slideIndex)
                              .length ?? 0;
                          const score = designQualityReport.visualReview?.slideScores?.find(
                            (item) => item.slideIndex === slideIndex,
                          );
                          return (
                            <button
                              key={slide.id}
                              type="button"
                              className={
                                qualityStaleIndexes.includes(slideIndex)
                                  ? "stale"
                                  : issueCount > 0
                                    ? "has-issues"
                                    : score
                                      ? "reviewed"
                                      : "unreviewed"
                              }
                              aria-label={`打开第 ${slideIndex + 1} 页：${slide.content.title}`}
                              title={`${slide.content.title}${score ? ` · ${score.overallScore} 分` : " · 未逐页评分"}`}
                              onClick={() => openQualityTarget(slideIndex)}
                            >
                              <span>{slideIndex + 1}</span>
                              {score && <em>{score.overallScore}</em>}
                              {issueCount > 0 && <strong>{issueCount}</strong>}
                              {qualityStaleIndexes.includes(slideIndex) && <b>待复检</b>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <figcaption>整册 Contact Sheet · 检查页面节奏、深浅分布、主题一致性、重复版式与前后跳变</figcaption>
                  </figure>
                )}
                {designQualityReport.visualEvidence && (
                  <p className="design-quality-notes">
                    评审依据：{reviewEvidenceLabel(designQualityReport.visualEvidence)}
                  </p>
                )}
                {designQualityReport.deckReview && (
                  <p className="design-quality-notes">
                    整册总览：一致性 {designQualityReport.deckReview.consistencyScore}、重复控制{" "}
                    {designQualityReport.deckReview.repetitionScore ?? "未评"}、主题匹配{" "}
                    {designQualityReport.deckReview.themeFitScore ?? "未评"}、独特性{" "}
                    {designQualityReport.deckReview.distinctivenessScore ?? "未评"}、概念{" "}
                    {designQualityReport.deckReview.conceptScore ?? "未评"}
                    {designQualityReport.deckReview.conceptCapApplied ? "（总分已封顶）" : ""}
                  </p>
                )}
                {designQualityReport.reviewReuse && (
                  <p className="design-quality-notes">
                    本轮定点复检 {designQualityReport.reviewReuse.reviewed} 页，复用{" "}
                    {designQualityReport.reviewReuse.reused} 页既有评审结论
                  </p>
                )}
                {designQualityReport.visualReviewCoverage && (
                  <p className="design-quality-notes">
                    已评审 {designQualityReport.visualReviewCoverage.reviewed}/
                    {designQualityReport.visualReviewCoverage.total} 页 · 总分{" "}
                    {designQualityReport.visualReview.overallScore}（层级{" "}
                    {designQualityReport.visualReview.hierarchyScore}、对齐{" "}
                    {designQualityReport.visualReview.alignmentScore}、可读性{" "}
                    {designQualityReport.visualReview.readabilityScore}、一致性{" "}
                    {designQualityReport.visualReview.consistencyScore}、重复控制{" "}
                    {designQualityReport.visualReview.repetitionScore ?? "未评"}、主题匹配{" "}
                    {designQualityReport.visualReview.themeFitScore ?? "未评"}、视觉焦点{" "}
                    {designQualityReport.visualReview.visualFocusScore ?? "未评"}、独特性{" "}
                    {designQualityReport.visualReview.distinctivenessScore ?? "未评"}、概念{" "}
                    {designQualityReport.visualReview.conceptScore ?? "未评"}
                    {designQualityReport.visualReview.conceptCapApplied ? "（总分已封顶）" : ""}）
                  </p>
                )}
                {designQualityReport.visualReview.issues.length === 0 ? (
                  <div className="template-empty">视觉评审没有留下需要调整的建议。</div>
                ) : (
                  <ul className="export-report-list">
                    {designQualityReport.visualReview.issues.map((issue, index) => {
                      const score = designQualityReport.visualReview?.slideScores?.find(
                        (item) => item.slideIndex === issue.slideIndex,
                      );
                      return (
                        <li
                          key={`${issue.issue}-${issue.slideIndex}-${index}`}
                          className={issue.severity === "error" ? "error" : "warning"}
                        >
                          <CircleAlert />
                          <div>
                            <strong>
                              第 {issue.slideIndex + 1} 页 · {visualIssueLabels[issue.issue]}
                            </strong>
                            <p>{issue.suggestion}</p>
                            {score && (
                              <p>
                                本页 {score.overallScore} 分（层级 {score.hierarchyScore}、对齐 {score.alignmentScore}、
                                可读性 {score.readabilityScore}）
                              </p>
                            )}
                            <button
                              type="button"
                              className="quality-target-button"
                              onClick={() => openQualityTarget(issue.slideIndex, issue.elementIds)}
                            >
                              打开并定位
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {designQualityReport.notes.length > 0 && (
              <p className="design-quality-notes">{designQualityReport.notes.join("；")}</p>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setDesignQualityReport(undefined)}>
                稍后处理
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setDesignQualityReport(undefined);
                  setActiveView("editor");
                  setEditorSurface("canvas");
                }}
              >
                进入编辑器调整
                <ArrowRight />
              </button>
            </div>
          </section>
        </div>
      )}
      {variantOptions && variantOptions.length > 0 && (
        <VariantGalleryDialog options={variantOptions} onSelect={chooseVariant} onDiscard={discardVariantBatch} />
      )}
    </>
  );
}
