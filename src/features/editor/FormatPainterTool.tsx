import { Paintbrush } from "lucide-react";

import { normalizeTextFormat, type TextElement } from "../../core/document-model";
import { useFormatPainterStore } from "../../store/format-painter";
import { RibbonCompactButton } from "./RibbonGroup";

/**
 * Clipboard format painter.
 *
 * Copying a format is UI state, not a document command. Applying it on the
 * canvas is one design transaction. A double click locks the brush until Escape,
 * matching PowerPoint's format painter.
 */
export function FormatPainterTool({ elements }: { elements: TextElement[] }) {
  const primary = elements.filter((element) => !element.locked).at(-1);
  const painter = useFormatPainterStore((state) => state.style);
  const copyFormat = useFormatPainterStore((state) => state.copy);

  return (
    <RibbonCompactButton
      label="格式刷：单击复制一次，双击锁定连续应用，Esc 取消"
      caption="格式刷"
      disabled={!primary}
      pressed={Boolean(painter)}
      onClick={() => {
        if (!primary) return;
        copyFormat(normalizeTextFormat(primary.style), false);
      }}
      onDoubleClick={() => {
        if (!primary) return;
        copyFormat(normalizeTextFormat(primary.style), true);
      }}
    >
      <Paintbrush />
    </RibbonCompactButton>
  );
}
