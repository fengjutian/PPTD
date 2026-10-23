import { Check, Loader2, Mic, X } from "lucide-react";
import { TextLines } from "./assist-parts";

export interface SpeakerNotesDialogProps {
  slideIndex: number;
  title: string;
  currentNotes: string;
  status: "running" | "ready" | "error";
  proposal?: string;
  error?: string;
  onApply: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * 只重写演讲备注。
 *
 * 正文已经审核过的页面不该为了补一句备注再重写一遍：这里只替换备注，
 * 正文和内容块保持原样。
 */
export function SpeakerNotesDialog({
  slideIndex,
  title,
  currentNotes,
  status,
  proposal,
  error,
  onApply,
  onRetry,
  onClose,
}: SpeakerNotesDialogProps) {
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
        aria-labelledby="speaker-notes-dialog-title"
        aria-busy={running}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || running) return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="upload-dialog-heading">
          <div>
            <Mic />
            <div>
              <h2 id="speaker-notes-dialog-title">AI 写演讲备注 · 第 {slideIndex + 1} 页</h2>
              <p>只替换演讲备注，正文和内容块保持不动。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭演讲备注窗口" onClick={onClose} disabled={running}>
            <X />
          </button>
        </div>

        <p className="slide-rewrite-current-title">
          <span>本页标题</span>
          <strong>{title.trim() || "未命名页面"}</strong>
        </p>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        <div className="slide-rewrite-compare" aria-live="polite">
          <section aria-label="当前备注">
            <header>
              <span>当前备注</span>
              <small>{currentNotes.trim() ? "已有内容" : "没有备注"}</small>
            </header>
            <TextLines text={currentNotes} emptyLabel="这一页还没有备注" />
          </section>
          <section aria-label="AI 新备注" className={proposal ? "" : "pending"}>
            <header>
              <span>AI 新备注</span>
              <small>{proposal ? "已生成" : running ? "生成中…" : "尚未生成"}</small>
            </header>
            {proposal ? (
              <TextLines text={proposal} emptyLabel="AI 返回的备注为空" />
            ) : (
              <p className="slide-rewrite-placeholder">
                {running ? (
                  <>
                    <Loader2 className="spin" />
                    正在按这一页的内容写备注…
                  </>
                ) : (
                  "点“重新生成”再试一次。"
                )}
              </p>
            )}
          </section>
        </div>

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
          <button type="button" className="primary-action" disabled={running || !proposal} onClick={onApply}>
            <Check />
            采用这段备注
          </button>
        </div>
      </section>
    </div>
  );
}
