import { useEffect, useState } from "react";
import type { DocumentCommand } from "../../core/commands";
import {
  EMU_PER_INCH,
  MAX_PAGE_SIZE_IN,
  MIN_PAGE_SIZE_IN,
  PAGE_SIZE_PRESETS,
  matchPageSizePreset,
  pageSizeFromInches,
  type Emu,
  type SlideElement,
} from "../../core/document-model";

interface PageSizeControlsProps {
  pageSize: { width: Emu; height: Emu };
  /** Every element of the deck; the warning counts objects outside the new page. */
  elements: readonly SlideElement[];
  execute: (command: DocumentCommand) => void;
}

function inchesLabel(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * The page-size controls of the “设计” ribbon.
 *
 * Changing the page does not rescale the objects: coordinates keep their
 * absolute value, exactly like changing the slide size in PowerPoint while
 * choosing not to scale. Objects that no longer fit are counted next to the
 * inputs and the export preflight warns about them as well.
 */
export function PageSizeControls({ pageSize, elements, execute }: PageSizeControlsProps) {
  const [widthDraft, setWidthDraft] = useState(() => inchesLabel(pageSize.width / EMU_PER_INCH));
  const [heightDraft, setHeightDraft] = useState(() => inchesLabel(pageSize.height / EMU_PER_INCH));
  const [error, setError] = useState<string>();

  useEffect(() => {
    setWidthDraft(inchesLabel(pageSize.width / EMU_PER_INCH));
    setHeightDraft(inchesLabel(pageSize.height / EMU_PER_INCH));
    setError(undefined);
  }, [pageSize.width, pageSize.height]);

  const matched = matchPageSizePreset(pageSize);
  const outside = elements.filter(
    (element) =>
      element.frame.x < 0 ||
      element.frame.y < 0 ||
      element.frame.x + element.frame.width > pageSize.width ||
      element.frame.y + element.frame.height > pageSize.height,
  ).length;

  const applyPreset = (preset: (typeof PAGE_SIZE_PRESETS)[number]) => {
    if (matched?.id === preset.id) return;
    const size = pageSizeFromInches(preset.widthIn, preset.heightIn);
    if (size) execute({ type: "set-page-size", pageSize: size });
  };

  const applyDraft = () => {
    const size = pageSizeFromInches(Number(widthDraft), Number(heightDraft));
    if (!size) {
      setError(`页面宽高需在 ${MIN_PAGE_SIZE_IN}–${MAX_PAGE_SIZE_IN} 英寸之间`);
      return;
    }
    setError(undefined);
    if (size.width === pageSize.width && size.height === pageSize.height) return;
    execute({ type: "set-page-size", pageSize: size });
  };

  const resetDraft = () => {
    setWidthDraft(inchesLabel(pageSize.width / EMU_PER_INCH));
    setHeightDraft(inchesLabel(pageSize.height / EMU_PER_INCH));
    setError(undefined);
  };

  return (
    <div className="page-size-controls" role="group" aria-label="页面尺寸">
      <span className="page-size-label">页面</span>
      <div className="page-size-presets">
        {PAGE_SIZE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.label}
            aria-pressed={matched?.id === preset.id}
            className={matched?.id === preset.id ? "active" : undefined}
            onClick={() => applyPreset(preset)}
          >
            {preset.id}
          </button>
        ))}
      </div>
      <label className="page-size-input">
        宽
        <input
          type="number"
          min={MIN_PAGE_SIZE_IN}
          max={MAX_PAGE_SIZE_IN}
          step="0.01"
          value={widthDraft}
          onChange={(event) => setWidthDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyDraft();
            if (event.key === "Escape") resetDraft();
          }}
        />
      </label>
      <span className="page-size-times">×</span>
      <label className="page-size-input">
        高
        <input
          type="number"
          min={MIN_PAGE_SIZE_IN}
          max={MAX_PAGE_SIZE_IN}
          step="0.01"
          value={heightDraft}
          onChange={(event) => setHeightDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyDraft();
            if (event.key === "Escape") resetDraft();
          }}
        />
      </label>
      <button type="button" className="page-size-apply" onClick={applyDraft}>
        应用
      </button>
      {outside > 0 && (
        <span className="page-size-warning" title="对象不会随页面尺寸缩放；导出前预检会再次提示">
          ⚠ {outside} 个对象在页面外
        </span>
      )}
      {error && (
        <span className="page-size-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
