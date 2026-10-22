import { memo } from "react";
import type { HorizontalAlign, VerticalAlign } from "../../core/commands";

/**
 * The nine places an object can take on the page.
 *
 * The row is the vertical place, the column the horizontal one. A cell in the
 * middle row or the middle column moves one axis and leaves the other one
 * alone; a corner and the middle place both axes at once.
 */
export type AlignCell = {
  horizontal: HorizontalAlign;
  vertical: VerticalAlign;
  /** Whether the cell moves one axis only. */
  single: boolean;
  label: string;
};

export const ALIGN_CELLS: readonly AlignCell[] = [
  { horizontal: "left", vertical: "top", single: false, label: "左上对齐" },
  { horizontal: "center", vertical: "top", single: true, label: "顶端对齐" },
  { horizontal: "right", vertical: "top", single: false, label: "右上对齐" },
  { horizontal: "left", vertical: "middle", single: true, label: "左对齐" },
  { horizontal: "center", vertical: "middle", single: false, label: "居中对齐" },
  { horizontal: "right", vertical: "middle", single: true, label: "右对齐" },
  { horizontal: "left", vertical: "bottom", single: false, label: "左下对齐" },
  { horizontal: "center", vertical: "bottom", single: true, label: "底端对齐" },
  { horizontal: "right", vertical: "bottom", single: false, label: "右下对齐" },
];

/**
 * The mark of one cell.
 *
 * A cell that moves one axis draws a bar on that edge, a cell that moves both
 * draws the block in the place it takes on the page.
 */
function AlignMark({ cell }: { cell: AlignCell }) {
  const horizontal = cell.horizontal;
  const vertical = cell.vertical;
  if (cell.single && horizontal !== "center") {
    return (
      <svg viewBox="0 0 16 16" className="align-mark" aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" className="align-page" />
        <rect x={horizontal === "left" ? 3.5 : 8.5} y="4" width="4" height="8" rx="1" className="align-block" />
      </svg>
    );
  }
  if (cell.single && vertical !== "middle") {
    return (
      <svg viewBox="0 0 16 16" className="align-mark" aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" className="align-page" />
        <rect x="4" y={vertical === "top" ? 3.5 : 8.5} width="8" height="4" rx="1" className="align-block" />
      </svg>
    );
  }
  const x = horizontal === "left" ? 3.5 : horizontal === "right" ? 8.5 : 6;
  const y = vertical === "top" ? 3.5 : vertical === "bottom" ? 8.5 : 6;
  return (
    <svg viewBox="0 0 16 16" className="align-mark" aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" className="align-page" />
      <rect x={x} y={y} width="4" height="4" rx="1" className="align-block" />
    </svg>
  );
}

export interface AlignGridProps {
  disabled?: boolean;
  onAlign: (cell: AlignCell) => void;
}

/**
 * The align matrix of the inspector.
 *
 * It replaces the two rows of three buttons: the place of the object on the
 * page is one picture, so it is drawn as one picture.
 */
export const AlignGrid = memo(function AlignGrid({ disabled, onAlign }: AlignGridProps) {
  return (
    <div className="align-grid" role="group" aria-label="对齐（相对页面）">
      {ALIGN_CELLS.map((cell) => (
        <button
          type="button"
          key={`${cell.horizontal}-${cell.vertical}`}
          className="align-cell"
          title={cell.single ? `${cell.label}（只改变${cell.horizontal === "center" ? "垂直" : "水平"}位置）` : cell.label}
          aria-label={cell.label}
          disabled={disabled}
          onClick={() => onAlign(cell)}
        >
          <AlignMark cell={cell} />
        </button>
      ))}
    </div>
  );
});
