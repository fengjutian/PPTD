import { useEffect, useRef, useState } from "react";
import { Shapes } from "lucide-react";
import { SHAPE_KINDS, type ShapeKind } from "../../core/document-model";

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: "矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  diamond: "菱形",
  pentagon: "五边形",
  hexagon: "六边形",
  chevron: "V 形",
  arrow: "箭头",
  star: "星形",
  parallelogram: "平行四边形",
  trapezoid: "梯形",
};

/**
 * The preset-shape menu of the Insert ribbon.
 *
 * Each entry inserts the same document command the importer and exporter
 * understand; there is no editor-only shape that would degrade on export.
 */
export function ShapePicker({ onPick }: { onPick: (shape: ShapeKind) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="shape-picker" ref={root}>
      <button
        type="button"
        className="tool-button"
        aria-label="形状"
        title="形状"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Shapes />
        <span>形状</span>
      </button>
      {open && (
        <div className="shape-menu" role="menu" aria-label="选择形状">
          {SHAPE_KINDS.map((shape) => (
            <button
              key={shape}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(shape);
                setOpen(false);
              }}
            >
              <ShapePreview shape={shape} />
              {SHAPE_LABELS[shape]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tiny outline of the shape, so the menu reads without labels alone. */
function ShapePreview({ shape }: { shape: ShapeKind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
  if (shape === "rectangle")
    return (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="14" rx="2" {...common} />
      </svg>
    );
  if (shape === "ellipse")
    return (
      <svg viewBox="0 0 24 24">
        <ellipse cx="12" cy="12" rx="9" ry="6" {...common} />
      </svg>
    );
  if (shape === "triangle")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 4 21 20 3 20Z" {...common} />
      </svg>
    );
  if (shape === "diamond")
    return (
      <svg viewBox="0 0 24 24">
        <path d="m12 3 9 9-9 9-9-9Z" {...common} />
      </svg>
    );
  if (shape === "pentagon")
    return (
      <svg viewBox="0 0 24 24">
        <path d="m12 3 9 7-3 11H6L3 10Z" {...common} />
      </svg>
    );
  if (shape === "hexagon")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 4h10l4 8-4 8H7l-4-8Z" {...common} />
      </svg>
    );
  if (shape === "chevron")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 5h12l4 7-4 7H4l4-7Z" {...common} />
      </svg>
    );
  if (shape === "arrow")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M3 9h10V5l8 7-8 7v-4H3Z" {...common} />
      </svg>
    );
  if (shape === "star")
    return (
      <svg viewBox="0 0 24 24">
        <path d="m12 3 2.7 6.3 6.8.6-5.1 4.5 1.5 6.7L12 17.6 6.1 21l1.5-6.7L2.5 9.9l6.8-.6Z" {...common} />
      </svg>
    );
  if (shape === "parallelogram")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 5h14l-4 14H3Z" {...common} />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24">
      <path d="M6 5h12l3 14H3Z" {...common} />
    </svg>
  );
}
