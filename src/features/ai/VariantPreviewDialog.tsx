import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Eye, LoaderCircle, X } from "lucide-react";

import type { VariantOptionView } from "../../app/app-shared";

/**
 * Enlarged, page-by-page preview of one generated variant.
 *
 * A gallery card can only fit the cover and the first text page, but choosing a
 * template is a judgement about the whole deck: section pages, evidence pages
 * and the ending have to share the cover's tone. The pages are rendered on
 * demand from the design the batch already paid for, and the version chips
 * switch in place so comparing two looks does not mean closing and reopening.
 *
 * Read-only: nothing here writes to the project, bumps the content revision or
 * generates pictures.
 */
export interface VariantPreviewDialogProps {
  options: VariantOptionView[];
  /** The version the preview opens on. */
  option: VariantOptionView;
  onClose: () => void;
  /** Keep this version and continue the normal pipeline. */
  onUse: (id: string) => void;
  /** Renders every page of one variant. */
  renderPages: (id: string) => Promise<string[]>;
}

export function VariantPreviewDialog({
  options,
  option: openedOption,
  onClose,
  onUse,
  renderPages,
}: VariantPreviewDialogProps) {
  const [optionId, setOptionId] = useState(openedOption.id);
  const [pageIndex, setPageIndex] = useState(0);
  const [pagesById, setPagesById] = useState<Record<string, string[]>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  // One request per version even if the dialog re-renders while it is loading.
  const pendingRef = useRef(new Set<string>());

  const option = options.find((candidate) => candidate.id === optionId) ?? openedOption;
  const pages = pagesById[optionId];
  const failed = failedIds[optionId] === true;
  const totalPages = pages && pages.length > 0 ? pages.length : Math.max(1, option.pageCount);
  const currentPage = Math.min(pageIndex, totalPages - 1);
  const page = pages?.[currentPage];

  useEffect(() => {
    if (pagesById[optionId] || failedIds[optionId] || pendingRef.current.has(optionId)) return;
    pendingRef.current.add(optionId);
    void renderPages(optionId)
      .then((images) => setPagesById((current) => ({ ...current, [optionId]: images })))
      .catch(() => setFailedIds((current) => ({ ...current, [optionId]: true })))
      .finally(() => pendingRef.current.delete(optionId));
  }, [failedIds, optionId, pagesById, renderPages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPageIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPageIndex((current) => Math.min(totalPages - 1, current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, totalPages]);

  const switchVariant = (id: string) => {
    if (id === optionId) return;
    setOptionId(id);
    setPageIndex(0);
  };

  return (
    <div
      className="upload-dialog-backdrop variant-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog variant-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-preview-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Eye />
            <div>
              <h2 id="variant-preview-title">{option.name} · 整册预览</h2>
              <p>
                同一份已审核内容 · 共 {option.pageCount} 页 · 第 {currentPage + 1} / {totalPages} 页
              </p>
            </div>
          </div>
          <button type="button" aria-label="关闭整册预览" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="variant-preview-versions" role="group" aria-label="切换版本">
          {options.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === optionId}
              onClick={() => switchVariant(candidate.id)}
            >
              {candidate.name}
              {index === 0 && <em>AI 推荐</em>}
            </button>
          ))}
        </div>

        <div className={`variant-preview-stage${page ? "" : " loading"}`}>
          {page ? (
            <img src={page} alt={`${option.name} 第 ${currentPage + 1} 页整册预览`} />
          ) : failed ? (
            <div className="variant-preview-fallback">
              <strong>这一版没能渲染整册预览</strong>
              <p>可能是底图或字体在本机不可用；卡片上的两页预览仍可参考，选定后照常补图与质检。</p>
              {option.images.length > 0 && (
                <span className="variant-preview-fallback-images">
                  {option.images.map((source, index) => (
                    <img key={`${option.id}-fallback-${index}`} src={source} alt={`${option.name} 第 ${index + 1} 页预览`} />
                  ))}
                </span>
              )}
            </div>
          ) : (
            <div className="variant-preview-loading">
              <LoaderCircle />
              <span>正在渲染整册，共 {option.pageCount} 页…</span>
            </div>
          )}
          {totalPages > 1 && (
            <>
              <button
                type="button"
                className="variant-preview-step prev"
                aria-label="上一页"
                disabled={currentPage <= 0}
                onClick={() => setPageIndex(Math.max(0, currentPage - 1))}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="variant-preview-step next"
                aria-label="下一页"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPageIndex(Math.min(totalPages - 1, currentPage + 1))}
              >
                <ChevronRight />
              </button>
            </>
          )}
          {page && (
            <span className="variant-preview-counter" aria-live="polite">
              {currentPage + 1} / {totalPages}
            </span>
          )}
        </div>

        {pages && pages.length > 0 && (
          <div className="variant-preview-strip" role="group" aria-label="页面缩略图">
            {pages.map((source, index) => (
              <button
                key={`${option.id}-${index}`}
                type="button"
                aria-label={`第 ${index + 1} 页`}
                aria-current={index === currentPage ? "true" : undefined}
                onClick={() => setPageIndex(index)}
              >
                <img src={source} alt="" />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        )}

        <div className="variant-preview-meta">
          <span>{option.description}</span>
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
        </div>

        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose}>
            返回对比
          </button>
          <button type="button" className="primary-action" onClick={() => onUse(option.id)}>
            <Check size={14} />
            用这个版本
          </button>
        </div>
      </section>
    </div>
  );
}
