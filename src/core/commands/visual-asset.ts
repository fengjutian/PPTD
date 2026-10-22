/**
 * 视觉素材：AI 表达意图，确定性引擎决定位置。
 *
 * 一份没有配图的演示文稿，每一页都是"文字+矩形+文字+矩形"。这是 AI 生成的
 * 文稿看起来一眼假的最大单一原因：真实演示里有照片、示意图、图表，这些东西
 * 承载不了多少文字，却决定了页面的视觉分量。
 *
 * AI 能表达的是**要不要配图**和**配什么图**（一段描述），不是图放在哪里。
 * 放在哪里是排版引擎的活，和构图、层级、密度一样：模型说了不算，引擎算完
 * 才算数。这样 AI 生成的页面和手工排的页面遵守同一套几何规则。
 *
 * 图片生成是外部依赖，可能没有凭据、可能超时、可能被限流。因此素材层的失败
 * 路径必须让文稿照常成立：没有图就退回纯排版，而不是整份生成失败。
 */

/** 一页要配什么样的图。 */
export interface AiVisualAsset {
  /**
   * 是否给这一页配图。
   *
   * 只有真正需要视觉锚点的页面才该为 true：封面、章节页、图文叙事的正文页。
   * 每一页都配图会让整套演示变成相册。
   */
  enabled: boolean;
  /**
   * 配图的描述，写给图像生成模型。
   *
   * 它描述的是**画面**，不是文案："一间明亮的现代化办公室，几何线条构成的
   * 上升箭头"。写清楚画面里不要出现文字，因为生成的文字在演示里几乎总是错的。
   */
  prompt?: string;
  /**
   * 这一页的图要承担什么角色。
   *
   * - "hero": 整幅主视觉，图是这一页的主体（封面、章节页）。
   * - "side": 侧栏配图，图在文字旁边（图文叙事页）。
   * - "band": 通栏配图，图在文字上方或下方成一条横带。
   */
  role?: AiVisualAssetRole;
}

/** 配图在页面上的角色。 */
export type AiVisualAssetRole = "hero" | "side" | "band";

/** 配图角色的合法取值。 */
export const VISUAL_ASSET_ROLES: readonly AiVisualAssetRole[] = ["hero", "side", "band"];

/** 一个角色名是否是合法角色。 */
export function isVisualAssetRole(value: unknown): value is AiVisualAssetRole {
  return typeof value === "string" && (VISUAL_ASSET_ROLES as readonly string[]).includes(value);
}

/** 素材层的默认描述前缀，让不同页面的图看起来像同一套。 */
export const VISUAL_ASSET_STYLE_HINT =
  "商务演示配图，简洁克制的几何构成，柔和光线，与页面主色协调，画面中不要出现任何文字、字母或数字";

/**
 * 一页的配图提示词。
 *
 * 提示词由两部分组成：整册共用的风格前缀，和这一页自己的画面描述。
 * 风格前缀让整套演示的图看起来像同一本素材，而不是东一张西一张。
 */
export function buildVisualAssetPrompt(description: string | undefined, topic: string): string {
  const trimmed = (description ?? "").trim();
  const scene = trimmed || `与「${topic}」主题相关的抽象概念画面`;
  return `${VISUAL_ASSET_STYLE_HINT}。${scene}`;
}

/**
 * 这一页该不该配图。
 *
 * 规则来自内容本身：只有页面角色和内容密度共同允许时才配图。
 * 一张图会占掉半个页面，页面上的文字必须还能装下。
 */
export function resolveVisualAsset(input: {
  /** 页面在整套演示中的角色。 */
  layout: string;
  /** 页面上的要点条数。 */
  itemCount: number;
  /** 页面是否有结构化内容块；有块的页面由块决定版面。 */
  hasDeterministicBlock: boolean;
  /** AI 是否要求配图。 */
  requested?: boolean;
}): { enabled: boolean; role?: AiVisualAssetRole; reason?: string } {
  if (!input.requested) return { enabled: false, reason: "AI 没有为这一页要求配图" };
  if (input.hasDeterministicBlock) {
    // 结构化块自己就是版面：时间线、对比、流程、指标、表格各有一套图形。
    // 再塞一张图会让这一页同时讲两件事。
    return { enabled: false, reason: "该页有结构化内容块，版面由内容块决定" };
  }
  if (input.layout === "cover" || input.layout === "section") {
    return { enabled: true, role: "hero" };
  }
  if (input.itemCount > 4) {
    // 四条以上的要点已经占满一页，图会把正文挤到读不下去。
    return { enabled: false, reason: `该页有 ${input.itemCount} 条要点，放不下配图` };
  }
  return { enabled: true, role: "side" };
}

/** 配图占页面多大比例。 */
export const VISUAL_ASSET_SHARE = {
  /** 主视觉：图占页面右侧，留出左侧文字区。 */
  hero: { width: 0.46, height: 1 },
  /** 侧栏：图占右侧一条。 */
  side: { width: 0.34, height: 0.52 },
  /** 通栏：图占整宽一条，压在文字上方。 */
  band: { width: 1, height: 0.30 },
} as const;

/**
 * 一页的图会挤掉多少文字区。
 *
 * 排版引擎用这个数字把文字框收窄，而不是把图叠在文字上面。
 */
export function visualAssetTextShare(role: AiVisualAssetRole): { width: number; height: number; offsetX: number; offsetY: number } {
  switch (role) {
    case "hero":
      return { width: 0.54, height: 1, offsetX: 0, offsetY: 0 };
    case "side":
      return { width: 0.62, height: 1, offsetX: 0, offsetY: 0 };
    case "band":
      return { width: 1, height: 0.70, offsetX: 0, offsetY: 0.30 };
  }
}

/** 一个归一化的矩形。 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一页里图和文字各自的位置。 */
export interface VisualAssetLayout {
  /** 图放在哪里。 */
  image: NormalizedRect;
  /** 图让出的文字区。 */
  text: NormalizedRect;
}

/**
 * 算出图和文字各自的位置。
 *
 * 图不叠在文字上：它占一块自己的地方，文字区相应缩小。两者共享一条边，
 * 所以页面上有一条明确的分界，而不是一层盖一层。
 */
export function planVisualAssetLayout(role: AiVisualAssetRole, content: NormalizedRect): VisualAssetLayout {
  switch (role) {
    case "hero": {
      // 主视觉占右半页，文字留在左半页，中间留一道缝。
      const imageWidth = content.width * 0.44;
      const gap = content.width * 0.04;
      return {
        image: { x: content.x + content.width - imageWidth, y: content.y, width: imageWidth, height: content.height },
        text: { x: content.x, y: content.y, width: content.width - imageWidth - gap, height: content.height },
      };
    }
    case "side": {
      // 侧栏图占右下角，文字区在其上方和左侧。
      const imageWidth = content.width * 0.34;
      const imageHeight = content.height * 0.46;
      const gap = content.width * 0.03;
      return {
        image: { x: content.x + content.width - imageWidth, y: content.y + content.height - imageHeight, width: imageWidth, height: imageHeight },
        text: { x: content.x, y: content.y, width: content.width - imageWidth - gap, height: content.height },
      };
    }
    case "band": {
      // 通栏图压在文字区上方，文字在其下方。
      const imageHeight = content.height * 0.42;
      const gap = content.height * 0.04;
      return {
        image: { x: content.x, y: content.y, width: content.width, height: imageHeight },
        text: { x: content.x, y: content.y + imageHeight + gap, width: content.width, height: content.height - imageHeight - gap },
      };
    }
  }
}
