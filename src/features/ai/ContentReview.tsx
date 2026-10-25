import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  CircleAlert,
  Copy,
  Loader2,
  Mic,
  Plus,
  Redo2,
  RotateCcw,
  ScanText,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AiVisualAssetIntent } from "../../services/ai-service";
import {
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  narrativeStrategyLabels,
  outlineNavTarget,
  reviewIssues,
  slideCapacityNotes,
  slideHasContent,
  slideMetrics,
  TITLE_LENGTH_BUDGET,
  titleOverBudget,
  unverifiedCheckCount,
  visualIntentLabels,
  visualAssetRoleLabels,
} from "./content-review";

export type SlideField = "title" | "body" | "speakerNotes";

/**
 * 当前活动页的画面描述候选。
 *
 * 配图描述是"这一页要一张什么样的图"的意图，不是图片本身；候选只在活动页的
 * 配图折叠区里出现，选中即写入配图意图（source: "user"）。
 */
export type ImagePromptAssist = {
  index: number;
  status: "running" | "ready" | "error";
  candidates?: string[];
  error?: string;
};

/**
 * What the reviewed copy does to the page it will be laid out on.
 *
 * The notes are advisory: the page is not blocked by them, because whether a
 * page is full enough is a judgement the writer makes, not a defect the tool
 * can decide. They hang on the part of the page they talk about, so the
 * advice is read next to the text it belongs to.
 */

import { BlockEditor, CapacityNotes, DraftNotes, type ContentReviewProps } from "./ContentBlockEditors";

