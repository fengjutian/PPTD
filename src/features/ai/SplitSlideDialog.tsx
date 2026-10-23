import { Loader2, Scissors, X } from "lucide-react";
import type { SplitSlidePage } from "../../services/ai-service";
import { SpeakerNotes, TextLines } from "./assist-parts";
import { countCharacters } from "./content-review";

export interface SplitSlideDialogProps {
  slideIndex: number;
  title: string;
  status: "running" | "ready" | "error";
  pages?: SplitSlidePage[];
  error?: string;
  onApply: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * 把一页拆成两页的候选。
 *
 * 两页是一起确认的：拆页会改变页面数量和顺序，所以先把两页的标题和正文
 * 放在一起看，再决定要不要插进草稿。两页都带自己的页面计划。
 */
export function SplitSlideDialog({
  slideIndex,
  title,
  status,
  pages,
  error,
  onApply,
  onRetry,
  onClose,
}: SplitSlideDialogProps) {
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
        className="upload-dialog slide-rewrite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-slide-dialog-title"
        aria-busy={running}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || running) return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="upload-dialog-heading">
          <div>
            <Scissors />
            <div>
              <h2 id="split-slide-dialog-title">AI 拆页 · 第 {slideIndex + 1} 页</h2>
              <p>把一个过满的页面拆成两页；确认后原有内容被两页替换，可撤销。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭拆页窗口" onClick={onClose} disabled={running}>
            <X />
          </button>
        </div>

        <p className="slide-rewrite-current-title">
          <span>要拆的页面</span>
          <strong>{title.trim() || "未命名页面"}</strong>
        </p>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        {pages ? (
          <div className="slide-rewrite-compare" aria-live="polite">
            {pages.map((page, index) => (
              <section key={index} aria-label={`拆分后的第 ${index + 1} 页`}>
                <header>
                  <span>新第 {index + 1} 页</span>
                  <small>{countCharacters(page.body)} 字</small>
                </header>
                <p className="split-page-title">{page.title}</p>
                <TextLines text={page.body} emptyLabel="这一页没有正文" />
                <SpeakerNotes text={page.speakerNotes} />
              </section>
            ))}
          </div>
        ) : (
          <p className="slide-rewrite-placeholder">
            {running ? (
              <>
                <Loader2 className="spin" />
                正在按容量重新分配这一页的内容…
              </>
            ) : (
              "点“重新生成”再试一次。"
            )}
          </p>
        )}

        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={running}>
            取消
          </button>
          <button type="button" className="secondary-action" disabled={running} onClick={onRetry}>
            {running ? (
              <>
                <Loader2 className="spin" />
                生成中…
              </>
            ) : (
              "重新生成"
            )}
          </button>
          <button type="button" className="primary-action" disabled={running || !pages} onClick={onApply}>
            <Scissors />
            拆成两页
          </button>
        </div>
      </section>
    </div>
  );
}
