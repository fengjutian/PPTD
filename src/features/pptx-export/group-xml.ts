import { strFromU8, strToU8 } from "fflate";
import type { RectEmu, Slide, SlideElement } from "../../core/document-model";

/**
 * Native PowerPoint groups.
 *
 * PptxGenJS has no group API. The exporter writes every member as an ordinary
 * native object, and this pass wraps the finished slide XML in `<p:grpSp>`.
 * It runs after the gradient, animation and picture-frame patches because those
 * passes find their targets by document order or shape id; moving the shapes
 * earlier would hide them.
 *
 * The group's child coordinate system is the page coordinate system
 * (`chOff`/`chExt` equal `off`/`ext`), so the member transforms stay untouched.
 * The mapping is the identity and the grouped page renders exactly like the
 * ungrouped page.
 *
 * A group can only occupy one z-position. The pass places it where the
 * front-most member was, which is what PowerPoint does when the user groups
 * objects whose z-order is not contiguous. Lower members move up with the
 * group; the alternative would silently move the front-most object behind
 * objects it used to cover.
 */

export interface NativeGroupResult {
  written: number;
  skipped: number;
}

type GroupSlide = Pick<Slide, "elements" | "groups">;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeBlock {
  start: number;
  end: number;
  tag: string;
  name: string | undefined;
}

interface TreeItem {
  kind: "text" | "shape";
  xml: string;
  name?: string;
  tag?: string;
}

/**
 * Shape blocks nested inside another drawable block (a group) are handled by
 * the depth counter. The boundary after `p:sp` deliberately does not match
 * `p:spPr` or `p:graphicFramePr`.
 */
const SHAPE_TOKEN = /<(\/)?(p:(?:sp|pic|graphicFrame|cxnSp|grpSp))\b[^>]*?(\/?)>/g;

export function patchSlideGroups(entries: Record<string, Uint8Array>, slides: readonly Slide[]): NativeGroupResult {
  let written = 0;
  let skipped = 0;

  slides.forEach((slide, index) => {
    const groups = slide.groups ?? [];
    if (groups.length === 0) return;
    const part = `ppt/slides/slide${index + 1}.xml`;
    const data = entries[part];
    if (!data) {
      skipped += groups.length;
      return;
    }
    const xml = strFromU8(data);
    const result = patchGroupsInSlideXml(xml, slide);
    if (result.xml !== xml) entries[part] = strToU8(result.xml);
    written += result.written;
    skipped += result.skipped;
  });

  return { written, skipped };
}

/**
 * Wraps the groups of one page. Exposed for unit tests: the package pass only
 * adds the entry lookup around it.
 */
export function patchGroupsInSlideXml(
  xml: string,
  slide: GroupSlide,
): { xml: string; written: number; skipped: number } {
  const groups = slide.groups ?? [];
  if (groups.length === 0) return { xml, written: 0, skipped: 0 };

  const tree = findSpTree(xml);
  if (!tree) return { xml, written: 0, skipped: groups.length };

  const blocks = findTopLevelShapeBlocks(tree.content);
  if (blocks.length === 0) return { xml, written: 0, skipped: groups.length };

  let items = splitItems(tree.content, blocks);
  const elements = new Map(slide.elements.map((element) => [element.id, element]));
  let nextShapeId = maxShapeId(tree.content) + 1;
  let written = 0;
  let skipped = 0;

  for (const group of groups) {
    const members: TreeItem[] = [];
    let incomplete = false;
    for (const id of group.elementIds) {
      const item = items.find((candidate) => candidate.kind === "shape" && candidate.name === id);
      if (!item) {
        incomplete = true;
        break;
      }
      members.push(item);
    }
    if (incomplete || members.length < 2 || new Set(members).size !== members.length) {
      skipped += 1;
      continue;
    }
    // A table carries `a:graphicFrameLocks noGrp="1"`: PowerPoint itself
    // forbids putting it in a group. A nested group cannot be selected by an
    // element id either, so both cases stay flattened and are reported.
    if (members.some((item) => item.tag === "p:grpSp" || hasNoGroupLock(item.xml))) {
      skipped += 1;
      continue;
    }

    const memberElements: SlideElement[] = [];
    let missingElement = false;
    for (const id of group.elementIds) {
      const element = elements.get(id);
      if (!element) {
        missingElement = true;
        break;
      }
      memberElements.push(element);
    }
    if (missingElement) {
      skipped += 1;
      continue;
    }

    const bounds = groupBounds(memberElements);
    if (!bounds) {
      skipped += 1;
      continue;
    }

    const ordered = members
      .map((item) => ({ item, index: items.indexOf(item) }))
      .sort((first, second) => first.index - second.index);
    const topIndex = ordered[ordered.length - 1]!.index;
    const selected = new Set(ordered.map((entry) => entry.item));
    const children = ordered.map((entry) => entry.item.xml).join("");
    const groupXml = groupShapeXml(nextShapeId, group.id, bounds, children);
    nextShapeId += 1;

    const next: TreeItem[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (index === topIndex) {
        next.push({ kind: "shape", xml: groupXml, tag: "p:grpSp" });
      }
      const item = items[index]!;
      if (!selected.has(item)) next.push(item);
    }
    items = next;
    written += 1;
  }

  if (written === 0) return { xml, written, skipped };
  const patched = xml.slice(0, tree.start) + items.map((item) => item.xml).join("") + xml.slice(tree.end);
  return { xml: patched, written, skipped };
}

