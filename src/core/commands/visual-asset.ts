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
  "财经杂志编辑摄影或高质量材质特写，低饱和、自然光、留白充足，与页面主色协调；不要霓虹灯、不要 Logo、不要图标、不要 UI 元素，画面中不要出现任何文字、字母或数字";

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

/**
 * 手工路径下图框落在哪里。
 *
 * AI 设计路径的图位由页面的内容区决定（`planVisualAssetLayout`），因为那一页
 * 的版面是刚排出来的、还没人动过。手工路径不一样：页面上的东西已经摆好了，
 * 图位必须避开正文，否则一张图压住三行字。
 *
 * 所以这里给每个角色一个**固定图位**，不依赖页面的现有内容：
 *
 * - hero: 右侧一整块，图是这一页视觉上的主体。
 * - side: 右下角一块小图，不抢正文的注意力。
 * - band: 标题下方一条通栏图，横贯整页。
 *
 * 图位仍然由代码算，不是用户拖。用户拖是之后的事，默认位置先得站得住。
 *
 * 比例和 [`VISUAL_ASSET_ASPECT`] 一致，也就是和前端请求图片时用的比例一致：
 * 图和框的比例相同，图填进框里什么都不用切。
 */

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
 * 手工路径下图框落在哪里。
 *
 * AI 设计路径的图位由页面的内容区决定（`planVisualAssetLayout`），因为那一页
 * 的版面是刚排出来的、还没人动过。手工路径不一样：页面上的东西已经摆好了，
 * 图位必须避开正文，否则一张图压住三行字。
 *
 * 所以这里给每个角色一个**固定图位**，不依赖页面的现有内容：
 *
 * - hero: 右侧一整块，图是这一页视觉上的主体。
 * - side: 右下角一块小图，不抢正文的注意力。
 * - band: 标题下方一条通栏图，横贯整页。
 *
 * 图位仍然由代码算，不是用户拖。用户拖是之后的事，默认位置先得站得住。
 *
 * 比例和 [`VISUAL_ASSET_ASPECT`] 一致，也就是和前端请求图片时用的比例一致：
 * 图和框的比例相同，图填进框里什么都不用切。
 */
export function planManualVisualAssetLayout(
  role: AiVisualAssetRole,
  pageWidthEmu: number,
  pageHeightEmu: number,
): VisualAssetLayout {
  const aspect = VISUAL_ASSET_ASPECT[role];
  const pageWidthPx = pageWidthEmu;
  const pageHeightPx = pageHeightEmu;

  switch (role) {
    case "hero": {
      // 右侧整块，高度撑满内容区，宽度按比例跟着走；放不下就按宽度收。
      const maxWidthPx = pageWidthPx * 0.42;
      const maxHeightPx = pageHeightPx * 0.66;
      let widthPx = maxWidthPx;
      let heightPx = widthPx / aspect;
      if (heightPx > maxHeightPx) {
        heightPx = maxHeightPx;
        widthPx = heightPx * aspect;
      }
      const x = pageWidthPx - widthPx - pageWidthPx * 0.05;
      const y = pageHeightPx * 0.17;
      return {
        image: {
          x: x / pageWidthPx,
          y: y / pageHeightPx,
          width: widthPx / pageWidthPx,
          height: heightPx / pageHeightPx,
        },
        text: {
          x: 0.06,
          y: 0.17,
          width: (x - pageWidthPx * 0.05 - pageWidthPx * 0.06) / pageWidthPx,
          height: maxHeightPx / pageHeightPx,
        },
      };
    }
    case "side": {
      // 右下角一块小图。正文在它上面和左边。
      const widthPx = pageWidthPx * 0.32;
      const heightPx = widthPx / aspect;
      const x = pageWidthPx - widthPx - pageWidthPx * 0.05;
      const y = pageHeightPx * 0.78 - heightPx;
      return {
        image: {
          x: x / pageWidthPx,
          y: y / pageHeightPx,
          width: widthPx / pageWidthPx,
          height: heightPx / pageHeightPx,
        },
        text: { x: 0.06, y: 0.17, width: (x - pageWidthPx * 0.05 - pageWidthPx * 0.06) / pageWidthPx, height: 0.6 },
      };
    }
    case "band": {
      // 通栏图横贯标题下方，宽度用满内容区。
      const widthPx = pageWidthPx * 0.88;
      const heightPx = widthPx / aspect;
      const x = pageWidthPx * 0.06;
      const y = pageHeightPx * 0.15;
      return {
        image: {
          x: x / pageWidthPx,
          y: y / pageHeightPx,
          width: widthPx / pageWidthPx,
          height: heightPx / pageHeightPx,
        },
        text: {
          x: 0.06,
          y: (y + heightPx + pageHeightPx * 0.03) / pageHeightPx,
          width: 0.88,
          height: (pageHeightPx * 0.85 - y - heightPx) / pageHeightPx,
        },
      };
    }
  }
}

