/**
 * 多选对象的排列计算。
 *
 * 这些函数只算位置，不改文档：命令层拿到结果再写回元素。这样"对齐"和
 * "分布"的规则可以脱离界面单独测，也保证画布、属性面板和导出用的是同一套
 * 几何。
 *
 * 所有坐标都是页面坐标（EMU）。
 */

import { emu, type ElementId, type Emu, type RectEmu } from "../document-model";

/** 水平方向的对齐方式。 */
export type ArrangeHorizontal = "left" | "center" | "right";
/** 垂直方向的对齐方式。 */
export type ArrangeVertical = "top" | "middle" | "bottom";

/**
 * 一组对象的外接框。
 *
 * 多选时"左对齐"对齐的是这一组的外接框左边，而不是页面左边：把三个对象
 * 的左边都推齐到外接框，和推齐到页面，是两回事。前者才是"让它们对齐"。
 */
export function unionFrame(frames: readonly RectEmu[]): RectEmu | undefined {
  if (frames.length === 0) return undefined;
  let left: number = frames[0]!.x;
  let top: number = frames[0]!.y;
  let right: number = frames[0]!.x + frames[0]!.width;
  let bottom: number = frames[0]!.y + frames[0]!.height;
  for (const frame of frames) {
    left = Math.min(left, frame.x);
    top = Math.min(top, frame.y);
    right = Math.max(right, frame.x + frame.width);
    bottom = Math.max(bottom, frame.y + frame.height);
  }
  return { x: emu(left), y: emu(top), width: emu(right - left), height: emu(bottom - top) };
}

/**
 * 把一组对象按同一个方向对齐。
 *
 * reference 是对齐的基准框：多选时是这一组的外接框，单选时是页面。
 * 只动一个方向时，另一个方向保持原样。
 */
export function alignFrames(
  frames: readonly RectEmu[],
  reference: RectEmu,
  target: { horizontal?: ArrangeHorizontal; vertical?: ArrangeVertical },
): RectEmu[] {
  return frames.map((frame) => {
    let x: number = frame.x;
    let y: number = frame.y;
    if (target.horizontal === "left") x = reference.x;
    if (target.horizontal === "center") x = reference.x + Math.round((reference.width - frame.width) / 2);
    if (target.horizontal === "right") x = reference.x + reference.width - frame.width;
    if (target.vertical === "top") y = reference.y;
    if (target.vertical === "middle") y = reference.y + Math.round((reference.height - frame.height) / 2);
    if (target.vertical === "bottom") y = reference.y + reference.height - frame.height;
    return { ...frame, x: emu(x), y: emu(y) };
  });
}

/**
 * 把一组对象均匀分布。
 *
 * 两端的对象不动，中间那些把间距拉匀。这和"平均间隔"不同：平均间隔会
 * 让整组散开，两端固定才是"分布"的意思。
 *
 * 少于三个对象时不分布：两个对象没有"中间"可以填。
 */
export function distributeFrames(frames: readonly RectEmu[], axis: "horizontal" | "vertical"): RectEmu[] {
  if (frames.length < 3) return frames.map((frame) => ({ ...frame }));
  const horizontal = axis === "horizontal";
  const ordered = [...frames].sort((left, right) => (horizontal ? left.x - right.x : left.y - right.y));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const span = horizontal ? (last.x + last.width) - first.x : (last.y + last.height) - first.y;
  const occupied = ordered.reduce((sum, frame) => sum + (horizontal ? frame.width : frame.height), 0);
  const gap = (span - occupied) / (ordered.length - 1);

  const result = new Map<RectEmu, RectEmu>();
  let cursor: number = horizontal ? first.x : first.y;
  for (const frame of ordered) {
    const size = horizontal ? frame.width : frame.height;
    const position = cursor;
    cursor += size + gap;
    result.set(frame, horizontal
      ? { ...frame, x: emu(position) }
      : { ...frame, y: emu(position) });
  }
  return frames.map((frame) => result.get(frame) ?? frame);
}

/**
 * 两个框是否相交。
 *
 * 框选用的判定：只要有一块重叠就算被框住。这比"完全包含"宽松，也更符合
 * 拖框选对象的直觉——擦过边角的对象通常也算选中。
 */
export function framesIntersect(a: RectEmu, b: RectEmu): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 框选的结果。
 *
 * 与选框相交的对象都被选中。按页面上从后到前的顺序返回，和图层顺序一致。
 */
export function framesInSelection(
  elements: readonly { id: ElementId; frame: RectEmu }[],
  selection: RectEmu,
): ElementId[] {
  return elements.filter((element) => framesIntersect(element.frame, selection)).map((element) => element.id);
}
