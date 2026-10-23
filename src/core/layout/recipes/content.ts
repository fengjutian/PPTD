import { stripListPrefix } from "../../commands/layout-capacity";
import type { ContentBlock, SlideContent } from "../../document-model";

export interface ContentUnits {
  /** The points the page will draw, without typed list markers. */
  items: string[];
  /** The ids of the structured blocks consumed as items. */
  blockIds: string[];
  /** The reviewed body copy, trimmed. */
  body: string;
  /**
   * Whether every non-empty body paragraph is already represented by an item.
   * When false, the recipe may draw the uncovered copy as a lead paragraph;
   * if it cannot, it must refuse the page.
   */
  bodyCovered: boolean;
  /** Body copy that is not represented by an item, to be drawn as a lead. */
  lead: string;
}

/**
 * Reads the units a recipe draws from the reviewed content.
 *
 * The bullet block is the fact source. Body copy is split only as a fallback
 * for drafts that predate structured blocks. Typed list markers are removed
 * because the recipe draws its own numbers.
 */
export function readContentUnits(content: SlideContent): ContentUnits {
  const bulletBlock = content.blocks?.find(
    (block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list",
  );
  const body = content.body.trim();
  const fromBlock = bulletBlock?.items ?? [];
  const items = (fromBlock.length > 0 ? fromBlock : splitBody(body))
    .map((item) => stripListPrefix(item).trim())
    .filter((item) => item.length > 0);
  const blockIds = bulletBlock ? [bulletBlock.id] : [];
  if (body.length === 0) {
    return { items, blockIds, body, bodyCovered: true, lead: "" };
  }
  if (items.length > 0 && items.every((item) => body.includes(item))) {
    return { items, blockIds, body, bodyCovered: true, lead: "" };
  }
  const paragraphs = splitBody(body);
  const uncovered = paragraphs.filter(
    (paragraph) => !items.some((item) => item.includes(paragraph) || paragraph.includes(item)),
  );
  if (uncovered.length === 0) {
    return { items, blockIds, body, bodyCovered: true, lead: "" };
  }
  return {
    items,
    blockIds,
    body,
    bodyCovered: false,
    lead: uncovered.join(" ").replace(/\s+/g, " ").trim(),
  };
}

function splitBody(body: string): string[] {
  return body
    .split(/\n+/)
    .map((line) => stripListPrefix(line).trim())
    .filter((line) => line.length > 0);
}