/**
 * 算出图和文字各自的位置。
 *
 * 图不叠在文字上：它占一块自己的地方，文字区相应缩小。两者共享一条边，
 * 所以页面上有一条明确的分界，而不是一层盖一层。
 *
 * 图框的比例由 [`VISUAL_ASSET_ASPECT`] 决定，和前端请求图片时用的比例是同一个数。
 * 比例一致，填充裁剪就什么都不用切；比例不一致，裁剪会把画面切掉一大半。
 *
 * 框在像素里算，不在归一化坐标里算：归一化坐标的宽高比不等于像素宽高比
 * （页面是 16:9，宽按页宽、高按页高），照归一化算出来的框放进页面就不是
 * 想要的比例。
 */
export function planVisualAssetLayout(
  role: AiVisualAssetRole,
  content: NormalizedRect,
  pageWidthEmu: number,
  pageHeightEmu: number,
): VisualAssetLayout {
  const contentPx = { width: content.width * pageWidthEmu, height: content.height * pageHeightEmu };
  const aspect = VISUAL_ASSET_ASPECT[role];
  const gapPx = contentPx.width * 0.04;

  switch (role) {
    case "hero": {
      // 主视觉占右半页，文字留在左半页，中间留一道缝。
      // 高度优先：图占满内容区的高度，宽度按比例跟着走。
      let heightPx = contentPx.height;
      let widthPx = heightPx * aspect;
      const maxWidthPx = contentPx.width * 0.46;
      if (widthPx > maxWidthPx) {
        widthPx = maxWidthPx;
        heightPx = widthPx / aspect;
      }
      const image = {
        x: content.x + content.width - widthPx / pageWidthEmu,
        y: content.y + (content.height - heightPx / pageHeightEmu) / 2,
        width: widthPx / pageWidthEmu,
        height: heightPx / pageHeightEmu,
      };
      return {
        image,
        text: {
          x: content.x,
          y: content.y,
          width: content.width - image.width - gapPx / pageWidthEmu,
          height: content.height,
        },
      };
    }
    case "side": {
      // 侧栏图占右下角，文字区在其上方和左侧。
      const maxWidthPx = contentPx.width * 0.34;
      const maxHeightPx = contentPx.height * 0.46;
      let widthPx = maxWidthPx;
      let heightPx = widthPx / aspect;
      if (heightPx > maxHeightPx) {
        heightPx = maxHeightPx;
        widthPx = heightPx * aspect;
      }
      const image = {
        x: content.x + content.width - widthPx / pageWidthEmu,
        y: content.y + content.height - heightPx / pageHeightEmu,
        width: widthPx / pageWidthEmu,
        height: heightPx / pageHeightEmu,
      };
      return {
        image,
        text: {
          x: content.x,
          y: content.y,
          width: content.width - image.width - gapPx / pageWidthEmu,
          height: content.height,
        },
      };
    }
    case "band": {
      // 通栏图压在文字区上方，文字在其下方。
      // 通栏图先按内容区宽度铺开，再按图片比例算高度；高度超过内容区
      // 六成时才等比缩回。原来从内容区高度反推宽度，4:1 的图只剩约
      // 31% 页宽，完全不像“通栏”。
      const maxHeightPx = contentPx.height * 0.6;
      let widthPx = contentPx.width;
      let heightPx = widthPx / aspect;
      if (heightPx > maxHeightPx) {
        heightPx = maxHeightPx;
        widthPx = heightPx * aspect;
      }
      const image = {
        x: content.x + (content.width - widthPx / pageWidthEmu) / 2,
        y: content.y,
        width: widthPx / pageWidthEmu,
        height: heightPx / pageHeightEmu,
      };
      return {
        image,
        text: {
          x: content.x,
          y: content.y + image.height + gapPx / pageHeightEmu,
          width: content.width,
          height: content.height - image.height - gapPx / pageHeightEmu,
        },
      };
    }
  }
}
