import { Loader2, ScanText, X } from "lucide-react";
import type { DeckReviewIssue } from "../../services/ai-service";

const ISSUE_KIND_LABELS: Record<DeckReviewIssue["kind"], string> = {
  duplicate: "内容重复",
  "title-body-mismatch": "标题未兑现",
  "broken-flow": "衔接断裂",
  overloaded: "信息过载",
  "missing-conclusion": "缺少结论",
  unclear: "表述含糊",
};

export interface DeckReviewDialogProps {
  status: "running" | "ready" | "error";
  issues?: DeckReviewIssue[];
  error?: string;
  onJump: (slideIndex: number) => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * 整册语义审稿。
 *
 * 它只出问题清单：每条都能跳到对应页面，但没有任何"自动修好"的按钮。
 * 事实真假和数字来源不在评审范围内，提示词里已经写明。
 */
export function DeckReviewDialog({ status, issues, error, onJump, onRetry, onClose }: DeckReviewDialogProps) {
  const running = status === "running";

  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!running && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog deck-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-review-dialog-title"
        aria-busy={running}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || running) return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="upload-dialog-heading">
          <div>
            <ScanText />
            <div>
              <h2 id="deck-review-dialog-title">AI 审稿</h2>
              <p>只指出内容层的问题：重复、断裂、过载、标题未兑现。不判断事实真假。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭审稿窗口" onClick={onClose} disabled={running}>
            <X />
          </button>
        </div>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        {running ? (
          <p className="slide-rewrite-placeholder">
            <Loader2 className="spin" />
            正在通读全稿…
          </p>
        ) : issues && issues.length > 0 ? (
          <ul className="deck-review-issues" aria-label="审稿问题">
            {issues.map((issue, index) => (
              <li key={`${issue.slideIndex}-${issue.kind}-${index}`} className={issue.severity}>
                <div>
                  <span className="deck-review-page">第 {issue.slideIndex + 1} 页</span>
                  <span className="deck-review-kind">{ISSUE_KIND_LABELS[issue.kind]}</span>
                </div>
                <p>{issue.message}</p>
                <button type="button" className="link-action" onClick={() => onJump(issue.slideIndex)}>
                  定位到第 {issue.slideIndex + 1} 页
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="deck-review-empty">
            {status === "ready" ? "没有发现内容层的问题，可以直接进入模板选择。" : "点“重新审稿”再试一次。"}
          </p>
        )}

        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={running}>
            关闭
          </button>
          <button type="button" className="primary-action" disabled={running} onClick={onRetry}>
            {running ? (
              <>
                <Loader2 className="spin" />
                审稿中…
              </>
            ) : (
              "重新审稿"
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
