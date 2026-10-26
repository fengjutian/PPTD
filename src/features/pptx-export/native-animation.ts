import { strFromU8, strToU8 } from "fflate";
import { animationExportsNatively, type Slide, type SlideAnimation } from "../../core/document-model";

/**
 * Native object animations.
 *
 * PptxGenJS writes a static slide. The timing tree is therefore patched into
 * `ppt/slides/slideN.xml` after the package is built. Only the effects whose
 * DrawingML node we can construct exactly are written; `NATIVE_ANIMATION_EFFECTS`
 * is the single source of truth for that list, shared with export validation.
 *
 * The structure follows the tree PowerPoint itself writes: one main sequence,
 * one click group per "on click" animation, and `withEffect` / `afterEffect`
 * siblings inside that group.
 */

export interface NativeAnimationResult {
  /** Effects written into the timing tree. */
  written: number;
  /** Animations whose effect or target has no native representation. */
  skipped: number;
}

function durationOf(animation: SlideAnimation): number {
  return Math.min(60_000, Math.max(100, Math.round(animation.durationMs)));
}

/** The shape id PptxGenJS wrote for the object named after the element id. */
function shapeIdsByElement(xml: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const match of xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)) {
    ids.set(match[2]!, match[1]!);
  }
  return ids;
}

function setVisible(id: number, shapeId: string, visible: boolean): string {
  return `<p:set><p:cBhvr><p:cTn id="${id}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${visible ? "visible" : "hidden"}"/></p:to></p:set>`;
}

function animEffect(id: number, shapeId: string, filter: string, duration: number): string {
  return `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${id}" dur="${duration}"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
}

/** Emphasis scale: grow, then return to the original size. */
function animScale(id: number, shapeId: string, by: string, duration: number): string {
  return `<p:animScale><p:cBhvr><p:cTn id="${id}" dur="${duration}" autoRev="1" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl></p:cBhvr><p:by x="${by}" y="${by}"/></p:animScale>`;
}

/** One animated numeric attribute, from `from` to `to`. */
function animValue(id: number, shapeId: string, attribute: string, from: string, to: string, duration: number): string {
  return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${id}" dur="${duration}" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>${attribute}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
}

interface EffectSpec {
  presetId: number;
  presetSubtype: number;
  presetClass: "entr" | "emph" | "exit";
  children: (nextId: () => number) => string;
}

/** The native node of one supported effect. */
function effectSpec(animation: SlideAnimation, shapeId: string, duration: number): EffectSpec | undefined {
  const direction = animation.direction;
  switch (animation.effect) {
    case "appear":
      return {
        presetId: 1,
        presetSubtype: 0,
        presetClass: "entr",
        children: (nextId) => setVisible(nextId(), shapeId, true),
      };
    case "fade":
      return {
        presetId: 10,
        presetSubtype: 0,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animEffect(nextId(), shapeId, "fade", duration)}`,
      };
    case "wipe": {
      const filter =
        direction === "left"
          ? "wipe(left)"
          : direction === "right"
            ? "wipe(right)"
            : direction === "top"
              ? "wipe(up)"
              : "wipe(down)";
      return {
        presetId: 22,
        presetSubtype: direction === "left" ? 2 : direction === "right" ? 8 : direction === "top" ? 1 : 4,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animEffect(nextId(), shapeId, filter, duration)}`,
      };
    }
    case "zoom":
      return {
        presetId: 23,
        presetSubtype: 16,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animValue(nextId(), shapeId, "ppt_w", "0", "#ppt_w", duration)}${animValue(nextId(), shapeId, "ppt_h", "0", "#ppt_h", duration)}`,
      };
    case "fly-in": {
      const fromX = direction === "left" ? "0-#ppt_w/2" : direction === "right" ? "1+#ppt_w/2" : "#ppt_x";
      const fromY =
        direction === "top" ? "0-#ppt_h/2" : direction === "left" || direction === "right" ? "#ppt_y" : "1+#ppt_h/2";
      return {
        presetId: 2,
        presetSubtype: direction === "left" ? 8 : direction === "right" ? 2 : direction === "top" ? 1 : 4,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animValue(nextId(), shapeId, "ppt_x", fromX, "#ppt_x", duration)}${animValue(nextId(), shapeId, "ppt_y", fromY, "#ppt_y", duration)}`,
      };
    }
    case "split":
      // PowerPoint writes Split as a barn-door clip; the default vertical
      // split is the one the canvas preview shows.
      return {
        presetId: 16,
        presetSubtype: 21,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animEffect(nextId(), shapeId, "barn(inVertical)", duration)}`,
      };
    case "float-in":
      // Float In is a short upward drift with a fade, not a motion path.
      return {
        presetId: 30,
        presetSubtype: 0,
        presetClass: "entr",
        children: (nextId) =>
          `${setVisible(nextId(), shapeId, true)}${animEffect(nextId(), shapeId, "fade", duration)}${animValue(nextId(), shapeId, "ppt_y", "#ppt_y+0.25", "#ppt_y", duration)}`,
      };
    case "pulse":
      return {
        presetId: 6,
        presetSubtype: 0,
        presetClass: "emph",
        children: (nextId) => animScale(nextId(), shapeId, "105000", duration),
      };
    case "disappear":
      return {
        presetId: 1,
        presetSubtype: 0,
        presetClass: "exit",
        children: (nextId) => setVisible(nextId(), shapeId, false),
      };
    default:
      return undefined;
  }
}

