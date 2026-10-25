import { useState } from "react";
import { Check, RefreshCw, SkipForward, Wand2 } from "lucide-react";

/**
 * The gate between content review and deck design.
 *
 * Four real previews, not four descriptions: the user is choosing a skeleton,
 * and a description cannot show whether the picture owns the page or sits
 * beside the copy. The dialog never decides for the user; skipping is a
 * first-class action that keeps the recommended direction.
 */

export interface DirectionOptionView {
  id: string;
  name: string;
  idea: string;
  rationale: string;
  presetLabel: string;
  /** The preset this user has chosen most often in recent decks. */
  recommended?: boolean;
  /** Two rendered pages, in the order they were previewed. */
  images: string[];
}

export interface DesignDirectionDialogProps {
  options: DirectionOptionView[];
  /** How many times the user has asked for another set. */
  regenerations: number;
  onSelect: (id: string, words?: string) => void;
  onSkip: (words?: string) => void;
  onRetry: () => void;
}

export function DesignDirectionDialog({
  options,
  regenerations,
  onSelect,
  onSkip,
  onRetry,
}: DesignDirectionDialogProps) {
  // The reason is optional, but it is the most useful thing to remember for the
  // next deck: "太素了" is a design brief, a click alone is not.
  const [words, setWords] = useState("");
  return (
    <div className="upload-dialog-backdrop" role="presentation">
      <section
        className="upload-dialog design-direction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-direction-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Wand2 />
            <div>
              <h2 id="design-direction-title">选择设计方向</h2>
              <p>同一份已审核内容，四种版面骨架。选定后生成整册，内容不会改变。</p>
            </div>
          </div>
        </div>
        <div className="design-direction-grid">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="design-direction-card"
              aria-label={`选择方向：${option.name}`}
              onClick={() => onSelect(option.id, words)}
            >
              <span className="design-direction-previews">
                {option.images.map((source, index) => (
                  <img key={`${option.id}-${index}`} src={source} alt={`${option.name} 第 ${index + 1} 页预览`} />
                ))}
              </span>
              <span className="design-direction-copy">
                <span className="design-direction-name">
                  <strong>{option.name}</strong>
                  <small>{option.presetLabel}</small>
                  {option.recommended && <small className="design-direction-recommended">最近常选</small>}
                </span>
                <span className="design-direction-idea">{option.idea}</span>
                <span className="design-direction-rationale">{option.rationale}</span>
                <span className="design-direction-pick">
                  <Check size={14} />
                  选这个方向
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="design-direction-words">
          <label htmlFor="design-direction-words">为什么选它（可选，会记进本项目的方向记录）</label>
          <textarea
            id="design-direction-words"
            rows={2}
            maxLength={200}
            value={words}
            placeholder="例如：想要更像图片报道，文字少一点。"
            onChange={(event) => setWords(event.target.value)}
          />
        </div>
        <div className="design-direction-actions">
          <button type="button" onClick={() => onSkip(words)}>
            <SkipForward size={14} />
            跳过，按推荐方向生成
          </button>
          <button type="button" onClick={onRetry} disabled={regenerations >= 2}>
            <RefreshCw size={14} />
            换一组（{regenerations}/2）
          </button>
        </div>
        <p className="design-direction-note">预览是代表性页面；页脚与页码按真实页位生成，整册节奏在生成后仍可调整。</p>
      </section>
    </div>
  );
}
