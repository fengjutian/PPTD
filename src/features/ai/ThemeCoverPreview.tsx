import { useEffect, useState } from "react";

import type { ConceptPresetId } from "../../core/design/deck-concept";
import { renderPresentationForVisualReview } from "../../services/presentation-renderer";
import { buildThemeCoverPreviewDocument } from "../../services/theme-specimen";

export interface ThemeCoverPreviewProps {
  presetId: string;
  conceptPresetId: ConceptPresetId;
  title: string;
  subtitle?: string;
}

/** A real renderer preview, not a theme-coloured HTML approximation. */
export function ThemeCoverPreview({ presetId, conceptPresetId, title, subtitle }: ThemeCoverPreviewProps) {
  const [state, setState] = useState<{ source?: string; failed?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    setState({});
    void (async () => {
      try {
        const document = buildThemeCoverPreviewDocument({ themePresetId: presetId, conceptPresetId, title, subtitle });
        const rendered = await renderPresentationForVisualReview(document, 960);
        if (!cancelled) setState({ source: rendered.slides[0] });
      } catch {
        if (!cancelled) setState({ failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conceptPresetId, presetId, subtitle, title]);

  if (state.failed) return <span>当前内容无法套入该封面，请选择其他主题或缩短标题</span>;
  if (!state.source) return <span>正在用真实排版引擎生成封面预览…</span>;
  return <img src={state.source} alt="当前主题的真实封面预览" />;
}
