import type { AiDraft, ContentBlock } from "./ai-service";

export type DraftSlide = AiDraft["slides"][number];

/**
 * Structured blocks are what the renderer draws: a metric becomes a stat card,
 * a comparison becomes two labelled columns. The body string is only a plain
 * text projection used by length heuristics, so the two must be rebuilt
 * together to keep "what you review" and "what gets rendered" identical.
 */
export function bodyFromBlocks(blocks: ContentBlock[]): string {
  return blocks.flatMap(blockLines).join("\n");
}

function blockLines(block: ContentBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return [block.text];
    case "quote":
      return block.attribution ? [block.text, `—— ${block.attribution}`] : [block.text];
    case "bullet-list":
      return block.items;
    case "metric":
      return [`${block.label}：${block.value}`];
    case "timeline":
    case "process":
      return block.items.map((item) => `${item.label}：${item.text}`);
    case "comparison":
      return [block.leftLabel, ...block.leftItems, block.rightLabel, ...block.rightItems];
    case "table-data":
      // Cells may be blank while the writer is still filling the grid, so the
      // projection uses trimmed values instead of the storage placeholder.
      return [
        block.header.map((cell) => cell.trim()).join(" | "),
        ...block.rows.map((row) => row.map((cell) => cell.trim()).join(" | ")),
      ];
  }
}

/**
 * Removes blocks and items the writer emptied out. The review screen lets a
 * field be cleared while retyping, but an empty item carries no reviewed
 * content and must not reach layout selection, metrics or the saved draft.
 */
export function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const next: ContentBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        if (block.text.trim()) next.push(block);
        break;
      case "quote":
        if (block.text.trim()) next.push(block);
        break;
      case "bullet-list": {
        const items = block.items.filter((item) => item.trim());
        if (items.length > 0) next.push({ ...block, items });
        break;
      }
      case "metric":
        if (block.label.trim() && block.value.trim()) next.push(block);
        break;
      case "timeline":
      case "process": {
        const items = block.items.filter((item) => item.label.trim() || item.text.trim());
        if (items.length > 0) next.push({ ...block, items });
        break;
      }
      case "comparison": {
        const leftItems = block.leftItems.filter((item) => item.trim());
        const rightItems = block.rightItems.filter((item) => item.trim());
        if (leftItems.length + rightItems.length > 0) next.push({ ...block, leftItems, rightItems });
        break;
      }
      case "table-data":
        // Cells are allowed to be empty, and an empty table has no columns to
        // edit here, so a table block is always kept as the AI produced it.
        next.push(block);
        break;
    }
  }
  return next;
}

/**
 * Draft storage validates with the AI content schema, where `min(1)` means
 * "this field is present". A writer may still clear a heading while filling in
 * the page, so a pending draft stores that slot as a single space instead of
 * being dropped from the history on the next load. The review UI trims the
 * value, so the field keeps reading as missing until the writer fills it in.
 */
export function sanitizeDraftForSave(draft: AiDraft): AiDraft {
  const keepTitle = (title: string) => (title.trim() ? title : " ");
  // Header cells are the one table field the storage schema requires to be
  // present, so a cleared header cell is stored as a placeholder too. Rows may
  // hold blank cells, and the review screen trims values, so neither reads as
  // filled in until the writer types something.
  const keepTable = (block: ContentBlock): ContentBlock =>
    block.type === "table-data" ? { ...block, header: block.header.map((cell) => (cell.trim() ? cell : " ")) } : block;
  return {
    ...draft,
    title: keepTitle(draft.title),
    slides: draft.slides.map((slide) => ({
      ...slide,
      title: keepTitle(slide.title),
      blocks: sanitizeBlocks(slide.blocks).map(keepTable),
    })),
  };
}
