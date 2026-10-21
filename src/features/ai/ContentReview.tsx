import { CircleAlert, FilePlus2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiDraft } from "../../services/ai-service";
import {
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  missingTitleIndexes,
  narrativeStrategyLabels,
  slideMetrics,
  visualIntentLabels,
  type AiDraftSaveState,
} from "./content-review";

export type SlideField = "title" | "body" | "speakerNotes";

export type ContentReviewProps = {
  draft: AiDraft;
  originalDraft?: AiDraft;
  activeIndex: number;
  saveState: AiDraftSaveState;
  onActiveIndexChange: (index: number) => void;
  onDraftTitleChange: (title: string) => void;
  onSlideFieldChange: (index: number, field: SlideField, value: string) => void;
  onRestoreSlide: (index: number) => void;
  onNewDraft: () => void;
};

function DraftNotes({ index, value, onChange }: { index: number; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(() => value.trim().length > 0);
  return (
    <details className="draft-notes" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        演讲备注<span>{countCharacters(value)} 字</span>
      </summary>
      <textarea
        aria-label={`第 ${index + 1} 页演讲备注`}
        rows={Math.max(2, value.split("\n").length + 1)}
        maxLength={4000}
        value={value}
        placeholder="补充讲稿、提示或数据来源"
        onChange={(event) => onChange(event.target.value)}
      />
    </details>
  );
}

export function ContentReview({
  draft,
  originalDraft,
  activeIndex,
  saveState,
  onActiveIndexChange,
  onDraftTitleChange,
  onSlideFieldChange,
  onRestoreSlide,
  onNewDraft,
}: ContentReviewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const scrollLock = useRef<number | null>(null);
  const scrollLockTimer = useRef<number | undefined>(undefined);

  const metrics = draftMetrics(draft);
  const missingIndexes = missingTitleIndexes(draft);
  const firstMissing = missingIndexes[0];

  useEffect(() => () => {
    window.clearTimeout(scrollLockTimer.current);
  }, []);

  // Keep the active outline row visible while the reader scrolls the cards.
  // Updating scrollTop directly avoids moving any other scroll container.
  useEffect(() => {
    const outline = outlineRef.current;
    const active = outline?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!outline || !active) return;
    const outlineRect = outline.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < outlineRect.top) outline.scrollTop -= outlineRect.top - activeRect.top + 6;
    else if (activeRect.bottom > outlineRect.bottom) outline.scrollTop += activeRect.bottom - outlineRect.bottom + 6;
  }, [activeIndex]);

  const goToSlide = (index: number) => {
    onActiveIndexChange(index);
    scrollLock.current = index;
    window.clearTimeout(scrollLockTimer.current);
    scrollLockTimer.current = window.setTimeout(() => {
      scrollLock.current = null;
    }, 450);
    const card = listRef.current?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`);
    card?.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById(`draft-slide-title-${index}`)?.focus({ preventScroll: true });
  };

  // The outline follows the page the reader is actually looking at. The lock
  // prevents a smooth programmatic scroll from briefly highlighting pages in
  // between the origin and the destination.
  const handleScroll = () => {
    if (scrollLock.current !== null) return;
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    list.querySelectorAll<HTMLElement>("[data-slide-index]").forEach((card) => {
      const distance = Math.abs(card.getBoundingClientRect().top - listTop - 8);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = Number(card.dataset.slideIndex);
      }
    });
    if (nearest !== activeIndex) onActiveIndexChange(nearest);
  };

  return (
    <section className="draft-review">
      <aside className="draft-outline" aria-label="PPT 内容大纲">
        <div className="draft-outline-title">
          <div>
            <strong>PPT 内容</strong>
            <span>{draft.slides.length} 页</span>
          </div>
          <button type="button" className="link-action" onClick={onNewDraft}>
            <FilePlus2 />
            新建
          </button>
        </div>
        <div className="draft-outline-list" ref={outlineRef}>
          {draft.slides.map((slide, index) => {
            const slideStat = slideMetrics(slide);
            const missing = !slide.title.trim();
            return (
              <button
                type="button"
                className={activeIndex === index ? "active" : ""}
                aria-current={activeIndex === index ? "page" : undefined}
                key={slide.id ?? index}
                onClick={() => goToSlide(index)}
              >
                <span className="draft-outline-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong className={missing ? "missing" : ""}>{slide.title.trim() || "未命名页面"}</strong>
                  <small className={missing ? "missing" : ""}>
                    {missing ? "缺少标题" : `${slideStat.points} 条要点 · ${slideStat.characters} 字`}
                  </small>
                  {!missing && slideStat.preview && <p>{slideStat.preview}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="draft-review-main">
        <div className="draft-review-heading">
          <div>
            <div className="section-kicker">内容草稿 · {narrativeStrategyLabels[draft.presentationBrief.narrativeStrategy]}</div>
            <h2>审核并编辑文字</h2>
            <p className="draft-review-meta">
              {draft.slides.length} 页 · {metrics.characters} 字 · {metrics.points} 条要点
              <span className={`draft-save-state ${saveState}`} role="status">
                {saveState === "saving" ? "保存中…" : "已自动保存"}
              </span>
            </p>
          </div>
          <label className="draft-title-field">
            演示文稿标题
            <input
              maxLength={200}
              value={draft.title}
              onChange={(event) => onDraftTitleChange(event.target.value)}
              aria-invalid={!draft.title.trim() || undefined}
              aria-describedby={!draft.title.trim() ? "draft-title-error" : undefined}
            />
            {!draft.title.trim() && (
              <small id="draft-title-error" className="draft-field-error">
                <CircleAlert />
                演示文稿标题不能为空
              </small>
            )}
          </label>
        </div>

        {firstMissing !== undefined && (
          <div className="draft-validation" role="alert">
            <CircleAlert />
            <div>
              <strong>还有 {missingIndexes.length} 页缺少标题</strong>
              <span>补全后才能确认内容并进入模板选择。</span>
            </div>
            <button type="button" className="link-action" onClick={() => goToSlide(firstMissing)}>
              定位到第 {firstMissing + 1} 页
            </button>
          </div>
        )}

        <div className="draft-slide-list" ref={listRef} onScroll={handleScroll}>
          {draft.slides.map((slide, index) => {
            const slideStat = slideMetrics(slide);
            const missing = !slide.title.trim();
            const edited = isSlideEdited(slide, originalDraft?.slides[index]);
            return (
              <article
                id={`draft-slide-${index}`}
                className={`draft-slide-card ${missing ? "invalid" : ""}`}
                data-slide-index={index}
                aria-labelledby={`draft-slide-heading-${index}`}
                key={slide.id ?? index}
              >
                <h3 id={`draft-slide-heading-${index}`} className="visually-hidden">第 {index + 1} 页</h3>
                <header className="draft-slide-header">
                  <span className="draft-slide-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="draft-slide-title-field">
                    <input
                      id={`draft-slide-title-${index}`}
                      className="draft-slide-title-input"
                      aria-label={`第 ${index + 1} 页标题`}
                      aria-invalid={missing || undefined}
                      aria-describedby={missing ? `draft-slide-title-error-${index}` : undefined}
                      placeholder="输入页面标题"
                      maxLength={200}
                      value={slide.title}
                      onChange={(event) => onSlideFieldChange(index, "title", event.target.value)}
                    />
                    {missing && (
                      <small id={`draft-slide-title-error-${index}`} className="draft-field-error">
                        <CircleAlert />
                        标题不能为空
                      </small>
                    )}
                  </div>
                  <div className="draft-slide-tools">
                    <span>
                      {slideStat.characters} 字 · {slideStat.points} 条要点
                    </span>
                    <button
                      type="button"
                      className="link-action"
                      disabled={!edited}
                      title="恢复本页 AI 生成的原始文字"
                      onClick={() => onRestoreSlide(index)}
                    >
                      <RotateCcw />
                      恢复原文
                    </button>
                  </div>
                </header>

                <details className="slide-plan">
                  <summary>
                    <span>AI 规划依据</span>
                    <small>
                      {visualIntentLabels[slide.plan.visualIntent]} · {densityLabels[slide.plan.density]}
                    </small>
                  </summary>
                  <div className="slide-plan-body">
                    <p>
                      <strong>页面目的</strong>
                      {slide.plan.purpose}
                    </p>
                    <p>
                      <strong>核心结论</strong>
                      {slide.plan.conclusion}
                    </p>
                  </div>
                </details>

                <label className="draft-body-field">
                  正文
                  <textarea
                    aria-label={`第 ${index + 1} 页正文`}
                    rows={Math.max(4, slide.body.split("\n").length + 1)}
                    maxLength={4000}
                    value={slide.body}
                    placeholder="输入本页要讲的内容"
                    onChange={(event) => onSlideFieldChange(index, "body", event.target.value)}
                  />
                </label>

                <DraftNotes
                  index={index}
                  value={slide.speakerNotes}
                  onChange={(value) => onSlideFieldChange(index, "speakerNotes", value)}
                />
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
