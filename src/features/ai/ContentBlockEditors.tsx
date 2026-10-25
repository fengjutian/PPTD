import { ArrowDown, ArrowUp, CircleAlert, Plus, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type {
  AiDraft,
  AiVisualAssetIntent,
  ContentBlock,
  ContentCheck,
  ContentCheckKind,
} from "../../services/ai-service";
import {
  blockTypeLabels,
  checkKindLabels,
  checkStatusLabels,
  countCharacters,
  itemKeyAction,
  TABLE_REVIEW_MAX_COLUMNS,
  TABLE_REVIEW_MAX_ROWS,
  tableBlockOversized,
  tableCellKeyAction,
  type AiDraftSaveState,
  type SlideCapacityNote,
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

export function CapacityNotes({ notes, label }: { notes: readonly SlideCapacityNote[]; label: string }) {
  if (notes.length === 0) return null;
  return (
    <ul className="capacity-notes" aria-label={label}>
      {notes.map((note, noteIndex) => (
        <li key={noteIndex} className={note.severity === "warning" ? "warning" : "info"}>
          <CircleAlert />
          {note.message}
        </li>
      ))}
    </ul>
  );
}

export type ContentReviewProps = {
  draft: AiDraft;
  originalDraft?: AiDraft;
  activeIndex: number;
  saveState: AiDraftSaveState;
  /** Pages whose last "restore original" step can still be undone. */
  restoreUndoSlideIds: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  /** 整份草稿正在按同一主题重新生成；这段时间旧内容保持可见。 */
  regenerating: boolean;
  /** 重新生成的进度；生成结束后为空。 */
  regenerateProgress?: { label: string; percent: number };
  onActiveIndexChange: (index: number) => void;
  onDraftTitleChange: (title: string) => void;
  onSlideFieldChange: (index: number, field: SlideField, value: string) => void;
  /** 这一页的配图意图变了。审核阶段是唯一还没花钱生成图片的时机。 */
  onSlideVisualAssetChange: (index: number, intent: AiVisualAssetIntent) => void;
  onSlideBlocksChange: (
    index: number,
    blocks: ContentBlock[],
    separateHistory?: boolean,
    blockRemap?: (oldIndex: number) => number | undefined,
  ) => void;
  /** 这一页的核实标记。标记是人工动作，AI 不替人确认事实。 */
  onSlideChecksChange: (index: number, checks: ContentCheck[]) => void;
  onSlideReviewedChange: (index: number, reviewed: boolean) => void;
  onReviewAllSlides: () => void;
  onAddSlide: (afterIndex: number) => void;
  onDuplicateSlide: (index: number) => void;
  onDeleteSlide: (index: number) => void;
  onMoveSlide: (index: number, destination: number) => void;
  onRestoreSlide: (index: number) => void;
  onUndoRestore: (index: number) => void;
  /** 让 AI 按这一页的标题和页面计划重写正文；结果先对照，确认后才替换。 */
  onRewriteSlide: (index: number) => void;
  /** 给这一页拟几个结论式标题候选。 */
  onSuggestTitle: (index: number) => void;
  /** 只写这一页的演讲备注，不动正文。 */
  onWriteNotes: (index: number) => void;
  /** 把过满的一页拆成两页。 */
  onSplitSlide: (index: number) => void;
  /** 通读全稿，只给内容层的问题清单。 */
  onReviewDeck: () => void;
  /** 当前活动页的画面描述候选。 */
  imagePromptAssist?: ImagePromptAssist;
  /** 让 AI 按这一页的内容拟画面描述。 */
  onSuggestImagePrompts: (index: number) => void;
  onDismissImagePrompts: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

export function DraftNotes({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (value: string) => void;
}) {
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

export function ItemListEditor({
  ariaLabel,
  items,
  max,
  onChange,
}: {
  ariaLabel: string;
  items: string[];
  max: number;
  onChange: (items: string[]) => void;
}) {
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
      // Insert after the row being edited; the focus target is the new row.
      // Appending at the end and focusing index+1 used to overwrite a
      // pre-existing row's text.
      onChange([...items.slice(0, index + 1), "", ...items.slice(index + 1)]);
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
            onChange={(event) =>
              onChange(items.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)))
            }
          />
          <button
            type="button"
            className="icon-action"
            aria-label={`删除${ariaLabel}第 ${index + 1} 条`}
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          >
            <X />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="link-action block-add"
        disabled={items.length >= max}
        onClick={() => {
          onChange([...items, ""]);
          focusRow(items.length);
        }}
      >
        <Plus />
        添加一条
      </button>
    </div>
  );
}

export function PairListEditor({
  ariaLabel,
  items,
  max,
  onChange,
}: {
  ariaLabel: string;
  items: Array<{ label: string; text: string }>;
  max: number;
  onChange: (items: Array<{ label: string; text: string }>) => void;
}) {
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
      onChange([...items.slice(0, index + 1), { label: "", text: "" }, ...items.slice(index + 1)]);
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
            onChange={(event) =>
              onChange(
                items.map((value, itemIndex) =>
                  itemIndex === index ? { ...value, label: event.target.value } : value,
                ),
              )
            }
          />
          <input
            aria-label={`${ariaLabel}第 ${index + 1} 条说明`}
            data-item-index={index}
            maxLength={500}
            placeholder="说明"
            value={item.text}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onChange={(event) =>
              onChange(
                items.map((value, itemIndex) => (itemIndex === index ? { ...value, text: event.target.value } : value)),
              )
            }
          />
          <button
            type="button"
            className="icon-action"
            aria-label={`删除${ariaLabel}第 ${index + 1} 条`}
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          >
            <X />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="link-action block-add"
        disabled={items.length >= max}
        onClick={() => {
          onChange([...items, { label: "", text: "" }]);
          focusRow(items.length);
        }}
      >
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
export function ChartSeriesRow({
  label,
  series,
  onChange,
  onRemove,
}: {
  label: string;
  series: { name: string; values: number[] };
  onChange: (next: { name: string; values: number[] }) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(series.values.join("，"));
  return (
    <div className="block-pair-row">
      <input
        aria-label={`${label}系列名称`}
        maxLength={60}
        placeholder="系列名称"
        value={series.name}
        onChange={(event) => onChange({ ...series, name: event.target.value })}
      />
      <input
        aria-label={`${label}系列数值`}
        placeholder="用逗号分隔，例如 38，52，71"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() =>
          onChange({
            ...series,
            values: text
              .split(/[，,]/)
              .map((value) => Number(value.trim()))
              .filter((value) => Number.isFinite(value)),
          })
        }
      />
      <button type="button" className="icon-action" aria-label={`删除${label}系列`} onClick={onRemove}>
        <X />
      </button>
    </div>
  );
}

/**
 * Chart content is edited as categories, series names and values. The chart
 * element only points at this block, so editing here changes the exported
 * chart; there is no second copy of the numbers in the design.
 */
export function ChartEditor({
  pageLabel,
  block,
  onChange,
}: {
  pageLabel: string;
  block: Extract<ContentBlock, { type: "chart" }>;
  onChange: (block: Extract<ContentBlock, { type: "chart" }>) => void;
}) {
  const [categoryText, setCategoryText] = useState(block.categories.join("，"));
  const series =
    block.series && block.series.length > 0
      ? block.series
      : [{ name: block.unit?.trim() || "数值", values: block.values ?? [] }];
  const commit = (next: Array<{ name: string; values: number[] }>) => {
    const { values: _values, ...rest } = block;
    onChange({ ...rest, series: next });
  };
  return (
    <div className="chart-editor">
      <div className="block-pair-row">
        <select
          aria-label={`${pageLabel}图表类型`}
          value={block.kind}
          onChange={(event) => onChange({ ...block, kind: event.target.value as typeof block.kind })}
        >
          <option value="column">柱状图</option>
          <option value="bar">条形图</option>
          <option value="line">折线图</option>
          <option value="pie">饼图</option>
        </select>
        <input
          aria-label={`${pageLabel}图表单位`}
          maxLength={20}
          placeholder="单位（可选）"
          value={block.unit ?? ""}
          onChange={(event) => onChange({ ...block, unit: event.target.value || undefined })}
        />
      </div>
      <input
        aria-label={`${pageLabel}图表类别`}
        placeholder="用逗号分隔类别"
        value={categoryText}
        onChange={(event) => setCategoryText(event.target.value)}
        onBlur={() =>
          onChange({
            ...block,
            categories: categoryText
              .split(/[，,]/)
              .map((value) => value.trim())
              .filter(Boolean),
          })
        }
      />
      {series.map((item, index) => (
        <ChartSeriesRow
          key={index}
          label={`${pageLabel}第 ${index + 1} 个`}
          series={item}
          onChange={(next) => commit(series.map((current, currentIndex) => (currentIndex === index ? next : current)))}
          onRemove={() => {
            if (series.length <= 1) return;
            commit(series.filter((_, currentIndex) => currentIndex !== index));
          }}
        />
      ))}
      <button
        type="button"
        className="link-action"
        disabled={series.length >= 6}
        onClick={() =>
          commit([...series, { name: `系列 ${series.length + 1}`, values: block.categories.map(() => 0) }])
        }
      >
        <Plus />
        添加系列
      </button>
    </div>
  );
}

export function TableEditor({
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
      tableRef.current
        ?.querySelector<HTMLInputElement>(`input[data-cell-row="${row}"][data-cell-column="${column}"]`)
        ?.focus();
    });
  };

  const setHeaderCell = (column: number, value: string) =>
    // A row may be wider than the header, and typing in that column is the
    // writer saying the column exists, so the header grows to cover it.
    onChange({
      ...block,
      header: Array.from({ length: Math.max(block.header.length, column + 1) }, (_, cellIndex) =>
        cellIndex === column ? value : (block.header[cellIndex] ?? ""),
      ),
    });
  // A row may arrive shorter than the header, so editing one cell pads the row
  // with empty cells instead of shifting the columns of the visible grid.
  const setBodyCell = (row: number, column: number, value: string) =>
    onChange({
      ...block,
      rows: block.rows.map((cells, rowIndex) =>
        rowIndex === row
          ? Array.from({ length: columnCount }, (_, cellIndex) =>
              cellIndex === column ? value : (cells[cellIndex] ?? ""),
            )
          : cells,
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
        <button
          type="button"
          className="link-action"
          disabled={columnCount >= TABLE_REVIEW_MAX_COLUMNS}
          onClick={addColumn}
        >
          <Plus />
          添加一列
        </button>
        <button
          type="button"
          className="link-action"
          disabled={block.rows.length >= TABLE_REVIEW_MAX_ROWS}
          onClick={addRow}
        >
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
export function BlockEditor({
  slideIndex,
  blocks,
  checks,
  notes,
  onChange,
  onChecksChange,
}: {
  slideIndex: number;
  blocks: ContentBlock[];
  checks: ContentCheck[];
  notes: readonly SlideCapacityNote[];
  onChange: (
    blocks: ContentBlock[],
    separateHistory?: boolean,
    blockRemap?: (oldIndex: number) => number | undefined,
  ) => void;
  onChecksChange: (checks: ContentCheck[]) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<number | undefined>(undefined);
  const [markingBlock, setMarkingBlock] = useState<number | undefined>(undefined);
  const [addType, setAddType] = useState<ContentBlock["type"]>("paragraph");
  const replace = (index: number, block: ContentBlock) =>
    onChange(blocks.map((current, currentIndex) => (currentIndex === index ? block : current)));
  const remove = (index: number) => {
    onChange(
      blocks.filter((_, currentIndex) => currentIndex !== index),
      true,
      // 被删掉的块，它的核实标记也一起消失；后面的块整体前移一位。
      (oldIndex) => (oldIndex === index ? undefined : oldIndex > index ? oldIndex - 1 : oldIndex),
    );
    setPendingDelete(undefined);
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(destination, 0, moved!);
    onChange(next, true, (oldIndex) =>
      oldIndex === index ? destination : oldIndex === destination ? index : oldIndex,
    );
    setPendingDelete(undefined);
  };
  const pageLabel = `第 ${slideIndex + 1} 页`;
  const checkFor = (index: number) => checks.find((check) => check.blockIndex === index);
  const setCheck = (index: number, kind: ContentCheckKind) => {
    onChecksChange([
      ...checks.filter((check) => check.blockIndex !== index),
      { blockIndex: index, kind, status: "unverified" },
    ]);
    setMarkingBlock(undefined);
  };
  const toggleCheck = (check: ContentCheck) =>
    onChecksChange(
      checks.map((current) =>
        current === check ? { ...current, status: current.status === "verified" ? "unverified" : "verified" } : current,
      ),
    );
  const removeCheck = (check: ContentCheck) => onChecksChange(checks.filter((current) => current !== check));
  const addBlock = () => {
    const next: ContentBlock =
      addType === "paragraph"
        ? { type: "paragraph", text: "" }
        : addType === "bullet-list"
          ? { type: "bullet-list", items: [""] }
          : addType === "quote"
            ? { type: "quote", text: "" }
            : addType === "metric"
              ? { type: "metric", label: "", value: "" }
              : addType === "timeline" || addType === "process"
                ? { type: addType, items: [{ label: "", text: "" }] }
                : addType === "comparison"
                  ? { type: "comparison", leftLabel: "", rightLabel: "", leftItems: [""], rightItems: [""] }
                  : addType === "chart"
                    ? {
                        type: "chart",
                        kind: "column",
                        categories: ["类别 1", "类别 2"],
                        series: [{ name: "数值", values: [0, 0] }],
                      }
                    : { type: "table-data", header: [""], rows: [[""]] };
    onChange([...blocks, next], true);
  };
  return (
    <div className="block-editor">
      {blocks.map((block, index) => {
        const typeLabel = blockTypeLabels[block.type];
        const check = checkFor(index);
        return (
          <section
            className={`block-row ${block.type}`}
            key={`${block.type}-${index}`}
            aria-label={`${pageLabel}的${typeLabel}`}
          >
            <header className="block-row-header">
              <span className="block-type">{typeLabel}</span>
              <span className="block-order-actions" role="group" aria-label={`${pageLabel}的${typeLabel}排序`}>
                <button
                  type="button"
                  className="icon-action"
                  disabled={index === 0}
                  aria-label={`上移${pageLabel}的${typeLabel}`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  className="icon-action"
                  disabled={index === blocks.length - 1}
                  aria-label={`下移${pageLabel}的${typeLabel}`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </button>
              </span>
              <span className="block-check">
                {check ? (
                  <>
                    <button
                      type="button"
                      className={`check-chip ${check.status}`}
                      title="点击切换核实状态"
                      aria-pressed={check.status === "verified"}
                      onClick={() => toggleCheck(check)}
                    >
                      {checkKindLabels[check.kind]} · {checkStatusLabels[check.status]}
                    </button>
                    <button
                      type="button"
                      className="icon-action"
                      aria-label={`删除${pageLabel}的${typeLabel}核实标记`}
                      onClick={() => removeCheck(check)}
                    >
                      <X />
                    </button>
                  </>
                ) : markingBlock === index ? (
                  <span className="check-kind-menu" role="group" aria-label={`${pageLabel}的${typeLabel}核实类型`}>
                    {(["fact", "number", "citation"] as const).map((kind) => (
                      <button key={kind} type="button" className="link-action" onClick={() => setCheck(index, kind)}>
                        {checkKindLabels[kind]}
                      </button>
                    ))}
                    <button type="button" className="link-action" onClick={() => setMarkingBlock(undefined)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="link-action check-add"
                    aria-label={`标记${pageLabel}的${typeLabel}待核实`}
                    onClick={() => setMarkingBlock(index)}
                  >
                    待核实
                  </button>
                )}
              </span>
              {pendingDelete === index ? (
                <span className="block-delete-confirm" role="group" aria-label={`确认删除${pageLabel}的${typeLabel}`}>
                  <button type="button" className="link-action danger" onClick={() => remove(index)}>
                    确认删除
                  </button>
                  <button type="button" className="link-action" onClick={() => setPendingDelete(undefined)}>
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="icon-action"
                  aria-label={`删除${pageLabel}的${typeLabel}`}
                  onClick={() => setPendingDelete(index)}
                >
                  <X />
                </button>
              )}
            </header>
            <CapacityNotes notes={notes.filter((note) => note.blockIndex === index)} label={`${pageLabel}的排版预检`} />
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
              <ItemListEditor
                ariaLabel={`${pageLabel}要点`}
                items={block.items}
                max={12}
                onChange={(items) => replace(index, { ...block, items })}
              />
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
              <PairListEditor
                ariaLabel={`${pageLabel}${typeLabel}`}
                items={block.items}
                max={10}
                onChange={(items) => replace(index, { ...block, items })}
              />
            )}
            {block.type === "comparison" && (
              <div className="comparison-columns">
                <div className="comparison-column">
                  <input
                    aria-label={`${pageLabel}左侧标题`}
                    className="comparison-label"
                    maxLength={100}
                    placeholder="左侧标题"
                    value={block.leftLabel}
                    onChange={(event) => replace(index, { ...block, leftLabel: event.target.value })}
                  />
                  <ItemListEditor
                    ariaLabel={`${pageLabel}左侧要点`}
                    items={block.leftItems}
                    max={8}
                    onChange={(leftItems) => replace(index, { ...block, leftItems })}
                  />
                </div>
                <div className="comparison-column">
                  <input
                    aria-label={`${pageLabel}右侧标题`}
                    className="comparison-label"
                    maxLength={100}
                    placeholder="右侧标题"
                    value={block.rightLabel}
                    onChange={(event) => replace(index, { ...block, rightLabel: event.target.value })}
                  />
                  <ItemListEditor
                    ariaLabel={`${pageLabel}右侧要点`}
                    items={block.rightItems}
                    max={8}
                    onChange={(rightItems) => replace(index, { ...block, rightItems })}
                  />
                </div>
              </div>
            )}
            {block.type === "table-data" && (
              <TableEditor pageLabel={pageLabel} block={block} onChange={(next) => replace(index, next)} />
            )}
            {block.type === "chart" && (
              <ChartEditor pageLabel={pageLabel} block={block} onChange={(next) => replace(index, next)} />
            )}
          </section>
        );
      })}
      <div className="block-add-row">
        <select
          aria-label={`${pageLabel}新增内容块类型`}
          value={addType}
          onChange={(event) => setAddType(event.target.value as ContentBlock["type"])}
        >
          {Object.entries(blockTypeLabels).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="link-action" disabled={blocks.length >= 20} onClick={addBlock}>
          <Plus />
          添加内容块
        </button>
      </div>
    </div>
  );
}
