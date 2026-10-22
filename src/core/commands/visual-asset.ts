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
 * 这一页该不该配图、配成什么角色。
 *
 * 规则来自内容本身：只有页面角色和内容密度共同允许时才配图。
 * 一张图会占掉半个页面，页面上的文字必须还能装下。
 *
 * AI 指定的角色会被采纳，但只在它装得下这一页时：主视觉要一整块地方，
 * 侧栏和通栏要一张还能读得清的图。
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
  /** AI 指定的角色。 */
  requestedRole?: AiVisualAssetRole;
}): { enabled: boolean; role?: AiVisualAssetRole; reason?: string } {
  if (!input.requested) return { enabled: false, reason: "AI 没有为这一页要求配图" };
  if (input.hasDeterministicBlock) {
    // 结构化块自己就是版面：时间线、对比、流程、指标、表格各有一套图形。
    // 再塞一张图会让这一页同时讲两件事。
    return { enabled: false, reason: "该页有结构化内容块，版面由内容块决定" };
  }
  const isCover = input.layout === "cover" || input.layout === "section";
  if (input.requestedRole === "hero") {
    // 主视觉要占掉半个页面，文字必须还剩得下一块地方。
    if (!isCover) return { enabled: false, reason: "主视觉只能用于封面或章节页" };
    return { enabled: true, role: "hero" };
  }
  if (isCover) {
    // 封面和章节页本来就没有几行字，配一张侧栏图反而挤。
    return { enabled: true, role: "hero" };
  }
  if (input.itemCount > 4) {
    // 四条以上的要点已经占满一页，图会把正文挤到读不下去。
    return { enabled: false, reason: `该页有 ${input.itemCount} 条要点，放不下配图` };
  }
  return { enabled: true, role: input.requestedRole ?? "side" };
}

/**
 * 每个角色要一张什么形状的图。
 *
 * 这份尺寸是**图与框共同的契约**：前端按它向图像模型请求，排版引擎按它给图
 * 留框。两边用同一个数，图和框的比例才相等，填充裁剪才不必切掉画面。
 *
 * 之前两边各写各的：框由排版算出来，请求尺寸是随手写的（正方形、16:9），
 * 结果一张 16:9 的图塞进 7.3:1 的横条里，四分之三的画面被切掉——
 * 这正是"AI 配图一眼假"的来源之一，而且裁得越狠越像随便贴的素材。
 *
 * 尺寸还受厂商限制：边长在 [512, 2048] 之间且是 8 的倍数，所以最宽的比例
 * 是 4:1（2048×512）。通栏角色因此最多只能是 4:1，再宽就生成不出来。
 */
export const VISUAL_ASSET_REQUEST_SIZE: Record<AiVisualAssetRole, { width: number; height: number }> = {
  /** 主视觉：4:3，落在右半页。 */
  hero: { width: 1024, height: 768 },
  /** 侧栏图：2:1，落在右下角。 */
  side: { width: 1024, height: 512 },
  /** 通栏图：4:1，落在文字上方。 */
  band: { width: 2048, height: 512 },
};

/** 每个角色的图框比例。图框按这个比例留，请求也按这个比例要。 */
export const VISUAL_ASSET_ASPECT: Record<AiVisualAssetRole, number> = {
  hero: 4 / 3,
  side: 2,
  band: 4,
};

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
