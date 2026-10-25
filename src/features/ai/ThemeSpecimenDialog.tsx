import { useEffect, useState } from "react";
import { Images, X } from "lucide-react";
import { findThemePreset } from "../../core/design/theme-presets";
import { renderPresentationForVisualReview } from "../../services/presentation-renderer";
import { buildSpecimenDocument } from "../../services/theme-specimen";

export interface ThemeSpecimenDialogProps {
  presetId: string;
  onClose: () => void;
  /** The theme drawer already owns the top layer, so the dialog has to sit above it. */
  aboveDrawer?: boolean;
}

/**
 * The eight-page specimen of one theme, rendered on demand.
 *
 * Building every preset's specimen up front costs about a second before the
 * user asks for it. The dialog renders only the theme it is opened with and
 * falls back to the palette description when rendering fails.
 */
export function ThemeSpecimenDialog({ presetId, onClose, aboveDrawer = false }: ThemeSpecimenDialogProps) {
  const [state, setState] = useState<{ images?: string[]; failed?: boolean }>({});
  const preset = findThemePreset(presetId);

  useEffect(() => {
    let cancelled = false;
    setState({});
    void (async () => {
      try {
        const document = buildSpecimenDocument({ themePresetId: presetId });
        const rendered = await renderPresentationForVisualReview(document, 960);
        if (!cancelled) setState({ images: rendered.slides });
      } catch {
        // The palette card is still a usable fallback; never leave a blank modal.
        if (!cancelled) setState({ failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presetId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={`upload-dialog-backdrop${aboveDrawer ? " theme-specimen-backdrop" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog theme-specimen-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-specimen-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Images />
            <div>
              <h2 id="theme-specimen-title">主题样张</h2>
              <p>{preset?.name ?? "当前主题"} · 封面、章节、正文、指标、表格、图表、图片、结论</p>
            </div>
          </div>
          <button type="button" aria-label="关闭主题样张" onClick={onClose}>
            <X />
          </button>
        </div>
        {state.failed ? (
          <p className="field-help">样张渲染失败；仍可按色板与字体描述判断这套主题。</p>
        ) : state.images ? (
          <div className="theme-specimen-grid">
            {state.images.map((source, index) => (
              <img key={`${presetId}-${index}`} src={source} alt={`${preset?.name ?? "主题"} 第 ${index + 1} 页`} />
            ))}
          </div>
        ) : (
          <p className="field-help">正在渲染 8 页样张…</p>
        )}
      </section>
    </div>
  );
}
