import { Loader2, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";

export interface SlideTitleDialogProps {
  slideIndex: number;
  currentTitle: string;
  status: "running" | "ready" | "error";
  candidates?: string[];
  error?: string;
  onPick: (title: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * 换标题的候选列表。
 *
 * 候选由后端按"这一页真正在说什么"生成；这里只负责让人挑一个。挑中的标题
 * 通过普通标题编辑写回草稿，因此同样进撤销栈、页面回到待审核。
 */
export function SlideTitleDialog({
  slideIndex,
  currentTitle,
  status,
  candidates,
  error,
  onPick,
  onRetry,
  onClose,
}: SlideTitleDialogProps) {
  const running = status === "running";
  const [selected, setSelected] = useState(0);

  // 重新生成后候选换了，选中项要回到第一个，否则会指向已经不存在的行。
  useEffect(() => {
    setSelected(0);
  }, [candidates]);

  const chosen = candidates?.[selected];

  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!running && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog slide-title-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-title-dialog-title"
        aria-busy={running}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || running) return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="upload-dialog-heading">
          <div>
            <Wand2 />
            <div>
              <h2 id="slide-title-dialog-title">AI 换标题 · 第 {slideIndex + 1} 页</h2>
              <p>候选只改标题，不动正文；选中后会像手改标题一样进入撤销栈。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭换标题窗口" onClick={onClose} disabled={running}>
            <X />
          </button>
        </div>

        <p className="slide-rewrite-current-title">
          <span>当前标题</span>
          <strong>{currentTitle.trim() || "未命名页面"}</strong>
        </p>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        {candidates && candidates.length > 0 ? (
          <div className="title-candidates" role="radiogroup" aria-label="候选标题">
            {candidates.map((title, index) => (
              <button
                key={`${index}-${title}`}
                type="button"
                role="radio"
                aria-checked={selected === index}
                className={selected === index ? "active" : ""}
                disabled={running}
                onClick={() => setSelected(index)}
              >
                <span>{index + 1}</span>
                <strong>{title}</strong>
              </button>
            ))}
          </div>
        ) : (
          <p className="slide-rewrite-placeholder">
            {running ? (
              <>
                <Loader2 className="spin" />
                正在按这一页的内容拟标题…
              </>
            ) : (
              "还没有候选，点“重新生成”再试一次。"
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
          <button
            type="button"
            className="primary-action"
            disabled={running || !chosen}
            onClick={() => chosen && onPick(chosen)}
          >
            用这个标题
          </button>
        </div>
      </section>
    </div>
  );
}
