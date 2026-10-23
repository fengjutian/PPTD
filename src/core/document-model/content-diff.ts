import type { ContentBlock, ContentVersion, ContentVersionSlide, PresentationDocument } from "./types";

export type ContentChangeField = "title" | "body" | "speakerNotes" | "block" | "blockOrder";

export interface ContentFieldChange {
  field: ContentChangeField;
  change: "changed" | "added" | "removed";
  before?: string;
  after?: string;
}

export interface ContentSlideDiff {
  slideId: string;
  status: "added" | "removed" | "changed" | "moved";
  beforeTitle?: string;
  afterTitle?: string;
  beforeIndex?: number;
  afterIndex?: number;
  changes: ContentFieldChange[];
}

/** A readable one-block summary, used on both sides of a diff line. */
export function summarizeContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "bullet-list":
      return block.items.join("；");
    case "quote":
      return block.attribution ? `“${block.text}” —— ${block.attribution}` : `“${block.text}”`;
    case "metric":
      return `${block.label}：${block.value}`;
    case "timeline":
    case "process":
      return block.items.map((item) => `${item.label}：${item.text}`).join("；");
    case "comparison":
      return `${block.leftLabel}：${block.leftItems.join("、")} ｜ ${block.rightLabel}：${block.rightItems.join("、")}`;
    case "table-data":
      return [`表头：${block.header.join(" / ")}`, ...block.rows.map((row) => row.join(" / "))].join("；");
  }
}

function blockChanges(
  before: ContentVersionSlide,
  after: PresentationDocument["slides"][number],
): ContentFieldChange[] {
  const beforeBlocks = before.blocks ?? [];
  const afterBlocks = after.content.blocks ?? [];
  // Stable IDs are the best match. When a design re-application regenerated
  // them, pair the remaining blocks by type so the same copy does not show up
  // as one deletion plus one insertion.
  const used = new Set<number>();
  const beforeByAfter = new Map<ContentBlock, ContentBlock>();
  for (const afterBlock of afterBlocks) {
    const index = beforeBlocks.findIndex(
      (block, blockIndex) => !used.has(blockIndex) && block.id === afterBlock.id && block.type === afterBlock.type,
    );
    if (index < 0) continue;
    used.add(index);
    beforeByAfter.set(afterBlock, beforeBlocks[index]!);
  }
  for (const afterBlock of afterBlocks) {
    if (beforeByAfter.has(afterBlock)) continue;
    const index = beforeBlocks.findIndex(
      (block, blockIndex) => !used.has(blockIndex) && block.type === afterBlock.type,
    );
    if (index < 0) continue;
    used.add(index);
    beforeByAfter.set(afterBlock, beforeBlocks[index]!);
  }

  const changes: ContentFieldChange[] = [];
  // A pure reorder has no changed block values, so it needs its own line;
  // otherwise the diff would claim the two copies are identical while the
  // restored order would still be different.
  const allPaired = beforeByAfter.size === afterBlocks.length && afterBlocks.length === beforeBlocks.length;
  const pairedOrder = allPaired ? afterBlocks.map((block) => beforeBlocks.indexOf(beforeByAfter.get(block)!)) : [];
  if (pairedOrder.some((index, position) => index !== position)) {
    changes.push({
      field: "blockOrder",
      change: "changed",
      before: beforeBlocks.map(summarizeContentBlock).join("；"),
      after: afterBlocks.map(summarizeContentBlock).join("；"),
    });
  }
  for (const afterBlock of afterBlocks) {
    const old = beforeByAfter.get(afterBlock);
    if (!old) {
      changes.push({ field: "block", change: "added", after: summarizeContentBlock(afterBlock) });
      continue;
    }
    const beforeText = summarizeContentBlock(old);
    const afterText = summarizeContentBlock(afterBlock);
    if (beforeText !== afterText) {
      changes.push({ field: "block", change: "changed", before: beforeText, after: afterText });
    }
  }
  beforeBlocks.forEach((block, index) => {
    if (used.has(index)) return;
    changes.push({ field: "block", change: "removed", before: summarizeContentBlock(block) });
  });
  return changes;
}

/**
 * The differences between a confirmed content version and the current deck.
 *
 * Pages are matched by stable slide ID. Page order is reported only when the
 * page set itself did not change: after an insertion or deletion every later
 * index shifts, and calling all of those pages "moved" would bury the real
 * change. Added and removed pages already tell that story.
 */
export function diffContentVersion(version: ContentVersion, document: PresentationDocument): ContentSlideDiff[] {
  const beforeById = new Map(version.slides.map((slide, index) => [slide.slideId, { slide, index }]));
  const afterIds = new Set(document.slides.map((slide) => slide.id));
  const samePageSet =
    version.slides.length === document.slides.length && version.slides.every((slide) => afterIds.has(slide.slideId));

  const diffs: ContentSlideDiff[] = [];
  document.slides.forEach((slide, afterIndex) => {
    const before = beforeById.get(slide.id);
    if (!before) {
      diffs.push({
        slideId: slide.id,
        status: "added",
        afterTitle: slide.content.title,
        afterIndex,
        changes: [],
      });
      return;
    }

    const changes: ContentFieldChange[] = [];
    if (before.slide.title !== slide.content.title) {
      changes.push({ field: "title", change: "changed", before: before.slide.title, after: slide.content.title });
    }
    if (before.slide.body !== slide.content.body) {
      changes.push({ field: "body", change: "changed", before: before.slide.body, after: slide.content.body });
    }
    if (before.slide.speakerNotes !== slide.content.speakerNotes) {
      changes.push({
        field: "speakerNotes",
        change: "changed",
        before: before.slide.speakerNotes,
        after: slide.content.speakerNotes,
      });
    }
    changes.push(...blockChanges(before.slide, slide));

    const moved = samePageSet && before.index !== afterIndex;
    if (changes.length === 0 && !moved) return;
    diffs.push({
      slideId: slide.id,
      status: moved ? "moved" : "changed",
      beforeTitle: before.slide.title,
      afterTitle: slide.content.title,
      ...(moved ? { beforeIndex: before.index, afterIndex } : {}),
      changes,
    });
  });

  // Removed pages are appended in their old order. A page that was both moved
  // and deleted has no current position to talk about.
  version.slides.forEach((slide, index) => {
    if (afterIds.has(slide.slideId)) return;
    diffs.push({
      slideId: slide.slideId,
      status: "removed",
      beforeTitle: slide.title,
      beforeIndex: index,
      changes: [],
    });
  });

  return diffs;
}
