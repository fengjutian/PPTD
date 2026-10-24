import type { Emu, RectEmu } from "../document-model";

/**
 * A rectangle in page-relative units, 0–1 on both axes.
 *
 * Duplicated here as a structural type so this module has no runtime or type
 * dependency on the recipe registry: recipes import `PageChrome`, not the other
 * way round.
 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The shared chrome of a page: the title axis, the accent rule and the content
 * region.
 *
 * Every page type used to compute these three things on its own. The recipe
 * put the title at 0.09 and the rule at 0.265; the legacy card branch used the
 * template's safe area; the data page put its rule at 0.38; the comparison
 * branch drew no rule at all. In one deck the eye saw four different headers.
 *
 * This object is computed once by the command layer and passed to every branch.
 * A branch may place its own content, but it does not get to invent a new title
 * axis or a new rule position.
 */
export interface PageChrome {
  /** The title frame, normalized. Template regions win on template pages. */
  title: NormalizedRect;
  /** The accent rule below the title. */
  rule: NormalizedRect;
  /** The region the page content may use. */
  content: NormalizedRect;
  /** Top of the content region. */
  contentTop: number;
  /** Bottom of the content region. */
  contentBottom: number;
  /**
   * Whether a recipe should draw the accent rule. A template that already
   * carries a header line or ornament sets this to false so the page does not
   * get a second rule under the first one.
   */
  showRule: boolean;
}

export interface PageChromeInput {
  page: { width: Emu; height: Emu };
  /** The title frame the page already resolved (template placeholder or safe area). */
  title: RectEmu;
  /** The content frame the page already resolved (template placeholder or safe area). */
  content: RectEmu;
  /** The safe area, when the page has one. Content is clipped to it. */
  safe?: NormalizedRect;
  /** False when the template owns the header rule. Defaults to true. */
  showRule?: boolean;
}

const MIN_SIZE = 0.001;
/** The breathing space between the title frame and its rule, in page height. */
const RULE_GAP = 0.03;
/** The smallest gap that still reads as a separation. */
const MIN_RULE_GAP = 0.012;
/** The rule never comes closer than this to the content top. */
const RULE_CONTENT_CLEARANCE = 0.02;
const RULE_HEIGHT = 0.006;
const RULE_MAX_WIDTH = 0.12;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(frame: RectEmu, page: { width: Emu; height: Emu }): NormalizedRect {
  if (page.width <= 0 || page.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: clamp(frame.x / page.width),
    y: clamp(frame.y / page.height),
    width: clamp(frame.width / page.width),
    height: clamp(frame.height / page.height),
  };
}

/** The intersection of two normalized rectangles, or `undefined` when empty. */
function intersect(left: NormalizedRect, right: NormalizedRect): NormalizedRect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge - x < MIN_SIZE || bottomEdge - y < MIN_SIZE) return undefined;
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

/**
 * Derives the shared page chrome from the frames the page already resolved.
 *
 * Template pages pass their title/body placeholders; preset pages pass the
 * safe-area frames. The rule follows the title frame, so a short template title
 * bar still gets a rule above the content instead of one drawn across it.
 */
export function planPageChrome(input: PageChromeInput): PageChrome {
  const title = normalize(input.title, input.page);
  const rawContent = normalize(input.content, input.page);
  const safe: NormalizedRect = input.safe ?? { x: 0, y: 0, width: 1, height: 1 };
  const content = intersect(rawContent, safe) ?? rawContent;

  const titleBottom = title.y + title.height;
  const available = content.y - titleBottom;
  const gap =
    available > MIN_RULE_GAP * 2
      ? Math.min(RULE_GAP, Math.max(MIN_RULE_GAP, available * 0.25))
      : Math.min(MIN_RULE_GAP, Math.max(0, available * 0.5));

  let ruleY = titleBottom + gap;
  const latestRuleY = content.y - RULE_CONTENT_CLEARANCE;
  if (available > 0 && ruleY > latestRuleY) {
    // The title frame reaches into (or past) the content region. Keep the rule
    // inside the title frame instead of letting it cross the copy.
    ruleY = Math.max(0, Math.min(titleBottom - MIN_RULE_GAP, latestRuleY));
  }
  if (available <= 0) {
    ruleY = Math.max(0, titleBottom - MIN_RULE_GAP);
  }

  return {
    title,
    rule: {
      x: title.x,
      y: clamp(ruleY),
      width: Math.min(RULE_MAX_WIDTH, Math.max(MIN_SIZE, title.width * 0.2)),
      height: RULE_HEIGHT,
    },
    content,
    contentTop: content.y,
    contentBottom: content.y + content.height,
    showRule: input.showRule ?? true,
  };
}

/** A recipe context only needs its frames and an optional precomputed chrome. */
export interface ChromeSource {
  frame: {
    title: RectEmu;
    content: RectEmu;
    safe: NormalizedRect;
    page: { width: Emu; height: Emu };
  };
  chrome?: PageChrome;
}

/**
 * Returns the page chrome, deriving it when the caller did not pass one.
 *
 * Recipes used to compute their own title/rule positions. They now ask for this
 * object; the fallback keeps direct recipe tests and old call sites working.
 */
export function resolveChrome(source: ChromeSource): PageChrome {
  return (
    source.chrome ??
    planPageChrome({
      page: source.frame.page,
      title: source.frame.title,
      content: source.frame.content,
      safe: source.frame.safe,
    })
  );
}