interface GroupedAnimation {
  animation: SlideAnimation;
  shapeId: string;
}

/**
 * Builds the `<p:timing>` element for one page.
 *
 * `animations` must already be filtered to supported effects with a known
 * shape id. Returns undefined when there is nothing to write.
 */
export function buildTimingXml(animations: GroupedAnimation[]): string | undefined {
  if (animations.length === 0) return undefined;

  let nextId = 5;
  const id = () => nextId++;
  const groups: GroupedAnimation[][] = [];
  for (const item of animations) {
    if (item.animation.start === "on-click" || groups.length === 0) {
      groups.push([item]);
    } else {
      groups[groups.length - 1]!.push(item);
    }
  }

  const buildEffect = (item: GroupedAnimation, nodeType: string): string => {
    const duration = durationOf(item.animation);
    const spec = effectSpec(item.animation, item.shapeId, duration);
    if (!spec) return "";
    return `<p:par><p:cTn id="${id()}" presetID="${spec.presetId}" presetClass="${spec.presetClass}" presetSubtype="${spec.presetSubtype}" fill="hold" grpId="0" nodeType="${nodeType}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${spec.children(id)}</p:childTnLst></p:cTn></p:par>`;
  };

  let body = "";
  for (const group of groups) {
    body += `<p:par><p:cTn id="${id()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>`;
    let previousDuration = 0;
    group.forEach((item, index) => {
      const start = index === 0 ? "click" : item.animation.start;
      const nodeType =
        start === "after-previous" ? "afterEffect" : start === "with-previous" ? "withEffect" : "clickEffect";
      // Every holder is a sibling inside the click group. In particular an
      // "after previous" effect must not be nested inside the holder of the
      // first effect: PowerPoint writes the delay holder at group level, and
      // nesting it deeper makes the whole file unreadable.
      const delay = start === "after-previous" ? previousDuration : 0;
      body += `<p:par><p:cTn id="${id()}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>`;
      body += buildEffect(item, nodeType);
      body += `</p:childTnLst></p:cTn></p:par>`;
      previousDuration = durationOf(item.animation) + Math.max(0, item.animation.delayMs);
    });
    body += `</p:childTnLst></p:cTn></p:par>`;
  }

  const builtShapeIds = [...new Set(animations.map((item) => item.shapeId))];
  const buildList = builtShapeIds.map((shapeId) => `<p:bldP spid="${shapeId}" grpId="0"/>`).join("");

  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${buildList}</p:bldLst></p:timing>`;
}

/** Inserts the timing tree after the transition, in the schema order. */
export function applyTimingToSlideXml(xml: string, timing: string): string {
  const withoutExisting = xml.replace(/<p:timing>[\s\S]*?<\/p:timing>/, "");
  const transition = /<p:transition[\s\S]*?<\/p:transition>/.exec(withoutExisting);
  if (transition) {
    return withoutExisting.replace(transition[0], `${transition[0]}${timing}`);
  }
  const clrMap = /<p:clrMapOvr>[\s\S]*?<\/p:clrMapOvr>/.exec(withoutExisting);
  if (clrMap) {
    return withoutExisting.replace(clrMap[0], `${clrMap[0]}${timing}`);
  }
  return withoutExisting.replace("</p:sld>", `${timing}</p:sld>`);
}

/**
 * Patches every slide's native animation timeline.
 *
 * Shapes are addressed by the object name PptxGenJS wrote, which the exporter
 * sets to the stable element id. An animation whose target cannot be found
 * (for example a chart, which has no object-name option) is skipped and
 * counted, never pointed at a guessed shape id.
 */
export function patchSlideAnimations(
  entries: Record<string, Uint8Array>,
  slides: readonly Slide[],
): NativeAnimationResult {
  let written = 0;
  let skipped = 0;
  slides.forEach((slide, index) => {
    if (!slide.animations || slide.animations.length === 0) return;
    const part = `ppt/slides/slide${index + 1}.xml`;
    const data = entries[part];
    if (!data) {
      skipped += slide.animations.length;
      return;
    }
    const xml = strFromU8(data);
    const shapeIds = shapeIdsByElement(xml);
    // Charts now carry a stable name for native grouping, but chart animation
    // is still unverified. Keep the existing behavior instead of writing a
    // timing target just because the name exists.
    const charts = new Set(
      slide.elements.filter((element) => element.type === "chart").map((element) => element.id),
    );
    const grouped: GroupedAnimation[] = [];
    for (const animation of slide.animations) {
      const shapeId = shapeIds.get(animation.elementId);
      if (!shapeId || charts.has(animation.elementId) || !animationExportsNatively(animation.effect)) {
        skipped += 1;
        continue;
      }
      grouped.push({ animation, shapeId });
    }
    const timing = buildTimingXml(grouped);
    if (!timing) return;
    const patched = applyTimingToSlideXml(xml, timing);
    if (patched === xml) return;
    entries[part] = strToU8(patched);
    written += grouped.length;
  });
  return { written, skipped };
}
