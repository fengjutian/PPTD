import { useState } from "react";
import { ArrowLeft, Check, CircleAlert, Eye, Sparkles } from "lucide-react";

import type { VariantOptionView } from "../../app/app-shared";

import { VariantPreviewDialog } from "./VariantPreviewDialog";
import { VariantStyleLine } from "./VariantStyleLine";

/**
 * The batch result: every variant already laid out, one click to keep it.
 *
 * This is not a second theme picker. Each card is a real deck — the previews are
 * rendered from the design that would be kept — so the choice is between
 * finished looks rather than swatches. A card only has room for two pages, so
 * the rendered pages are also a button that opens the whole deck at a readable
 * size. Candidates already passed geometry and aesthetic gates and use their
 * own low-resolution review images, so the user is comparing real compositions.
 */
export interface VariantGalleryDialogProps {
  options: VariantOptionView[];
  onSelect: (id: string) => void;
  /** Discard the batch and go back to the template picker. */
  onDiscard: () => void;
  /** Renders every page of one variant for the enlarged preview. */
  renderPages: (id: string) => Promise<string[]>;
}

export function VariantGalleryDialog({ options, onSelect, onDiscard, renderPages }: VariantGalleryDialogProps) {
  const [previewId, setPreviewId] = useState<string>();
  const previewOption = options.find((option) => option.id === previewId);

  return (
    <>
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
                <p>
                  同一份已审核内容，{options.length} 组「配色 ×
                  版面」。选定后只保留这一版，其余丢弃；内容一个字都不会变。
                </p>
              </div>
            </div>
          </div>
          <div className="variant-gallery-grid" role="list">
            {options.map((option, index) => (
              <article
                key={option.id}
                className="variant-gallery-card"
                role="listitem"
                onClick={(event) => {
                  // The card stays a one-click keep target from the batch result;
                  // the two inner buttons carry the real semantics, so their
                  // clicks belong to them and must not also pick the version.
                  if (!(event.target as HTMLElement).closest("button")) onSelect(option.id);
                }}
              >
                <button
                  type="button"
                  className="variant-gallery-previews"
                  aria-label={`预览整册：${option.name}`}
                  onClick={() => setPreviewId(option.id)}
                >
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
                  <span className="variant-gallery-preview-cue">
                    <Eye size={12} />
                    整册预览 · {option.pageCount} 页
                  </span>
                </button>
                <div className="variant-gallery-copy">
                  <span className="variant-gallery-name">
                    <strong>{option.name}</strong>
                    {index === 0 && <em>AI 推荐</em>}
                  </span>
                  <VariantStyleLine presetId={option.presetId} />
                  <span className="variant-gallery-description">{option.description}</span>
                  <span className="variant-gallery-reason">{option.reason}</span>
                  {option.aestheticScore !== undefined && (
                    <span className="variant-gallery-issues ok">
                      审美 {option.aestheticScore} · 层级 {option.aestheticDimensions?.hierarchy} · 平衡{" "}
                      {option.aestheticDimensions?.balance} · 节奏 {option.aestheticDimensions?.rhythm} · 差异{" "}
                      {option.aestheticDimensions?.homogeneity} · 配图 {option.aestheticDimensions?.imageRelevance} ·
                      填充 {option.aestheticDimensions?.coverage} · 视觉锚点 {option.aestheticDimensions?.visualAnchor}
                    </span>
                  )}
                  {option.issueCount !== undefined && (
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
                  )}
                  <button
                    type="button"
                    className="variant-gallery-pick"
                    aria-label={`使用版本：${option.name}`}
                    onClick={() => onSelect(option.id)}
                  >
                    <Check size={14} />
                    用这个版本
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="variant-gallery-note">
            每个候选都用自己的真实低清配图完成审美评估；选定后复用这些素材，只补缺图页并跑完整质检。
          </p>
          <div className="upload-dialog-actions">
            <button type="button" className="secondary-action" onClick={onDiscard}>
              <ArrowLeft size={14} />
              返回，重新选模板
            </button>
          </div>
        </section>
      </div>
      {previewOption && (
        <VariantPreviewDialog
          options={options}
          option={previewOption}
          onClose={() => setPreviewId(undefined)}
          onUse={(id) => {
            setPreviewId(undefined);
            onSelect(id);
          }}
          renderPages={renderPages}
        />
      )}
    </>
  );
}
