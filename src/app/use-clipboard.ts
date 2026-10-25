import { useCallback, useEffect, useState } from "react";
import type { DocumentId, ElementId, Slide, SlideElement } from "../core/document-model";
import { emu, inches } from "../core/document-model";
import type { DocumentCommand } from "../core/commands/commands";

type Clipboard = { elements: SlideElement[]; pastes: number };

export function useClipboard({
  documentId,
  activeSlide,
  selectedElementIds,
  execute,
  setTaskStatus,
}: {
  documentId: DocumentId;
  activeSlide: Slide;
  selectedElementIds: ElementId[];
  execute: (command: DocumentCommand) => void;
  setTaskStatus: (text?: string) => void;
}) {
  const [clipboard, setClipboard] = useState<Clipboard>({ elements: [], pastes: 0 });
  useEffect(() => {
    setClipboard({ elements: [], pastes: 0 });
  }, [documentId]);

  /**
   * Copies the unlocked selection into the in-app clipboard. Cutting is the same
   * snapshot followed by one delete command, so the whole cut is one undo step.
   *
   * There is no system clipboard integration yet; the status message says so
   * implicitly by anchoring paste to Ctrl+V inside the editor. This is the
   * documented downgrade required by TRS 4.4.4.
   */
  const copySelection = useCallback(
    (cut = false) => {
      const elements = activeSlide.elements.filter(
        (element) => selectedElementIds.includes(element.id) && !element.locked,
      );
      if (elements.length === 0) {
        setTaskStatus("没有可复制的对象");
        return;
      }
      setClipboard({ elements, pastes: 0 });
      if (cut) {
        execute({
          type: "delete-elements",
          slideId: activeSlide.id,
          elementIds: elements.map((element) => element.id),
        });
        setTaskStatus(elements.length > 1 ? `已剪切 ${elements.length} 个对象` : "已剪切对象");
        return;
      }
      setTaskStatus(
        elements.length > 1 ? `已复制 ${elements.length} 个对象，可用 Ctrl+V 粘贴` : "已复制对象，可用 Ctrl+V 粘贴",
      );
    },
    [activeSlide.elements, activeSlide.id, execute, selectedElementIds, setTaskStatus],
  );

  const pasteSelection = useCallback(() => {
    if (clipboard.elements.length === 0) {
      setTaskStatus("剪贴板里还没有对象，先复制或剪切");
      return;
    }
    // Repeated pastes step away from the source instead of covering each other.
    const offset = emu(inches(0.2) * (clipboard.pastes + 1));
    try {
      execute({
        type: "paste-elements",
        slideId: activeSlide.id,
        elements: clipboard.elements,
        offsetEmu: offset,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setTaskStatus(
        code === "PASTE_REQUIRES_CONTENT_BLOCK" ? "表格或图表只能在包含其内容块的页面粘贴" : `粘贴失败：${code}`,
      );
      return;
    }
    setClipboard((current) => ({ ...current, pastes: current.pastes + 1 }));
    setTaskStatus(clipboard.elements.length > 1 ? `已粘贴 ${clipboard.elements.length} 个对象` : "已粘贴对象");
  }, [activeSlide.id, clipboard.elements, clipboard.pastes, execute, setTaskStatus]);

  return { clipboard, copySelection, pasteSelection };
}
