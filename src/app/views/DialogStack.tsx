import type { AppRuntime } from "./app-runtime";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChartColumn,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FilePenLine,
  FolderClock,
  FileUp,
  Grid2x2,
  Grid3x3,
  ImagePlus,
  Images,
  Info,
  LayoutDashboard,
  Magnet,
  Minus,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Palette,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { EMU_PER_INCH, type AnimationEffect, type SlideAnimation } from "../core/document-model";

import { contrastRatio } from "../core/rendering/contrast";

import { LogPanel } from "../features/diagnostics/LogPanel";
import { InspectorPanel } from "../features/editor/InspectorPanel";
import { TextFormatToolbar } from "../features/editor/TextFormatToolbar";
import { FindReplaceBar } from "../features/editor/FindReplaceBar";
import { PageSizeControls } from "../features/editor/PageSizeControls";
import { ShapePicker } from "../features/editor/ShapePicker";
import { ArrangeToolbar } from "../features/editor/ArrangeToolbar";
import { ImportModeDialog, ImportReportDialog } from "../features/editor/PptxImportDialogs";
import {
  ANIMATION_EFFECT_LABELS,
  ANIMATION_EFFECT_OPTIONS,
  ANIMATION_PHASE_LABELS,
} from "../features/editor/animation-options";

import { ContentReviewStatus } from "../features/editor/ContentReviewStatus";
import { ContentHistory } from "../features/editor/ContentHistory";
import { LayerList } from "../features/editor/LayerList";

import { CanvasGridLayer, CanvasGuideLayer } from "../features/editor/CanvasOverlay";

import { ContentReview } from "../features/ai/ContentReview";
import { DesignDirectionDialog } from "../features/ai/DesignDirectionDialog";
import { SlideRewriteDialog } from "../features/ai/SlideRewriteDialog";
import { FactPicker } from "../features/ai/FactPicker";

import { SlideTitleDialog } from "../features/ai/SlideTitleDialog";
import { SpeakerNotesDialog } from "../features/ai/SpeakerNotesDialog";
import { SplitSlideDialog } from "../features/ai/SplitSlideDialog";
import { DeckReviewDialog } from "../features/ai/DeckReviewDialog";
import { ThemePresetPicker } from "../features/ai/ThemePresetPicker";
import { ThemeSpecimenDialog } from "../features/ai/ThemeSpecimenDialog";

import { AiImageDialog } from "../features/editor/AiImageDialog";
import { InsertTableDialog } from "../features/editor/InsertTableDialog";
import { InsertChartDialog } from "../features/editor/InsertChartDialog";

import { SettingsWorkspace } from "../features/settings/SettingsDialog";

import { removeRecentProject } from "../services/app-database";
import { cancelAiGeneration } from "../services/ai-service";

import { isDesktopRuntime } from "../services/project-files";

import { THEME_PRESETS, findThemePreset } from "../core/design/theme-presets";

import type { BuiltinIconName } from "../core/document-model";
import { IconPicker } from "../features/editor/IconPicker";

import { ElementView } from "../features/editor/ElementView";
import { SlideThumbnail } from "../features/editor/SlideThumbnail";
import { ToolButton } from "../features/editor/ToolButton";

import { ProjectHome } from "./ProjectHome";
import type { AppRuntime } from "./app-runtime";
import {
  CANVAS_WIDTH,
  themeColorRoleLabels,
  themeAudienceLabels,
  themePageTypeLabels,
  themeDensityLabels,
  visualIssueLabels,
  templateFitLabels,
  parityIssueLabel,
  reviewEvidenceLabel,
  formatElapsed,
} from "./app-shared";

