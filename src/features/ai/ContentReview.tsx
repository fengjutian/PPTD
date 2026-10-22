import { CircleAlert, FilePlus2, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AiDraft, ContentBlock } from "../../services/ai-service";
import {
  blockTypeLabels,
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  itemKeyAction,
  narrativeStrategyLabels,
  nearestSlideIndex,
  outlineNavTarget,
  reviewIssues,
  slideCardScrollTop,
  slideHasContent,
  slideMetrics,
  TABLE_REVIEW_MAX_COLUMNS,
  TABLE_REVIEW_MAX_ROWS,
  tableBlockOversized,
  tableCellKeyAction,
  visualIntentLabels,
  type AiDraftSaveState,
} from "./content-review";

export type SlideField = "title" | "body" | "speakerNotes";

export type ContentReviewProps = {
  draft: AiDraft;
  originalDraft?: AiDraft;
  activeIndex: number;
  saveState: AiDraftSaveState;
  /** Pages whose last "restore original" step can still be undone. */
  restoreUndoIndexes: readonly number[];
  onActiveIndexChange: (index: number) => void;
  onDraftTitleChange: (title: string) => void;
  onSlideFieldChange: (index: number, field: SlideField, value: string) => void;
  onSlideBlocksChange: (index: number, blocks: ContentBlock[]) => void;
  onRestoreSlide: (index: number) => void;
  onUndoRestore: (index: number) => void;
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

function ItemListEditor({ ariaLabel, items, max, onChange }: { ariaLabel: string; items: string[]; max: number; onChange: (items: string[]) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  // Focus has to move after React commits the new row, so the follow-up focus
  // is scheduled instead of applied to a node that is not rendered yet.
  const focusRow = (index: number) => {
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLInputElement>(`input[data-item-index="${index}"]`)?.focus();
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const action = itemKeyAction(event.key, items[index] ?? "", index, items.length, max);
    if (!action) return;
    event.preventDefault();
    if (action.type === "insert") {
      onChange([...items, ""]);
      focusRow(index + 1);
    } else {
      onChange(items.filter((_, itemIndex) => itemIndex !== index));
      focusRow(action.focus);
    }
  };
  return (
    <div className="block-item-list" ref={listRef}>
      {items.map((item, index) => (
        <div className="block-item-row" key={index}>
          <input
            aria-label={`${ariaLabel}第 ${index + 1} 条`}
            data-item-index={index}
            maxLength={500}
            placeholder="输入要点（Enter 新增下一条）"
            value={item}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onChange={(event) => onChange(items.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)))}
          />
          <button type="button" className="icon-action" aria-label={`删除${ariaLabel}第 ${index + 1} 条`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
            <X />
          </button>
        </div>
      ))}
      <button type="button" className="link-action block-add" disabled={items.length >= max} onClick={() => { onChange([...items, ""]); focusRow(items.length); }}>
        <Plus />
        添加一条
      </button>
    </div>
  );
}

/**
 * Puts the card of a page at the top of the card list.
 *
 * The list is the only container that may move. scrollIntoView scrolls every
 * scrollable ancestor, including the page, and a scrolled page shifts the
 * whole application window: the header disappears above the window and an
 * empty band shows under the status bar.
 */
function scrollCardIntoView(list: HTMLDivElement | null, index: number): void {
  const card = list?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`);
  if (!list || !card) return;
  const margin = Number.parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
  const listRect = list.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  list.scrollTo({
    top: slideCardScrollTop({ listTop: listRect.top, cardTop: cardRect.top, scrollTop: list.scrollTop, margin }),
    behavior: "smooth",
  });
}

function PairListEditor({ ariaLabel, items, max, onChange }: { ariaLabel: string; items: Array<{ label: string; text: string }>; max: number; onChange: (items: Array<{ label: string; text: string }>) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusRow = (index: number) => {
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLInputElement>(`input[data-item-index="${index}"]`)?.focus();
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const item = items[index];
    if (!item) return;
    const action = itemKeyAction(event.key, `${item.label}${item.text}`, index, items.length, max);
    if (!action) return;
    event.preventDefault();
    if (action.type === "insert") {
      onChange([...items, { label: "", text: "" }]);
      focusRow(index + 1);
    } else {
      onChange(items.filter((_, itemIndex) => itemIndex !== index));
      focusRow(action.focus);
    }
  };
  return (
    <div className="block-item-list" ref={listRef}>
      {items.map((item, index) => (
        <div className="block-pair-row" key={index}>
          <input
            aria-label={`${ariaLabel}第 ${index + 1} 条标签`}
            data-item-index={index}
            maxLength={100}
            placeholder="阶段"
            value={item.label}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onChange={(event) => onChange(items.map((value, itemIndex) => (itemIndex === index ? { ...value, label: event.target.value } : value)))}
          />
          <input
            aria-label={`${ariaLabel}第 ${index + 1} 条说明`}
            data-item-index={index}
            maxLength={500}
            placeholder="说明"
            value={item.text}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onChange={(event) => onChange(items.map((value, itemIndex) => (itemIndex === index ? { ...value, text: event.target.value } : value)))}
          />
          <button type="button" className="icon-action" aria-label={`删除${ariaLabel}第 ${index + 1} 条`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
            <X />
          </button>
        </div>
      ))}
      <button type="button" className="link-action block-add" disabled={items.length >= max} onClick={() => { onChange([...items, { label: "", text: "" }]); focusRow(items.length); }}>
        <Plus />
        添加一条
      </button>
    </div>
  );
}

/**
 * Tables are edited as a grid because the exported PowerPoint table holds the
 * same cells: the block is the reviewed data, and the grid points at it. Adding
 * or removing a row or column therefore changes the reviewed content, which is
 * why the writer does it here rather than in the design stage.
 */
function TableEditor({
  pageLabel,
  block,
  onChange,
}: {
  pageLabel: string;
  block: Extract<ContentBlock, { type: "table-data" }>;
  onChange: (block: Extract<ContentBlock, { type: "table-data" }>) => void;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const columnCount = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
  const oversized = tableBlockOversized(block);

  const focusHeaderCell = (column: number) => {
    window.requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`thead input[data-cell-column="${column}"]`)?.focus();
    });
  };
  const focusCell = (row: number, column: number) => {
    window.requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`input[data-cell-row="${row}"][data-cell-column="${column}"]`)?.focus();
    });
  };

  const setHeaderCell = (column: number, value: string) =>
    // A row may be wider than the header, and typing in that column is the
    // writer saying the column exists, so the header grows to cover it.
    onChange({
      ...block,
      header: Array.from({ length: Math.max(block.header.length, column + 1) }, (_, cellIndex) =>
        cellIndex === column ? value : block.header[cellIndex] ?? "",
      ),
    });
  // A row may arrive shorter than the header, so editing one cell pads the row
  // with empty cells instead of shifting the columns of the visible grid.
  const setBodyCell = (row: number, column: number, value: string) =>
    onChange({
      ...block,
      rows: block.rows.map((cells, rowIndex) =>
        rowIndex === row ? Array.from({ length: columnCount }, (_, cellIndex) => (cellIndex === column ? value : cells[cellIndex] ?? "")) : cells,
      ),
    });
  const addColumn = () => {
    // Adding a column aligns every row with the header, so a page that arrived
    // with ragged rows ends up with one square grid.
    onChange({
      ...block,
      header: Array.from({ length: columnCount + 1 }, (_, column) => block.header[column] ?? ""),
      rows: block.rows.map((row) => Array.from({ length: columnCount + 1 }, (_, column) => row[column] ?? "")),
    });
    focusHeaderCell(columnCount);
  };
  const removeColumn = (column: number) =>
    onChange({
      ...block,
      header: block.header.filter((_, cellIndex) => cellIndex !== column),
      rows: block.rows.map((row) => row.filter((_, cellIndex) => cellIndex !== column)),
    });
  const addRow = () => {
    onChange({ ...block, rows: [...block.rows, block.header.map(() => "")] });
    focusCell(block.rows.length, 0);
  };
  const removeRow = (row: number) => onChange({ ...block, rows: block.rows.filter((_, rowIndex) => rowIndex !== row) });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    const action = tableCellKeyAction(event.key, row, block.rows.length, block.rows.length < TABLE_REVIEW_MAX_ROWS);
    if (!action) return;
    event.preventDefault();
    if (action.type === "append-row") {
      onChange({ ...block, rows: [...block.rows, block.header.map(() => "")] });
      focusCell(block.rows.length, column);
      return;
    }
    focusCell(Math.max(0, action.row), column);
  };
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLInputElement>, column: number) => {
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    handleKeyDown(event, -1, column);
  };

  return (
    <div className={`block-table ${oversized ? "oversized" : ""}`}>
      <table ref={tableRef}>
        <thead>
          <tr>
            {Array.from({ length: columnCount }, (_, column) => (
              <th key={column}>
                <div className="table-cell">
                  <input
                    aria-label={`${pageLabel}表格表头第 ${column + 1} 列`}
                    data-cell-column={column}
                    maxLength={100}
                    placeholder={`表头 ${column + 1}`}
                    value={block.header[column] ?? ""}
                    onKeyDown={(event) => handleHeaderKeyDown(event, column)}
                    onChange={(event) => setHeaderCell(column, event.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-action"
                    aria-label={`删除${pageLabel}表格第 ${column + 1} 列`}
                    disabled={columnCount <= 1}
                    onClick={() => removeColumn(column)}
                  >
                    <X />
                  </button>
                </div>
              </th>
            ))}
            <th className="table-row-actions" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columnCount }, (_, column) => (
                <td key={column}>
                  <input
                    aria-label={`${pageLabel}表格第 ${rowIndex + 1} 行第 ${column + 1} 列`}
                    data-cell-row={rowIndex}
                    data-cell-column={column}
                    maxLength={500}
                    value={row[column] ?? ""}
                    onKeyDown={(event) => handleKeyDown(event, rowIndex, column)}
                    onChange={(event) => setBodyCell(rowIndex, column, event.target.value)}
                  />
                </td>
              ))}
              <td className="table-row-actions">
                <button
                  type="button"
                  className="icon-action"
                  aria-label={`删除${pageLabel}表格第 ${rowIndex + 1} 行`}
                  disabled={block.rows.length <= 1}
                  onClick={() => removeRow(rowIndex)}
                >
                  <X />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-actions">
        <button type="button" className="link-action" disabled={columnCount >= TABLE_REVIEW_MAX_COLUMNS} onClick={addColumn}>
          <Plus />
          添加一列
        </button>
        <button type="button" className="link-action" disabled={block.rows.length >= TABLE_REVIEW_MAX_ROWS} onClick={addRow}>
          <Plus />
          添加一行
        </button>
      </div>
      <small className={oversized ? "table-warning" : undefined}>
        {oversized
          ? `表格超过可编辑上限（最多 ${TABLE_REVIEW_MAX_COLUMNS} 列、${TABLE_REVIEW_MAX_ROWS} 行），请删减后再确认。`
          : "单元格作为结构化数据保存，导出为可编辑的 PowerPoint 表格。"}
      </small>
    </div>
  );
}

/**
 * Structured pages are edited through their blocks, because a block is what
 * the renderer draws. Editing only the body string here used to flatten a
 * metric, comparison or timeline page into a bullet list.
 */
function BlockEditor({ slideIndex, blocks, onChange }: { slideIndex: number; blocks: ContentBlock[]; onChange: (blocks: ContentBlock[]) => void }) {
  const replace = (index: number, block: ContentBlock) => onChange(blocks.map((current, currentIndex) => (currentIndex === index ? block : current)));
  const remove = (index: number) => onChange(blocks.filter((_, currentIndex) => currentIndex !== index));
  const pageLabel = `第 ${slideIndex + 1} 页`;
  return (
    <div className="block-editor">
      {blocks.map((block, index) => {
        const typeLabel = blockTypeLabels[block.type];
        return (
          <section className={`block-row ${block.type}`} key={`${block.type}-${index}`} aria-label={`${pageLabel}的${typeLabel}`}>
            <header className="block-row-header">
              <span className="block-type">{typeLabel}</span>
              <button type="button" className="icon-action" aria-label={`删除${pageLabel}的${typeLabel}`} onClick={() => remove(index)}>
                <X />
              </button>
            </header>
            {block.type === "paragraph" && (
              <textarea
                aria-label={`${pageLabel}段落`}
                rows={3}
                maxLength={2000}
                placeholder="输入本页正文"
                value={block.text}
                onChange={(event) => replace(index, { ...block, text: event.target.value })}
              />
            )}
            {block.type === "quote" && (
              <>
                <textarea
                  aria-label={`${pageLabel}引用内容`}
                  rows={2}
                  maxLength={2000}
                  placeholder="输入引用原文"
                  value={block.text}
                  onChange={(event) => replace(index, { ...block, text: event.target.value })}
                />
                <input
                  aria-label={`${pageLabel}引用出处`}
                  maxLength={300}
                  placeholder="出处（可选）"
                  value={block.attribution ?? ""}
                  onChange={(event) => replace(index, { ...block, attribution: event.target.value || undefined })}
                />
              </>
            )}
            {block.type === "bullet-list" && (
              <ItemListEditor ariaLabel={`${pageLabel}要点`} items={block.items} max={12} onChange={(items) => replace(index, { ...block, items })} />
            )}
            {block.type === "metric" && (
              <div className="block-pair-row">
                <input
                  aria-label={`${pageLabel}指标名称`}
                  maxLength={300}
                  placeholder="指标名称"
                  value={block.label}
                  onChange={(event) => replace(index, { ...block, label: event.target.value })}
                />
                <input
                  aria-label={`${pageLabel}指标数值`}
                  maxLength={100}
                  placeholder="数值"
                  value={block.value}
                  onChange={(event) => replace(index, { ...block, value: event.target.value })}
                />
              </div>
            )}
            {(block.type === "timeline" || block.type === "process") && (
              <PairListEditor ariaLabel={`${pageLabel}${typeLabel}`} items={block.items} max={10} onChange={(items) => replace(index, { ...block, items })} />
            )}
            {block.type === "comparison" && (
              <>
                <div className="block-pair-row">
                  <input
                    aria-label={`${pageLabel}左侧标题`}
                    maxLength={100}
                    value={block.leftLabel}
                    onChange={(event) => replace(index, { ...block, leftLabel: event.target.value })}
                  />
                  <input
                    aria-label={`${pageLabel}右侧标题`}
                    maxLength={100}
                    value={block.rightLabel}
                    onChange={(event) => replace(index, { ...block, rightLabel: event.target.value })}
                  />
                </div>
                <ItemListEditor ariaLabel={`${pageLabel}左侧要点`} items={block.leftItems} max={8} onChange={(leftItems) => replace(index, { ...block, leftItems })} />
                <ItemListEditor ariaLabel={`${pageLabel}右侧要点`} items={block.rightItems} max={8} onChange={(rightItems) => replace(index, { ...block, rightItems })} />
              </>
            )}
            {block.type === "table-data" && (
              <TableEditor pageLabel={pageLabel} block={block} onChange={(next) => replace(index, next)} />
            )}
          </section>
        );
      })}
      <div className="block-add-row">
        <button type="button" className="link-action" onClick={() => onChange([...blocks, { type: "paragraph", text: "" }])}>
          <Plus />
          添加段落
        </button>
        <button type="button" className="link-action" onClick={() => onChange([...blocks, { type: "bullet-list", items: [""] }])}>
          <Plus />
          添加要点
        </button>
      </div>
    </div>
  );
}


export function ContentReview({
  draft,
  originalDraft,
  activeIndex,
  saveState,
  restoreUndoIndexes,
  onActiveIndexChange,
  onDraftTitleChange,
  onSlideFieldChange,
  onSlideBlocksChange,
  onRestoreSlide,
  onUndoRestore,
  onNewDraft,
}: ContentReviewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const scrollLock = useRef<number | null>(null);
  const scrollLockTimer = useRef<number | undefined>(undefined);

  const metrics = draftMetrics(draft);
  const issues = reviewIssues(draft);
  // Both the outline and the cards show the same numbers; computing them once
  // per draft keeps a ten page review from re-splitting every body on each keypress.
  const slideStats = useMemo(() => draft.slides.map((slide) => slideMetrics(slide)), [draft]);

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

  const goToSlide = (index: number, focus: "title" | "outline" = "title") => {
    onActiveIndexChange(index);
    scrollLock.current = index;
    window.clearTimeout(scrollLockTimer.current);
    scrollLockTimer.current = window.setTimeout(() => {
      scrollLock.current = null;
    }, 450);
    scrollCardIntoView(listRef.current, index);
    if (focus === "title") document.getElementById(`draft-slide-title-${index}`)?.focus({ preventScroll: true });  };

  // The outline is one tab stop with arrow-key movement, so a ten page draft
  // does not require ten Tab presses before the writer reaches the page body.
  const focusOutline = (index: number) => {
    goToSlide(index, "outline");
    outlineRef.current?.querySelector<HTMLElement>(`[data-outline-index="${index}"]`)?.focus({ preventScroll: true });
  };

  const handleOutlineKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = outlineNavTarget(event.key, index, draft.slides.length);
    if (next === undefined) return;
    event.preventDefault();
    focusOutline(next);
  };

  // The outline follows the page the reader is actually looking at. The lock
  // prevents a smooth programmatic scroll from briefly highlighting pages in
  // between the origin and the destination.
  const handleScroll = () => {
    if (scrollLock.current !== null) return;
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    const cards = [...list.querySelectorAll<HTMLElement>("[data-slide-index]")].map((card) => ({
      index: Number(card.dataset.slideIndex),
      top: card.getBoundingClientRect().top,
    }));
    const nearest = nearestSlideIndex(cards, listTop);
    if (nearest !== undefined && nearest !== activeIndex) onActiveIndexChange(nearest);
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
            const slideStat = slideStats[index]!;
            const missing = !slide.title.trim();
            const empty = !slideHasContent(slide);
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
                    {missing ? "缺少标题" : empty ? "还没有内容" : `${slideStat.points} 条要点 · ${slideStat.characters} 字`}
                  </small>
                  {!missing && !empty && slideStat.preview && <p>{slideStat.preview}</p>}
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

        {issues.length > 0 && (
          <div className="draft-validation" role="alert">
            <CircleAlert />
            <div>
              {issues.map((issue) => (
                <p key={issue.kind} className={issue.blocking ? "" : "warning"}>
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

        <div className="draft-slide-list" ref={listRef} onScroll={handleScroll}>
          {draft.slides.map((slide, index) => {
            const slideStat = slideStats[index]!;
            const missing = !slide.title.trim();
            const empty = !slideHasContent(slide);
            const edited = isSlideEdited(slide, originalDraft?.slides[index]);
            const canUndoRestore = restoreUndoIndexes.includes(index);
            return (
              <article
                id={`draft-slide-${index}`}
                className={`draft-slide-card ${missing || empty ? "invalid" : ""}`}
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
                    {canUndoRestore ? (
                      <button type="button" className="link-action" title="撤销刚才的恢复操作，回到恢复前的内容" onClick={() => onUndoRestore(index)}>
                        <Undo2 />
                        撤销恢复
                      </button>
                    ) : (
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
                    )}
                  </div>
                </header>

                {empty && (
                  <small className="draft-field-error block-empty-note">
                    <CircleAlert />
                    本页还没有内容，补全后才能确认
                  </small>
                )}

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

                {slide.blocks.length > 0 ? (
                  <BlockEditor slideIndex={index} blocks={slide.blocks} onChange={(blocks) => onSlideBlocksChange(index, blocks)} />
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
