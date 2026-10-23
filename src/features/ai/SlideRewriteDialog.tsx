import { Check, Loader2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ContentBlock } from "../../services/ai-service";
import { countCharacters } from "./content-review";

/**
 * 一页的 AI 重写候选。
 *
 * 它只带正文、内容块和演讲备注：标题由大纲决定，页面计划是这一页的沟通任务，
 * 两者都不在一次"换个写法"里改动。
 */
export interface SlideRewriteProposal {
  body: string;
  speakerNotes: string;
  blocks: ContentBlock[];
}

export interface SlideRewriteDialogProps {
  slideIndex: number;
  /** 本页标题。只读：重写不换标题。 */
  title: string;
  body: string;
  speakerNotes: string;
  status: "editing" | "running" | "ready" | "error";
  proposal?: SlideRewriteProposal;
  error?: string;
  onGenerate: (instruction: string) => void;
  onApply: () => void;
  onClose: () => void;
}

function TextLines({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return <p className="slide-rewrite-empty">{emptyLabel}</p>;
  return (
    <div className="slide-rewrite-lines">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}

function SpeakerNotes({ text }: { text: string }) {
  return (
    <div className="slide-rewrite-notes">
      <span>演讲备注</span>
      {text.trim() ? <p>{text}</p> : <p className="slide-rewrite-empty">没有备注</p>}
    </div>
  );
}

/**
 * AI 重写对话框。
 *
 * 只在用户按下"开始重写"后才花钱；生成结果先放在右栏，和左栏的当前内容对照，
 * 用户点"替换本页"才写回草稿。它不直接调用命令，方便脱离 Tauri 运行时测试。
 */
export function SlideRewriteDialog({
  slideIndex,
  title,
  body,
  speakerNotes,
  status,
  proposal,
  error,
  onGenerate,
  onApply,
  onClose,
}: SlideRewriteDialogProps) {
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const running = status === "running";

  useEffect(() => {
    instructionRef.current?.focus();
  }, []);

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
        aria-labelledby="slide-rewrite-title"
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
              <h2 id="slide-rewrite-title">AI 重写第 {slideIndex + 1} 页</h2>
              <p>标题由大纲决定，保持不变；AI 只重写正文和演讲备注，替换后可撤销。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭 AI 重写窗口" onClick={onClose} disabled={running}>
            <X />
          </button>
        </div>

        <p className="slide-rewrite-current-title">
          <span>本页标题</span>
          <strong>{title.trim() || "未命名页面"}</strong>
        </p>

        <label className="ai-image-field">
          <span className="ai-image-label">改写要求（可选）</span>
          <textarea
            ref={instructionRef}
            className="ai-image-prompt"
            value={instruction}
            maxLength={300}
            disabled={running}
            placeholder="例如：更精炼 / 把结论放到第一条 / 补一句和上一页的衔接"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        <div className="slide-rewrite-compare" aria-live="polite">
          <section aria-label="当前内容">
            <header>
              <span>当前内容</span>
              <small>{countCharacters(body)} 字</small>
            </header>
            <TextLines text={body} emptyLabel="这一页还没有正文" />
            <SpeakerNotes text={speakerNotes} />
          </section>
          <section aria-label="AI 新版本" className={proposal ? "" : "pending"}>
            <header>
              <span>AI 新版本</span>
              <small>{proposal ? `${countCharacters(proposal.body)} 字` : running ? "生成中…" : "尚未生成"}</small>
            </header>
            {proposal ? (
              <>
                <TextLines text={proposal.body} emptyLabel="AI 返回的正文为空" />
                <SpeakerNotes text={proposal.speakerNotes} />
              </>
            ) : (
              <p className="slide-rewrite-placeholder">
                {running ? (
                  <>
                    <Loader2 className="spin" />
                    正在按本页标题和页面计划重写…
                  </>
                ) : (
                  "点“开始重写”生成一个新版本，和左边对照后再决定是否替换。"
                )}
              </p>
            )}
          </section>
        </div>

        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={running}>
            取消
          </button>
          <button type="button" className="secondary-action" disabled={running} onClick={() => onGenerate(instruction)}>
            {running ? (
              <>
                <Loader2 className="spin" />
                重写中…
              </>
            ) : proposal ? (
              "重新生成"
            ) : (
              "开始重写"
            )}
          </button>
          <button type="button" className="primary-action" disabled={running || !proposal} onClick={onApply}>
            <Check />
            替换本页
          </button>
        </div>
      </section>
    </div>
  );
}
