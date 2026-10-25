import { ArrowLeft, Check, CircleAlert, Sparkles } from "lucide-react";

import type { VariantOptionView } from "../../app/app-shared";

/**
 * The batch result: every variant already laid out, one click to keep it.
 *
 * This is not a second theme picker. Each card is a real deck — the previews are
 * rendered from the design that would be kept — so the choice is between
 * finished looks rather than swatches. The batch deliberately does not generate
 * pictures or run the visual review; the footer says so, because a preview
 * without images is not the final deck.
 */
export interface VariantGalleryDialogProps {
  options: VariantOptionView[];
  onSelect: (id: string) => void;
  /** Discard the batch and go back to the template picker. */
  onDiscard: () => void;
}

export function VariantGalleryDialog({ options, onSelect, onDiscard }: VariantGalleryDialogProps) {
  return (
    <div className="upload-dialog-backdrop" role="presentation">
      <section
        className="upload-dialog variant-gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-gallery-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Sparkles />
            <div>
              <h2 id="variant-gallery-title">AI 生成了 {options.length} 个版本</h2>
              <p>同一份已审核内容，{options.length} 套模板。选定后只保留这一版，其余丢弃；内容一个字都不会变。</p>
            </div>
          </div>
        </div>
        <div className="variant-gallery-grid" role="list">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="listitem"
              className="variant-gallery-card"
              aria-label={`使用版本：${option.name}`}
              onClick={() => onSelect(option.id)}
            >
              <span className="variant-gallery-previews">
                {option.images.length > 0 ? (
                  option.images.map((source, imageIndex) => (
                    <img
                      key={`${option.id}-${imageIndex}`}
                      src={source}
                      alt={`${option.name} 第 ${imageIndex + 1} 页预览`}
                      loading="lazy"
                    />
                  ))
                ) : (
                  <span className="variant-gallery-no-preview">这一版没有渲染出预览</span>
                )}
              </span>
              <span className="variant-gallery-copy">
                <span className="variant-gallery-name">
                  <strong>{option.name}</strong>
                  {index === 0 && <em>AI 推荐</em>}
                </span>
                <span className="variant-gallery-description">{option.description}</span>
                <span className="variant-gallery-reason">{option.reason}</span>
                <span className={`variant-gallery-issues ${option.issueCount > 0 ? "warning" : "ok"}`}>
                  {option.issueCount > 0 ? (
                    <>
                      <CircleAlert size={12} />
                      {option.issueCount} 处排版待调整
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      排版检查通过
                    </>
                  )}
                </span>
                <span className="variant-gallery-pick">
                  <Check size={14} />
                  用这个版本
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="variant-gallery-note">
          预览版不生成配图、也不做视觉复检，所以画面会比成品素；选定那一版之后才会补配图并跑完整质检。
        </p>
        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onDiscard}>
            <ArrowLeft size={14} />
            返回，重新选模板
          </button>
        </div>
      </section>
    </div>
  );
}
