import { LAYOUT_SPACE_SIZE, type LayoutRect, type PageCoordinateSystem } from "./coordinate-system";

export type LayoutIssueCode =
  "INVALID_GEOMETRY" | "OUT_OF_BOUNDS" | "OVERLAP" | "AXIS_MISMATCH" | "INVALID_REFERENCE" | "INSUFFICIENT_CAPACITY";

export interface LayoutIssue {
  code: LayoutIssueCode;
  paths: string[];
  message: string;
}

export function containsLayoutRect(outer: LayoutRect, inner: LayoutRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function layoutRectsOverlap(left: LayoutRect, right: LayoutRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function validatePageCoordinateSystem(system: PageCoordinateSystem): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const [name, rect] of Object.entries(system).filter((entry): entry is [string, LayoutRect] => {
    const value = entry[1];
    return typeof value === "object" && value !== null && "x" in value;
  })) {
    if (rect.width <= 0 || rect.height <= 0) {
      issues.push({ code: "INVALID_GEOMETRY", paths: [name], message: `${name} 的宽高必须为正数` });
    }
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > LAYOUT_SPACE_SIZE ||
      rect.y + rect.height > LAYOUT_SPACE_SIZE
    ) {
      issues.push({ code: "OUT_OF_BOUNDS", paths: [name], message: `${name} 超出页面坐标范围` });
    }
  }
  if (system.rail && system.rail.x + system.rail.width > Math.min(system.title.x, system.content.x)) {
    issues.push({ code: "AXIS_MISMATCH", paths: ["rail", "title", "content"], message: "导轨必须位于标题和正文左侧" });
  }
  if (system.title.y + system.title.height > system.content.y) {
    issues.push({ code: "AXIS_MISMATCH", paths: ["title", "content"], message: "标题区域不得进入正文区域" });
  }
  if (system.content.y + system.content.height > system.footer.y) {
    issues.push({ code: "AXIS_MISMATCH", paths: ["content", "footer"], message: "正文区域不得进入页脚区域" });
  }
  return issues;
}

export function validateLayoutSiblings(
  parent: LayoutRect,
  entries: Array<{ path: string; rect: LayoutRect }>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const entry of entries) {
    if (!containsLayoutRect(parent, entry.rect)) {
      issues.push({ code: "OUT_OF_BOUNDS", paths: [entry.path], message: `${entry.path} 超出来源区域` });
    }
  }
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (layoutRectsOverlap(entries[left]!.rect, entries[right]!.rect)) {
        issues.push({
          code: "OVERLAP",
          paths: [entries[left]!.path, entries[right]!.path],
          message: "兄弟槽位发生重叠",
        });
      }
    }
  }
  return issues;
}