export function ContentReview({
  draft,
  originalDraft,
  activeIndex,
  saveState,
  restoreUndoSlideIds,
  canUndo,
  canRedo,
  regenerating,
  regenerateProgress,
  onActiveIndexChange,
  onDraftTitleChange,
  onSlideFieldChange,
  onSlideVisualAssetChange,
  onSlideBlocksChange,
  onSlideChecksChange,
  onSlideReviewedChange,
  onReviewAllSlides,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onMoveSlide,
  onRestoreSlide,
  onUndoRestore,
  onRewriteSlide,
  onSuggestTitle,
  onWriteNotes,
  onSplitSlide,
  onReviewDeck,
  imagePromptAssist,
  onSuggestImagePrompts,
  onDismissImagePrompts,
  onUndo,
  onRedo,
}: ContentReviewProps) {
  const outlineRef = useRef<HTMLDivElement>(null);
  const [pendingPageDelete, setPendingPageDelete] = useState<string>();

  const metrics = draftMetrics(draft);
  const issues = useMemo(() => reviewIssues(draft), [draft]);
  // 素材事实：这一稿的引用表。按事实统计被哪几页引用，审核时能直接看出
  // "哪条数据只用了一次、哪条一次都没用"。
  const facts = draft.sourceFacts ?? [];
  const factUsage = useMemo(() => {
    const usage = new Map<string, number[]>();
    draft.slides.forEach((slide, index) => {
      (slide.factRefs ?? []).forEach((id) => usage.set(id, [...(usage.get(id) ?? []), index]));
    });
    return usage;
  }, [draft.slides]);
  // Both the outline and the cards show the same numbers; computing them once
  // per draft keeps a ten page review from re-splitting every body on each keypress.
  const slideStats = useMemo(() => draft.slides.map((slide) => slideMetrics(slide)), [draft]);
  // The capacity notes are measured from the same copy the renderer lays out,
  // so they are computed once per draft as well.
  const slideNotes = useMemo(() => draft.slides.map((slide, index) => slideCapacityNotes(slide, index)), [draft]);
  const originalSlidesById = useMemo(
    () => new Map((originalDraft?.slides ?? []).flatMap((slide) => (slide.id ? [[slide.id, slide] as const] : []))),
    [originalDraft],
  );
  const editedIndexes = useMemo(
    () =>
      draft.slides.flatMap((slide, index) => {
        if (!originalDraft) return [];
        const original = slide.id ? originalSlidesById.get(slide.id) : undefined;
        return !original || isSlideEdited(slide, original) ? [index] : [];
      }),
    [draft, originalDraft, originalSlidesById],
  );
  const reviewedIndexes = useMemo(
    () => draft.slides.flatMap((slide, index) => (slide.reviewed ? [index] : [])),
    [draft],
  );
  const issueIndexes = useMemo(
    () => [...new Set(issues.flatMap((issue) => issue.indexes))].sort((left, right) => left - right),
    [issues],
  );

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

  const goToSlide = (index: number, focus: "title" | "outline" = "title") => {
    onActiveIndexChange(index);
    if (focus === "title")
      window.requestAnimationFrame(() =>
        document.getElementById(`draft-slide-title-${index}`)?.focus({ preventScroll: true }),
      );
  };

  // The outline is one tab stop with arrow-key movement, so a ten page draft
  // does not require ten Tab presses before the writer reaches the page body.
  const focusOutline = (index: number) => {
    goToSlide(index, "outline");
    outlineRef.current?.querySelector<HTMLElement>(`[data-outline-index="${index}"]`)?.focus({ preventScroll: true });
  };

  const goToNextIssue = () => {
    if (issueIndexes.length === 0) return;
    const next = issueIndexes.find((index) => index > activeIndex) ?? issueIndexes[0]!;
    goToSlide(next);
  };
  const goToNextUnreviewed = () => {
    const unreviewed = draft.slides.flatMap((slide, index) => (slide.reviewed ? [] : [index]));
    if (unreviewed.length === 0) return;
    goToSlide(unreviewed.find((index) => index > activeIndex) ?? unreviewed[0]!);
  };

  const handleOutlineKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = outlineNavTarget(event.key, index, draft.slides.length);
    if (next === undefined) return;
    event.preventDefault();
    focusOutline(next);
  };

  return (
    <section
      className="draft-review"
      onKeyDownCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
        // 审核页自己拥有撤销语义。只 preventDefault 不会阻止 window 上的
        // 编辑器快捷键，结果一次 Ctrl+Z 同时撤销草稿和画布文档。
        event.stopPropagation();
        if (event.shiftKey) {
          if (!canRedo) return;
          event.preventDefault();
          onRedo();
          return;
        }
        if (!canUndo) return;
        event.preventDefault();
        onUndo();
      }}
    >
      <aside className="draft-outline" aria-label="PPT 内容大纲">
        <div className="draft-outline-title">
          <div>
            <strong>PPT 内容</strong>
            <span>{draft.slides.length} 页</span>
          </div>
          <div className="draft-outline-actions">
            <button type="button" className="link-action" onClick={() => onAddSlide(activeIndex)}>
              <Plus />
              新增页面
            </button>
          </div>
        </div>
        <div className="draft-outline-list" ref={outlineRef}>
          {draft.slides.map((slide, index) => {
            const slideStat = slideStats[index]!;
            const missing = !slide.title.trim();
            const empty = !slideHasContent(slide);
            const warned = slideNotes[index]?.some((note) => note.severity === "warning") ?? false;
            const original = slide.id ? originalSlidesById.get(slide.id) : undefined;
            const edited = Boolean(originalDraft && (!original || isSlideEdited(slide, original)));
            return (
              <button
                type="button"
                className={activeIndex === index ? "active" : ""}
                aria-current={activeIndex === index ? "page" : undefined}
                data-outline-index={index}
                tabIndex={activeIndex === index ? 0 : -1}
                key={slide.id ?? index}
                onClick={() => goToSlide(index)}
                onKeyDown={(event) => handleOutlineKeyDown(event, index)}
              >
                <span className="draft-outline-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong className={missing ? "missing" : ""}>{slide.title.trim() || "未命名页面"}</strong>
                  <small className={missing || empty ? "missing" : ""}>
                    {missing
                      ? "缺少标题"
                      : empty
                        ? "还没有内容"
                        : `${slideStat.points} 条要点 · ${slideStat.characters} 字`}
                  </small>
                  {!missing && !empty && slideStat.preview && <p>{slideStat.preview}</p>}
                  {warned && (
                    <span className="draft-outline-warning">
                      <CircleAlert />
                      排版预检
                    </span>
                  )}
                  {edited && <span className="draft-outline-edited">已修改</span>}
                  {slide.reviewed && <span className="draft-outline-reviewed">已审核</span>}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="draft-review-main">
        <div className="draft-review-heading">
          <div>
            <div className="section-kicker">
              内容草稿 · {narrativeStrategyLabels[draft.presentationBrief.narrativeStrategy]}
            </div>
            <h2>审核并编辑文字</h2>
            <p className="draft-review-meta">
              {draft.slides.length} 页 · {metrics.characters} 字 · {metrics.points} 条要点
              {editedIndexes.length > 0 && (
                <span className="draft-edited-summary">{editedIndexes.length} 页已修改</span>
              )}
              <span className="draft-reviewed-summary">
                {reviewedIndexes.length}/{draft.slides.length} 页已审核
              </span>
              {facts.length > 0 && (
                <span className="draft-facts-summary">
                  {facts.length} 条素材事实 · {factUsage.size} 条被引用
                </span>
              )}
              <span className={`draft-save-state ${saveState}`} role="status">
                {saveState === "saving" ? "保存中…" : "已自动保存"}
              </span>
            </p>
            {facts.length > 0 && (
              <details className="draft-facts">
                <summary>
                  查看素材事实（{facts.length} 条，{facts.length - factUsage.size} 条未引用）
                </summary>
                <ol>
                  {facts.map((fact) => {
                    const pages = factUsage.get(fact.id) ?? [];
                    return (
                      <li key={fact.id}>
                        <span className="draft-fact-id">{fact.id}</span>
                        <span className="draft-fact-statement">{fact.statement}</span>
                        <span className="draft-fact-meta">
                          {[
                            [fact.period, fact.source].filter(Boolean).join(" · "),
                            pages.length > 0 ? `第 ${pages.map((index) => index + 1).join("、")} 页` : "未引用",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </details>
            )}
          </div>
          <div className="draft-heading-actions">
            <div className="draft-history-actions" role="group" aria-label="内容编辑历史">
              {issueIndexes.length > 0 && (
                <button
                  type="button"
                  className="secondary-action icon-only draft-next-issue"
                  aria-label="下一处问题"
                  title="下一处问题"
                  onClick={goToNextIssue}
                >
                  <CircleAlert />
                </button>
              )}
              {reviewedIndexes.length < draft.slides.length && (
                <button
                  type="button"
                  className="secondary-action icon-only"
                  aria-label="下一未审核页"
                  title="下一未审核页"
                  onClick={goToNextUnreviewed}
                >
                  <ArrowDown />
                </button>
              )}
              {reviewedIndexes.length < draft.slides.length && (
                <button
                  type="button"
                  className="secondary-action icon-only"
                  aria-label="全部标记已审核"
                  title="全部标记已审核"
                  disabled={issues.some((issue) => issue.blocking)}
                  onClick={onReviewAllSlides}
                >
                  <CheckCheck />
                </button>
              )}
              <button
                type="button"
                className="secondary-action icon-only"
                aria-label="AI 审稿"
                title="通读全稿，只列出内容层的问题，不自动改文字"
                disabled={regenerating}
                onClick={onReviewDeck}
              >
                <ScanText />
              </button>
              <button
                type="button"
                className="secondary-action icon-only"
                aria-label="撤销"
                title="撤销"
                disabled={!canUndo}
                onClick={onUndo}
              >
                <Undo2 />
              </button>
              <button
                type="button"
                className="secondary-action icon-only"
                aria-label="重做"
                title="重做"
                disabled={!canRedo}
                onClick={onRedo}
              >
                <Redo2 />
              </button>
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
        </div>

        {regenerating && (
          <div className="draft-regenerate-progress" role="status" aria-live="polite">
            <div>
              <strong>{regenerateProgress?.label || "正在重新生成整份草稿…"}</strong>
              <span>生成期间当前内容保持不变；新版本替换后可以用撤销回到这一版。</span>
            </div>
            <div
              className="design-progress-track"
              aria-label="草稿重新生成进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={regenerateProgress?.percent ?? 0}
              role="progressbar"
            >
              <i style={{ width: `${regenerateProgress?.percent ?? 0}%` }} />
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <div className="draft-validation" role="alert">
            <CircleAlert />
            <div>
              {issues.map((issue) => (
                <p key={`${issue.kind}:${issue.indexes.join("-")}`} className={issue.blocking ? "" : "warning"}>
                  <strong>{issue.message}</strong>
                  <button type="button" className="link-action" onClick={() => goToSlide(issue.indexes[0]!)}>
                    定位到第 {issue.indexes[0]! + 1} 页
                  </button>
                </p>
              ))}
              <span>补全后才能确认内容并进入模板选择。</span>
            </div>
          </div>
        )}

        <div className="draft-slide-list" aria-live="polite">
          {draft.slides.map((slide, index) => {
            if (index !== activeIndex) return null;
            const slideStat = slideStats[index]!;
            const notes = slideNotes[index] ?? [];
            const imageIssues = issues.filter(
              (issue) => issue.kind.startsWith("image-") && issue.indexes.includes(index),
            );
            const missing = !slide.title.trim();
            const empty = !slideHasContent(slide);
            const original = slide.id ? originalSlidesById.get(slide.id) : undefined;
            const edited = Boolean(originalDraft && (!original || isSlideEdited(slide, original)));
            const canUndoRestore = Boolean(slide.id && restoreUndoSlideIds.includes(slide.id));
            const confirmingDelete = Boolean(slide.id && pendingPageDelete === slide.id);
            const unverified = unverifiedCheckCount(slide);
            const citationTitle = (slide.factRefs ?? [])
              .map((id) => facts.find((fact) => fact.id === id))
              .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
              .map((fact) => `${fact.id}：${fact.statement}`)
              .join("\n");
            return (
              <article
                id={`draft-slide-${index}`}
                className={`draft-slide-card active ${missing || empty ? "invalid" : ""}`}
                data-slide-index={index}
                aria-labelledby={`draft-slide-heading-${index}`}
                key={slide.id ?? index}
              >
                <h3 id={`draft-slide-heading-${index}`} className="visually-hidden">
                  第 {index + 1} 页
                </h3>
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
                    <CapacityNotes
                      notes={notes.filter((note) => note.scope === "title")}
                      label={`第 ${index + 1} 页标题的排版预检`}
                    />
                  </div>
                  <div className="draft-slide-tools">
                    <span className="draft-slide-status-line">
                      {slideStat.characters} 字 · {slideStat.points} 条要点
                      {titleOverBudget(slide.title) && (
                        <b
                          className="draft-long-title-badge"
                          title={`标题 ${countCharacters(slide.title)} 字。超过 ${TITLE_LENGTH_BUDGET} 字的标题会被压小字号或折成三行，精简到一行更像成品。`}
                        >
                          标题偏长
                        </b>
                      )}
                      {(slide.factRefs ?? []).length > 0 && (
                        <b className="draft-citation-badge" title={citationTitle}>
                          引用 {(slide.factRefs ?? []).join("、")}
                        </b>
                      )}
                      {unverified > 0 && <b className="draft-unverified-badge">{unverified} 处待核实</b>}
                      {edited && <b className="draft-edited-badge">已修改</b>}
                    </span>
                    <div className="draft-page-actions" role="group" aria-label={`第 ${index + 1} 页页面操作`}>
                      <button
                        type="button"
                        className="link-action icon-action"
                        aria-label={`上移第 ${index + 1} 页`}
                        title="上移页面"
                        disabled={index === 0}
                        onClick={() => onMoveSlide(index, index - 1)}
                      >
                        <ArrowUp />
                      </button>
                      <button
                        type="button"
                        className="link-action icon-action"
                        aria-label={`下移第 ${index + 1} 页`}
                        title="下移页面"
                        disabled={index === draft.slides.length - 1}
                        onClick={() => onMoveSlide(index, index + 1)}
                      >
                        <ArrowDown />
                      </button>
                      <button
                        type="button"
                        className="link-action icon-action"
                        aria-label={`复制第 ${index + 1} 页`}
                        title="复制页面"
                        onClick={() => onDuplicateSlide(index)}
                      >
                        <Copy />
                      </button>
                      {confirmingDelete ? (
                        <>
                          <button
                            type="button"
                            className="link-action danger-action"
                            onClick={() => {
                              onDeleteSlide(index);
                              setPendingPageDelete(undefined);
                            }}
                          >
                            确认删除
                          </button>
                          <button type="button" className="link-action" onClick={() => setPendingPageDelete(undefined)}>
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="link-action icon-action"
                          aria-label={`删除第 ${index + 1} 页`}
                          title={draft.slides.length <= 1 ? "至少保留一页" : "删除页面"}
                          disabled={draft.slides.length <= 1}
                          onClick={() => setPendingPageDelete(slide.id)}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                    {canUndoRestore ? (
                      <button
                        type="button"
                        className="link-action"
                        title="撤销刚才的恢复操作，回到恢复前的内容"
                        onClick={() => onUndoRestore(index)}
                      >
                        <Undo2 />
                        撤销恢复
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link-action"
                        disabled={!edited || !original}
                        title={
                          original
                            ? "恢复本页 AI 生成的原始文字；此操作也可通过顶部撤销按钮回退"
                            : "新增或复制的页面没有对应的 AI 原稿"
                        }
                        onClick={() => onRestoreSlide(index)}
                      >
                        <RotateCcw />
                        恢复 AI 原稿
                      </button>
                    )}
                    <div className="draft-ai-actions" role="group" aria-label={`第 ${index + 1} 页 AI 操作`}>
                      <button
                        type="button"
                        className="link-action"
                        disabled={missing || regenerating}
                        title={
                          missing ? "先补全页面标题：标题是这一页重写的依据" : "按这一页的内容给几个结论式标题候选"
                        }
                        onClick={() => onSuggestTitle(index)}
                      >
                        <Type />
                        AI 换标题
                      </button>
                      <button
                        type="button"
                        className="link-action"
                        disabled={missing || regenerating}
                        title={
                          missing
                            ? "先补全页面标题：标题是这一页重写的依据"
                            : "让 AI 按本页标题和页面计划重写正文与演讲备注；对照后确认才替换，替换可撤销"
                        }
                        onClick={() => onRewriteSlide(index)}
                      >
                        <Wand2 />
                        AI 重写
                      </button>
                      <button
                        type="button"
                        className="link-action"
                        disabled={missing || regenerating}
                        title="只写这一页的演讲备注，不改正文"
                        onClick={() => onWriteNotes(index)}
                      >
                        <Mic />
                        AI 备注
                      </button>
                      <button
                        type="button"
                        className="link-action"
                        disabled={missing || regenerating}
                        title="把这一页的内容重新分成两页；确认后替换原页，可撤销"
                        onClick={() => onSplitSlide(index)}
                      >
                        <Scissors />
                        AI 拆页
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`review-toggle ${slide.reviewed ? "reviewed" : ""}`}
                      aria-pressed={slide.reviewed}
                      disabled={missing || empty}
                      onClick={() => onSlideReviewedChange(index, !slide.reviewed)}
                    >
                      {slide.reviewed ? "已审核" : "标记已审核"}
                    </button>
                  </div>
                </header>

                {empty && (
                  <small className="draft-field-error block-empty-note">
                    <CircleAlert />
                    本页还没有内容，补全后才能确认
                  </small>
                )}

                <CapacityNotes
                  notes={notes.filter((note) => note.blockIndex === undefined && note.scope !== "title")}
                  label={`第 ${index + 1} 页的排版预检`}
                />

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

                {slide.plan.visualAsset && (
                  <details className="slide-plan visual-asset-plan" open={imageIssues.length > 0}>
                    <summary>
                      <span>页面配图</span>
                      <small>
                        {slide.plan.visualAsset.enabled
                          ? `${visualAssetRoleLabels[slide.plan.visualAsset.role]} · ${slide.plan.visualAsset.prompt.trim() ? "已描述" : "没有画面描述"}`
                          : "不配图"}
                      </small>
                    </summary>
                    <div className="slide-plan-body">
                      <div className="visual-asset-controls">
                        <label className="visual-asset-toggle">
                          <input
                            type="checkbox"
                            checked={slide.plan.visualAsset.enabled}
                            onChange={(event) =>
                              onSlideVisualAssetChange(index, {
                                ...slide.plan.visualAsset!,
                                enabled: event.target.checked,
                                source: "user",
                              })
                            }
                          />
                          这一页配图
                        </label>
                        <select
                          aria-label={`第 ${index + 1} 页配图角色`}
                          value={slide.plan.visualAsset.role}
                          disabled={!slide.plan.visualAsset.enabled}
                          onChange={(event) =>
                            onSlideVisualAssetChange(index, {
                              ...slide.plan.visualAsset!,
                              role: event.target.value as AiVisualAssetIntent["role"],
                              source: "user",
                            })
                          }
                        >
                          {Object.entries(visualAssetRoleLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        className="visual-asset-prompt"
                        aria-label={`第 ${index + 1} 页画面描述`}
                        placeholder="例如：一间明亮的现代化数据中心，几何线条构成的上升箭头"
                        maxLength={300}
                        rows={2}
                        disabled={!slide.plan.visualAsset.enabled}
                        value={slide.plan.visualAsset.prompt}
                        onChange={(event) =>
                          onSlideVisualAssetChange(index, {
                            ...slide.plan.visualAsset!,
                            prompt: event.target.value,
                            source: "user",
                          })
                        }
                      />
                      <p className="visual-asset-hint">
                        只描述画面本身，不要写标题或正文文字——生成的文字在演示里几乎总是错的。
                      </p>
                      <div className="visual-asset-ai">
                        <button
                          type="button"
                          className="link-action"
                          disabled={!slide.plan.visualAsset.enabled || regenerating}
                          title="按这一页的内容给两个画面描述候选；选中即写入，可撤销"
                          onClick={() => onSuggestImagePrompts(index)}
                        >
                          <Wand2 />
                          AI 写画面描述
                        </button>
                        {imagePromptAssist?.index === index && (
                          <div className="visual-asset-suggestions" aria-live="polite">
                            {imagePromptAssist.status === "running" && (
                              <p>
                                <Loader2 className="spin" />
                                正在按这一页的内容想画面…
                              </p>
                            )}
                            {imagePromptAssist.status === "error" && (
                              <p className="visual-asset-error" role="alert">
                                {imagePromptAssist.error}
                              </p>
                            )}
                            {imagePromptAssist.candidates?.map((candidate, candidateIndex) => (
                              <button
                                key={candidateIndex}
                                type="button"
                                className="visual-asset-suggestion"
                                onClick={() => {
                                  onSlideVisualAssetChange(index, {
                                    ...slide.plan.visualAsset!,
                                    prompt: candidate,
                                    source: "user",
                                  });
                                  onDismissImagePrompts();
                                }}
                              >
                                {candidate}
                              </button>
                            ))}
                            <button type="button" className="link-action" onClick={onDismissImagePrompts}>
                              收起
                            </button>
                          </div>
                        )}
                      </div>
                      {imageIssues.length > 0 && (
                        <ul className="visual-asset-issues" aria-label={`第 ${index + 1} 页的配图问题`}>
                          {imageIssues.map((issue, issueIndex) => (
                            <li key={`${issue.kind}:${issueIndex}`}>
                              <CircleAlert />
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                )}

                {slide.blocks.length > 0 ? (
                  <BlockEditor
                    slideIndex={index}
                    blocks={slide.blocks}
                    checks={slide.checks ?? []}
                    notes={notes}
                    onChange={(blocks, separateHistory, blockRemap) =>
                      onSlideBlocksChange(index, blocks, separateHistory, blockRemap)
                    }
                    onChecksChange={(checks) => onSlideChecksChange(index, checks)}
                  />
                ) : (
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
                )}

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