function findSpTree(xml: string): { start: number; end: number; content: string } | undefined {
  const opening = /<p:spTree\b[^>]*>/.exec(xml);
  if (!opening) return undefined;
  const start = opening.index + opening[0].length;
  const end = xml.indexOf("</p:spTree>", start);
  if (end < 0) return undefined;
  return { start, end, content: xml.slice(start, end) };
}

function findTopLevelShapeBlocks(content: string): ShapeBlock[] {
  const blocks: ShapeBlock[] = [];
  SHAPE_TOKEN.lastIndex = 0;
  let depth = 0;
  let start = -1;
  let tag = "";
  let match: RegExpExecArray | null;

  while ((match = SHAPE_TOKEN.exec(content)) !== null) {
    const closing = match[1] === "/";
    const selfClosing = match[3] === "/";
    if (selfClosing) {
      if (depth === 0) {
        const xml = match[0];
        blocks.push({
          start: match.index,
          end: match.index + xml.length,
          tag: match[2]!,
          name: shapeName(xml),
        });
      }
      continue;
    }
    if (!closing) {
      if (depth === 0) {
        start = match.index;
        tag = match[2]!;
      }
      depth += 1;
      continue;
    }
    if (depth === 0) continue;
    depth -= 1;
    if (depth === 0) {
      const end = match.index + match[0].length;
      const xml = content.slice(start, end);
      blocks.push({ start, end, tag, name: shapeName(xml) });
      start = -1;
      tag = "";
    }
  }

  return blocks;
}

function splitItems(content: string, blocks: ShapeBlock[]): TreeItem[] {
  const items: TreeItem[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) items.push({ kind: "text", xml: content.slice(cursor, block.start) });
    items.push({
      kind: "shape",
      xml: content.slice(block.start, block.end),
      ...(block.name === undefined ? {} : { name: block.name }),
      tag: block.tag,
    });
    cursor = block.end;
  }
  if (cursor < content.length) items.push({ kind: "text", xml: content.slice(cursor) });
  return items;
}

function shapeName(xml: string): string | undefined {
  const match = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(xml);
  return match?.[1];
}

function hasNoGroupLock(xml: string): boolean {
  return /<(?:a|p):graphicFrameLocks\b[^>]*\bnoGrp="(?:1|true)"/i.test(xml);
}

function maxShapeId(xml: string): number {
  let max = 1;
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)) {
    const id = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(id)) max = Math.max(max, id);
  }
  return max;
}

/**
 * Bounds of the group, including the area a rotated member actually covers.
 * The group frame is only a selection/transform box; the identity child mapping
 * means an exact union is preferable to the unrotated frames.
 */
function groupBounds(elements: readonly SlideElement[]): Bounds | undefined {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const bounds = rotatedBounds(element.frame, element.rotationMilliDegree);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  const x = Math.floor(left);
  const y = Math.floor(top);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(right) - x),
    height: Math.max(1, Math.ceil(bottom) - y),
  };
}

function rotatedBounds(frame: RectEmu, rotationMilliDegree: number): Bounds {
  const angle = (rotationMilliDegree / 1000) * (Math.PI / 180);
  if (!Number.isFinite(angle) || angle === 0) {
    return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  }
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const;
  const xs = corners.map(([x, y]) => centerX + x * cos - y * sin);
  const ys = corners.map(([x, y]) => centerY + x * sin + y * cos);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function groupShapeXml(shapeId: number, groupId: string, bounds: Bounds, children: string): string {
  const name = escapeXml(`Group ${groupId}`);
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${shapeId}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.width}" cy="${bounds.height}"/><a:chOff x="${bounds.x}" y="${bounds.y}"/><a:chExt cx="${bounds.width}" cy="${bounds.height}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
