import { CircleAlert, CircleCheck, Info, Sparkles, X } from "lucide-react";

import { cancelAiGeneration } from "../services/ai-service";

import type { AppRuntime } from "./app-runtime";
import { visualIssueLabels, formatElapsed } from "./app-shared";

export function AppNotifications({ app }: { app: AppRuntime }) {
  const {
    message,
    setMessage,
    designBusy,
    templatePickerOpen,
    designProgress,
    designDetail,
    designElapsed,
    setTemplatePickerOpen,
    designCancelRef,
    directionChoiceRef,
    setDesignProgress,
    designTaskId,
    designQualityReport,
    designQualityReportOpen,
    setDesignQualityReportOpen,
    setDesignQualityReport,
    editorCanvasOpen,
    activeSlideIndex,
    qualityStaleIndexes,
    activeSlideVisualScore,
    activeSlideVisualIssues,
    manualReviewBusy,
    runManualReview,
  } = app;

  return (
    <>
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
    </>
  );
}