export function DialogStack({ app }: { app: AppRuntime }) {
  const { insertTableOpen, setInsertTableOpen, execute, activeSlide, setTaskStatus, insertChartOpen, setInsertChartOpen, aiImageOpen, aiImageBusy, aiImageError, setAiImageOpen, handleAiImageGenerate, iconPickerOpen, setIconPickerOpen, recentProjectsOpen, setRecentProjectsOpen, recentProjects, handleOpenRecent, setRecentProjects, message, templateUploadOpen, setTemplateUploadOpen, handleChooseTemplate, templatePickerOpen, designBusy, setTemplatePickerOpen, themePresetId, recommendedThemePreset, handleSelectThemePreset, templateLibrary, selectedTemplate, handleSelectTemplate, designProgress, designDetail, designElapsed, pickerThemePreset, aiDraft, pickerThemeGuidance, templatePreviewBusy, templatePreview, templateAnalysis, generateFromDraft, designQualityReport, designQualityReportOpen, setDesignQualityReportOpen, manualReviewBusy, runManualReview, cancelManualReview, qualityStaleIndexes, openQualityTarget, refreshTemplateTarget, clearTemplateTarget, document, deckReview, setDesignQualityReport, setActiveView, setEditorSurface, exportPreflightOpen, exportBusy, setExportPreflightOpen, revisionLabel, handleExport, directionOptions, directionRegenerations, directionChoiceRef, exportReport, setExportReport, templateMenu, setTemplateMenu, handleRenameTemplate, handleDeleteTemplate, importChoice, importBusy, importProgress, handleCancelImport, setImportChoice, handleImportContent, handleExtractTemplate, importPreview, setImportPreview, handleConfirmImport, contentHistoryOpen, setContentHistoryOpen, restoreContentVersion, restoreContentVersionWithDesign, editorCanvasOpen, findOpen, setFindOpen, setMessage, designCancelRef, setDesignProgress, designTaskId, activeSlideIndex, activeSlideVisualScore, activeSlideVisualIssues, slideRewrite, rewriteSlide, runSlideRewrite, applySlideRewrite, closeSlideRewrite, slideAssist, assistSlide, applyTitleAssist, runTitleAssist, closeSlideAssist, applyNotesAssist, runNotesAssist, applySplitAssist, runSplitAssist, jumpToDeckReviewIssue, rewriteFromDeckReviewIssue, runDeckReview, closeDeckReview } = app;

  return (
    <>
{insertTableOpen && (
        <InsertTableDialog
          onClose={() => setInsertTableOpen(false)}
          onInsert={(columns, rows) => {
            execute({ type: "add-table", slideId: activeSlide.id, columns, rows });
            setInsertTableOpen(false);
            setTaskStatus(`已插入 ${rows + 1} 行 × ${columns} 列表格`);
          }}
        />
      )}
{insertChartOpen && (
        <InsertChartDialog
          onClose={() => setInsertChartOpen(false)}
          onInsert={(kind) => {
            execute({ type: "add-chart", slideId: activeSlide.id, kind });
            setInsertChartOpen(false);
            setTaskStatus("已插入图表；可在属性面板修改示例指标");
          }}
        />
      )}
{aiImageOpen && (
        <AiImageDialog
          busy={aiImageBusy}
          error={aiImageError}
          onClose={() => setAiImageOpen(false)}
          onGenerate={(prompt, role) => void handleAiImageGenerate(prompt, role)}
        />
      )}
{iconPickerOpen && (
        <IconPicker
          onClose={() => setIconPickerOpen(false)}
          onPick={(name: BuiltinIconName) => {
            execute({ type: "add-icon", slideId: activeSlide.id, name });
            setIconPickerOpen(false);
          }}
        />
      )}
{recentProjectsOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRecentProjectsOpen(false);
          }}
        >
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="recent-projects-title">
            <div className="upload-dialog-heading">
              <div>
                <FolderClock />
                <div>
                  <h2 id="recent-projects-title">最近项目</h2>
                  <p>项目文件仍保存在原位置；这里仅保存最近访问记录。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭最近项目" onClick={() => setRecentProjectsOpen(false)}>
                <X />
              </button>
            </div>
            {recentProjects.length === 0 ? (
              <div className="template-empty">还没有保存或打开过项目</div>
            ) : (
              <div className="ai-history">
                {recentProjects.map((entry) => (
                  <div key={entry.path} className="recent-project-row">
                    <button
                      type="button"
                      className="recent-project-open"
                      disabled={entry.missing}
                      title={entry.path}
                      onClick={() => void handleOpenRecent(entry)}
                    >
                      <FolderClock />
                      <div>
                        <strong>{entry.title}</strong>
                        <span>{entry.missing ? "文件已移动或删除" : entry.path}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="recent-project-remove"
                      aria-label={`从最近项目移除 ${entry.title}`}
                      title="仅从最近项目移除，不删除文件"
                      onClick={() => {
                        void removeRecentProject(entry.path)
                          .then(setRecentProjects)
                          .catch((error: unknown) =>
                            setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
                          );
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
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
                  ? `内置 · ${findThemePreset(themePresetId)?.name ?? "主题"}${themePresetId === recommendedThemePreset.id ? "（内容匹配）" : ""}`
                  : "已上传 PPT"}
              </span>
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
                          {preset.id === recommendedThemePreset.id && <em>内容匹配</em>}
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
                    {exportReport.nativeTableCount > 0 ? ` · ${exportReport.nativeTableCount} 个原生表格` : ""} · ZIP{" "}
                    {exportReport.package.entryCount} 个条目
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
{templateMenu && (
        <div
          className="template-menu-backdrop"
          role="presentation"
          onMouseDown={() => setTemplateMenu(undefined)}
          onContextMenu={(event) => {
            event.preventDefault();
            setTemplateMenu(undefined);
          }}
        >
          <div
            className="template-context-menu"
            role="menu"
            style={{ left: templateMenu.x, top: templateMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <strong>{templateMenu.template.name}</strong>
            <button type="button" role="menuitem" onClick={() => void handleRenameTemplate(templateMenu.template)}>
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void handleDeleteTemplate(templateMenu.template)}
            >
              删除
            </button>
          </div>
        </div>
      )}
{importChoice && (
        <ImportModeDialog
          fileName={importChoice.name}
          busy={importBusy}
          progress={importProgress}
          onCancelImport={importProgress ? () => void handleCancelImport() : undefined}
          onClose={() => {
            setImportChoice(undefined);
            setTaskStatus("已取消打开");
          }}
          onImportContent={() => void handleImportContent()}
          onExtractTemplate={() => void handleExtractTemplate()}
        />
      )}
{importPreview && (
        <ImportReportDialog
          fileName={importPreview.fileName}
          report={importPreview.report}
          onCancel={() => {
            setImportPreview(undefined);
            setTaskStatus("已取消导入，当前项目未改变");
          }}
          onConfirm={() => void handleConfirmImport()}
        />
      )}
{contentHistoryOpen && (
        <ContentHistory
          document={document}
          onClose={() => setContentHistoryOpen(false)}
          onRestore={restoreContentVersion}
          onRestoreDesign={restoreContentVersionWithDesign}
        />
      )}
{editorCanvasOpen && findOpen && <FindReplaceBar onClose={() => setFindOpen(false)} />}
{message && (
        <div className={`page-message ${message.kind}`} role="status" aria-live="polite">
          {message.kind === "success" ? <CircleCheck /> : message.kind === "error" ? <CircleAlert /> : <Info />}
          <span>{message.text}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}>
            <X />
          </button>
        </div>
      )}
{designBusy && !templatePickerOpen && (
        <aside className="background-task-card" role="status" aria-live="polite" aria-label="AI 设计后台任务">
          <div className="background-task-heading">
            <span>
              <Sparkles />
              <strong>AI 正在后台生成 PPT</strong>
            </span>
            <b>{designProgress.percent}%</b>
          </div>
          <p>
            {designProgress.label}
            {designDetail ? ` · ${designDetail}` : ""} · 已用时 {formatElapsed(designElapsed)}
          </p>
          <div
            className="background-task-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={designProgress.percent}
          >
            <i style={{ width: `${designProgress.percent}%` }} />
          </div>
          <div className="background-task-actions">
            <button type="button" onClick={() => setTemplatePickerOpen(true)}>
              查看任务
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                designCancelRef.current = true;
                // A gate waiting for a choice must be released, or cancel
                // leaves the task running behind a closed dialog.
                directionChoiceRef.current?.({ kind: "skip" });
                setDesignProgress({ percent: designProgress.percent, label: "正在取消任务…" });
                void cancelAiGeneration(designTaskId.current).catch(() => undefined);
              }}
            >
              取消任务
            </button>
          </div>
        </aside>
      )}
{designQualityReport && !designQualityReportOpen && !designBusy && (
        <aside className="background-task-card complete" role="status" aria-live="polite">
          <div className="background-task-heading">
            <span>
              <CircleCheck />
              <strong>PPT 已生成，质检报告可查看</strong>
            </span>
          </div>
          <p>生成结果已保留，当前操作不会被打断。</p>
          <div className="background-task-actions">
            <button type="button" onClick={() => setDesignQualityReportOpen(true)}>
              查看质检报告
            </button>
            <button type="button" onClick={() => setDesignQualityReport(undefined)}>
              稍后处理
            </button>
          </div>
        </aside>
      )}
{editorCanvasOpen && designQualityReport && !designQualityReportOpen && (
        <aside className="current-slide-quality-card" aria-label="当前页视觉质检">
          <div>
            <strong>第 {activeSlideIndex + 1} 页质检</strong>
            <span>
              {qualityStaleIndexes.includes(activeSlideIndex)
                ? "结果已过期"
                : activeSlideVisualScore
                  ? `${activeSlideVisualScore.overallScore} 分`
                  : "未逐页评分"}
            </span>
          </div>
          <p>
            {activeSlideVisualIssues.length > 0
              ? `${activeSlideVisualIssues.length} 条视觉建议：${activeSlideVisualIssues
                  .slice(0, 2)
                  .map((issue) => visualIssueLabels[issue.issue])
                  .join("、")}`
              : qualityStaleIndexes.includes(activeSlideIndex)
                ? "本页在上次评审后发生变化。"
                : "本页没有未解决的视觉建议。"}
          </p>
          <div>
            <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("current")}>
              复检本页
            </button>
            <button type="button" onClick={() => setDesignQualityReportOpen(true)}>
              查看整册报告
            </button>
          </div>
        </aside>
      )}
{slideRewrite && rewriteSlide && (
        <SlideRewriteDialog
          slideIndex={slideRewrite.index}
          title={rewriteSlide.title}
          body={rewriteSlide.body}
          speakerNotes={rewriteSlide.speakerNotes}
          status={slideRewrite.status}
          proposal={slideRewrite.proposal}
          error={slideRewrite.error}
          defaultInstruction={slideRewrite.instruction}
          onGenerate={(instruction) => void runSlideRewrite(instruction)}
          onApply={applySlideRewrite}
          onClose={closeSlideRewrite}
        />
      )}
{slideAssist?.kind === "title" && assistSlide && (
        <SlideTitleDialog
          slideIndex={slideAssist.index}
          currentTitle={assistSlide.title}
          status={slideAssist.status}
          candidates={slideAssist.candidates}
          error={slideAssist.error}
          onPick={applyTitleAssist}
          onRetry={() => void runTitleAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
{slideAssist?.kind === "notes" && assistSlide && (
        <SpeakerNotesDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          currentNotes={assistSlide.speakerNotes}
          status={slideAssist.status}
          proposal={slideAssist.proposal}
          error={slideAssist.error}
          onApply={applyNotesAssist}
          onRetry={() => void runNotesAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
{slideAssist?.kind === "split" && assistSlide && (
        <SplitSlideDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          status={slideAssist.status}
          pages={slideAssist.pages}
          error={slideAssist.error}
          onApply={applySplitAssist}
          onRetry={() => void runSplitAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}
{deckReview && (
        <DeckReviewDialog
          status={deckReview.status}
          issues={deckReview.issues}
          error={deckReview.error}
          onJump={jumpToDeckReviewIssue}
          onRewriteIssue={rewriteFromDeckReviewIssue}
          onRetry={() => void runDeckReview()}
          onClose={closeDeckReview}
        />
      )}
    </>
  );
}
