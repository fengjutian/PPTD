# TASK-DESIGN-001：整册设计概念与首批页面配方（P1）

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P1，待 10 页真实 AI 端到端复核）                  |
| 优先级   | P1                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 7–8.5 人日（P1）；P2 另计 4–6 人日                        |
| 依赖     | ADR 0046、ADR 0021、ADR 0038、ADR 0043                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

当前 `AiSlideDesign` 只能表达 `layout / composition / emphasis / densityTarget / palette / visualNarrative`。这些字段足以决定“这页属于哪类容器”，但不足以决定“这页长成什么样”：

- 渲染器实际只有四种可辨认的内容页骨架：2×2 白卡、左右等宽面板、编号栏 + 计数面板、流程条。
- 卡片页和两栏页没有文本恰好等于 `content.body` 的元素，`emphasis` 的缩放分支基本空转。
- 同一册正文字号随版式在 14/16/17/18/20pt 之间跳；标题基线在 0.90in 与 0.53in 之间逐页交替。
- 计数面板用约 1/5 版面写“05 项要点”，不承载信息；真正需要视觉锚点的页面没有数据、图或引文。
- 视觉评审只量层级、对齐、可读性，修复动作只能在已有版式内挪动、缩放、改色；它能把模板修整齐，不能把模板修好看。

本任务先做最小闭环：**整册一个概念，两个可以真实渲染的页面配方，先让“编辑式”页面替换掉等权卡片和等宽面板**。不追求一次覆盖所有隐喻。

## 2. 目标

在内容审核之后增加“设计方向”阶段，生成并解析一个整册 `DeckConcept`；逐页选择 `editorial-index` 或 `asymmetric-split` 配方；由纯函数配方生成元素，坐标仍由引擎计算。已审核内容、内容哈希、审核状态和页序不变；导出的 PPTX 仍是原生可编辑对象。

P1 成功后，用同一份 10 页内容做前后对比：

- 第 1/3/5/9/10 页使用 `editorial-index`，替换 2×2 白卡和“项要点”面板；
- 第 2/4/6/8 页使用 `asymmetric-split`，替换左右等宽面板；
- 第 7 页流程页继续走现有分支，P2 再迁移；
- 使用配方的页面标题左轴、正文字号、页脚位置一致；
- PowerPoint 打开导出的文件，图标与文字均可编辑。

## 3. 范围

### 3.1 本任务包含

- `DeckConcept`、`AiDeckConcept`、`ConceptPresetId`、`RecipeId`、`PageBeat` 类型。
- `resolveDeckConcept()` 与 `editorial` 概念预设（P1 只开放这一个）。
- `DesignTokens` 派生：字阶、间距、细线、网格、圆角。
- 配方接口、注册表、合法性检查、整册配方节奏。
- `editorial-index` 与 `asymmetric-split` 两个配方。
- `AiSlideDesign` 增加可选 `recipe / variant / focal`；旧设计没有字段时走旧分支。
- Rust `generate_deck_concepts` 命令 + 提示词；TS zod 合同。
- 逐页设计提示词增加配方选择；无效配方回退到确定性映射。
- `apply-ai-designed-draft` 增加可选 `designConcept`，在旧分支之前分派配方。
- 质量报告展示概念名称、逐页配方、冲突和 fallback 原因。
- 单元、命令、导出和真实 PowerPoint 人工验证。

### 3.2 本任务不包含（P2/P3）

| 缺口                                                                                      | 计划  |
| ----------------------------------------------------------------------------------------- | ----- |
| 设计方向选择器、缩略图预览、换一批                                                        | P2    |
| `cover-statement`、`data-story`、`image-led`、`process-rail`、`comparison`、`quote-field` | P2    |
| `conceptFitScore`、`distinctivenessScore`、`changeRecipe` 修复动作                        | P2    |
| 概念持久化、重新设计、跨项目复用                                                          | P3    |
| 模板版式内的配方适配                                                                      | P2/P3 |
| 任意隐喻、自由坐标、自由字号                                                              | 不做  |

## 4. 功能需求

| ID    | 需求                                                                                 | 验收 |
| ----- | ------------------------------------------------------------------------------------ | ---- |
| FR-1  | 根据已审核内容和 SlideBrief 生成 1 个概念（P1 只允许 `editorial`；P2 再扩到 2–3 个） | AC-1 |
| FR-2  | `resolveDeckConcept` 把预设展开为母题、配方集合、表面策略和节奏                      | AC-1 |
| FR-3  | 3–6 条短要点使用 `editorial-index`，不出现白卡和计数面板                             | AC-2 |
| FR-4  | 2–5 条较长要点使用 `asymmetric-split`，标题栏与正文栏非对称                          | AC-2 |
| FR-5  | 配方拒绝结构化块、引文、封面/章节页和带模板背景的页面，回退旧分支                    | AC-3 |
| FR-6  | 标题左轴、正文字号、页脚位置由令牌统一，不随配方变化                                 | AC-4 |
| FR-7  | 每个配方报告 `consumed`；已审核文字不丢、不改、不重排                                | AC-5 |
| FR-8  | 设计变更只递增 design/document revision，内容哈希与审核状态不变                      | AC-5 |
| FR-9  | 没有 `recipe` 的旧设计输出与改造前一致                                               | AC-6 |
| FR-10 | 导出的 PPTX 在 PowerPoint 打开，文字/图标为原生对象                                  | AC-7 |
| FR-11 | 生成任务可取消；概念阶段失败时降级到默认 `editorial`，不阻断出稿                     | AC-8 |
| FR-12 | 相同内容 + 相同概念 + 相同主题得到相同元素几何                                       | AC-9 |

## 5. 技术设计

### 5.1 模块落点

新增：

```text
src/core/design/deck-concept.ts       概念类型、预设目录、resolveDeckConcept
src/core/design/design-tokens.ts      从主题/页面/概念派生令牌
src/core/layout/recipes/types.ts      RecipeId、RecipeContext、RecipePlan、LayoutRecipe
src/core/layout/recipes/registry.ts   配方注册表与查找
src/core/layout/recipes/editorial-index.ts
src/core/layout/recipes/asymmetric-split.ts
src/core/layout/recipes/plan.ts       合法性、整册节奏、fallback
src/core/layout/recipes/measure.ts    文本框高度、字号拟合、重叠检查
```

修改：

```text
src/core/commands/template-layouts.ts AiSlideDesign 增加 recipe/variant/focal
src/core/commands/commands.ts          apply-ai-designed-draft 增加 designConcept 与配方分派
src/services/ai-service.ts             generateDeckConcepts、zod 合同、传递概念
src-tauri/src/commands/ai.rs           generate_deck_concepts + 提示词 + 设计提示词扩写
src/app/App.tsx                        生成链路插入概念阶段、进度与报告
docs/architecture/decisions/0046-...   已写
```

不新增依赖；配方只用现有 `estimateTextLines`、`stripListPrefix` 和文档模型。

### 5.2 类型合同

```ts
// src/core/design/deck-concept.ts
export type ConceptPresetId = "editorial"; // P1 只开放一个；P2 扩充
export type DeckMotif = "rules" | "blocks" | "instrument" | "documentary" | "signal" | "paper";
export type SurfaceStrategy = "flat" | "rules" | "panels" | "full-bleed";
export type ImageryStrategy = "none" | "hero" | "band" | "side" | "texture";
export type TypeContrast = "calm" | "strong" | "dramatic";
export type PageBeat = "statement" | "evidence" | "quiet" | "close";

export interface AiDeckConcept {
  preset: ConceptPresetId;
  name: string; // 展示名，1–20 字
  idea: string; // 一句话，1–80 字，只展示
  typeContrast: TypeContrast;
  imagery: ImageryStrategy;
  rationale: string; // 为什么适合这份内容，1–120 字
}

export interface DeckConcept extends AiDeckConcept {
  id: string;
  motif: DeckMotif;
  recipes: readonly RecipeId[];
  rhythm: readonly PageBeat[];
  surface: SurfaceStrategy;
}
```

`RecipeId` 在 P1 只包含已实现的两个值，避免合同里出现“选了但画不出”的配方：

```ts
export type RecipeId = "editorial-index" | "asymmetric-split";
```

配方合同：

```ts
// src/core/layout/recipes/types.ts
export interface RecipeContext {
  content: SlideContent;
  facts: CompositionFacts;
  concept: DeckConcept;
  tokens: DesignTokens;
  colors: {
    title: string;
    body: string;
    accent: string;
    background: string;
    rule: string;
  };
  frame: {
    title: RectEmu;
    content: RectEmu;
    safe: NormalizedRect;
    page: { width: Emu; height: Emu };
  };
  page: { index: number; total: number };
  asset?: AiVisualAsset;
}

export interface RecipePlan {
  elements: SlideElement[];
  /** 配方实际消费的已审核内容；少一条就拒绝，不允许静默丢字。 */
  consumed: {
    title: boolean;
    body: boolean;
    items: number;
    blockIds: readonly string[];
  };
  conflicts: IntentConflict[];
}

export interface LayoutRecipe {
  id: RecipeId;
  supports(facts: CompositionFacts, concept: DeckConcept, options: { hasArtwork: boolean; hasAsset: boolean }): boolean;
  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict };
}
```

`colors` 由命令层从 `AiSlideDesign` 和模板/预设解析后传入；配方不直接读模板，也不自己算对比度。

`AiSlideDesign` 新增可选字段：

```ts
export interface AiSlideDesign {
  // ...现有字段
  recipe?: RecipeId;
  variant?: "left" | "right";
  focal?: "title" | "index" | "body";
}
```

全部可选；旧设计、旧 AI 响应、旧项目文件不受影响。

### 5.3 概念预设

P1 只实现 `editorial`：

```ts
const CONCEPT_PRESETS = {
  editorial: {
    motif: "rules",
    surface: "rules",
    recipes: ["editorial-index", "asymmetric-split"],
    imagery: "none",
    typeContrast: "strong",
  },
} as const;

export function defaultEditorialConcept(): AiDeckConcept {
  return {
    preset: "editorial",
    name: "编辑式",
    idea: "用细线、大字号和编号栏组织内容，不用卡片。",
    typeContrast: "strong",
    imagery: "none",
    rationale: "内容以判断和要点为主，没有可支撑的数字或图片。",
  };
}
```

`resolveDeckConcept({ concept, pageFacts, pageCount })` 的输入是概念、逐页 `CompositionFacts` 和页数；`rhythm` 的长度必须等于 `pageCount`，否则抛 `AI_CONCEPT_RHYTHM_INVALID`。

1. 校验 preset 存在；未知 preset 回退 `editorial` 并记录冲突。
2. 用预设填充 `motif / surface / recipes`；`imagery` 只允许预设支持的集合，`editorial` 只允许 `none`，其他值回退 `none` 并记录冲突。
3. 由页面事实生成 `rhythm`：
   - 第 0 页 `statement`；
   - 有结构化数字/表格/指标页 `evidence`；
   - 最后一页 `close`；
   - 其余 `quiet`；
   - 连续三个 `quiet` 时，把中间页标为 `statement`（如果该页只有一条要点）。
4. P1 的 `rhythm` 只写入质量报告和日志，不改变页面明暗；明暗仍由现有 `applyDeckArtDirection` 决定。P2 再让 `rhythm` 接管表面策略，避免 P1 同时改背景、文字墨色和配方三条链路。
5. 返回带稳定 `id` 的 `DeckConcept`（`crypto.randomUUID()`，不进入内容哈希）。

### 5.4 令牌

```ts
export interface DesignTokens {
  type: {
    displayPt: number;
    titlePt: number;
    subtitlePt: number;
    bodyPt: number;
    captionPt: number;
    lineHeight: number;
  };
  space: { xs: number; sm: number; md: number; lg: number; xl: number }; // 页面归一化高度
  rule: { hairlinePt: number; accentPt: number };
  grid: { columns: number; margin: number; gutter: number }; // 归一化宽度
  radius: { cardPt: number; badgePt: number };
}
```

派生规则：

- `type` 来自 `resolveTypeScale(document.theme)`；`typeContrast` 只做比例：`calm` display/title ×0.96；`strong` ×1；`dramatic` display ×1.2、title ×1.1。
- `space` 默认 `{ xs: 0.012, sm: 0.025, md: 0.045, lg: 0.07, xl: 0.12 }`（页面高度比例），P1 不随页面变化。
- `grid`: `columns=12`, `margin=0.07`, `gutter=0.022`。
- `rule`: `hairlinePt=0.75`, `accentPt=2.5`。
- `radius`: `cardPt=8`, `badgePt=999`。
- 主题已有 `body.lineHeight` 时使用主题值；没有则 1.25。

配方内部所有坐标从 `ctx.frame.safe` 和 `tokens` 计算，禁止再写 `16/18/20pt`、`2.55in` 这类魔法数字。

### 5.5 配方规格

两个配方共用同一个标题轴：`x=0.07`、`y=0.09`、`width=0.86`、`height=0.16`（归一化），标题下细线在 `y=0.27`。页脚仍由命令层统一添加。标题用 `colors.title`，正文用 `colors.body`，编号/强调线用 `colors.accent`，分隔线用 `colors.rule`；配方不新增颜色。

#### editorial-index

适用：3–6 条短要点，无结构化块、无引文、无图片，页面不是 cover/section/quote。

| 区域     | 规则                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 标题     | x 0.07，y 0.09，w 0.86，h 0.16；字号 titlePt，最多两行                        |
| 引导段   | 可选：`body` 中有、条目里没有的完整句子放标题下，bodyPt，最多两行；不重复条目 |
| 强调线   | x 0.07，y 0.27（有引导段时 0.34），w 0.08，h 0.006；accent 色                 |
| 正文区   | y 0.34（有引导段时 0.40）–0.89，x 0.07–0.93；左侧 0.006 宽竖向强调线          |
| 行       | 行高 = min(0.13, 正文区高 / 条数)；每行底部 0.75pt 浅色分隔线                 |
| 序号     | x 0.09，w 0.08；字号 clamp(bodyPt+2, 18, 24)，accent 色，加粗                 |
| 条目文字 | x 0.19，w 0.72；字号 bodyPt（主题正文，通常 16–18），最多两行；垂直居中于行   |
| 节奏     | 行距 = max(0.012, 行高 − 文字高 − 0.02)；不得出现白卡或面板                   |

`consumed`: title = true；items = 实际绘制的条目数；body = true 当且仅当 `content.body` 为空、每个非空段落都能在条目文本中逐字找到、或作为引导段完整绘制；否则为 false 并拒绝；blockIds 为空。

#### asymmetric-split

适用：2–5 条较长要点，无结构化块、无引文、无图片，页面不是 cover/section/quote。

| 区域     | 规则                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 标题栏   | 左栏 x 0.07–0.36；标题 y 0.09，h 0.26，字号 titlePt，最多三行                       |
| 强调线   | 左栏标题下 y 0.38，w 0.12，h 0.006                                                  |
| 页码     | 左栏底部 y 0.82，字号 captionPt，显示 `01` 这类当前页序号                           |
| 分隔     | 可选竖向细线 x 0.39，y 0.09–0.9，0.75pt 浅色                                        |
| 正文栏   | x 0.44–0.93，y 0.11–0.89；按条数均分，条目间距 ≥0.05                                |
| 引导段   | 可选：`body` 中有、条目里没有的完整句子放右栏顶部，bodyPt，最多两行；条目区相应下移 |
| 条目     | 每条前 0.012 宽 accent 短竖线 + 文字；字号 bodyPt（主题正文），最多四行             |
| 视觉焦点 | `focal=title` 时标题加大 10%；`focal=body` 时正文加大 2pt；不能两者同时             |

`consumed` 同 `editorial-index`；标题/正文/条目的实际文本必须与已审核内容逐字一致。

### 5.6 配方合法性

`supports()` 的硬条件：

- 页面不是 `cover`、`section`、`quote`；
- 没有 `comparison`、`timeline`、`process`、`metric`、`table-data` 块；
- 没有请求视觉素材（P1 不处理图文配方）；
- `hasArtwork === false`（P1 模板页继续走旧分支）；
- `editorial-index`: `itemCount 3–6` 且 `shortItems`；加引导段后行高低于 0.075 时拒绝；
- `asymmetric-split`: `itemCount 2–5` 且最长条目 ≤ 48 字；加引导段后正文区仍能放下时接受。

不满足时返回 `conflict`，命令层回退旧分支，并在质量报告记录原因。**不允许为了用配方而删条目或压字号。**

`planDeckRecipes` 的规则：

1. 模型显式给出且合法的 recipe 保留；非法/未实现记录 `AI_DESIGN_RECIPE_INVALID` 后按内容事实补。
2. 没有 recipe 时按确定性映射补：3–6 条短要点 → `editorial-index`；2–5 条长要点 → `asymmetric-split`；其余不补。
3. 同一 recipe 连续出现第 3 页时，如果另一配方也合法，换成另一配方并记录调整；显式选择不因节奏被改写。
4. 节奏只能降低重复，不能改变页面内容或字号。

### 5.7 命令层分派

在 `apply-ai-designed-draft` 的元素构建分支最前面增加一次判断：

```ts
const recipe = resolveRecipe({
  requested: design.recipe,
  concept: command.designConcept,
  facts: compositionFacts,
  hasArtwork: keepsArtwork,
  hasAsset: Boolean(visualAsset),
});

if (recipe) {
  const plan = recipe.plan(buildRecipeContext(...));
  if ("elements" in plan) {
    slide.elements.push(...plan.elements);
    recipeConsumption.set(index, plan.consumed);
  } else {
    recipeConflicts.push({ slideIndex: index, ...plan.conflict });
  }
}

if (!recipePlanApplied) {
  // 原有 if/else 链保持不变
}
```

约束：

- 配方分支只追加内容元素；背景、模板背景图、装饰、局部 scrim 仍由现有前置逻辑处理。
- 页脚、页码、对比度修复、视觉修复后处理仍由现有代码统一执行。
- 配方分支内不得再添加页脚，避免双页码。
- `design.recipe` 不存在、概念不存在、模板有背景图、或内容含结构化块时，一律走旧分支。
- `consumed` 在命令末尾校验：`items` 必须等于实际渲染的条目数；条目文本集合必须等于 `items` 来源集合；否则抛 `AI_DESIGN_CONTENT_LOSS`，不写文档。

### 5.8 生成链路

```text
App.startDesign
  → briefsFromDraft（已有）
  → generateDeckConcepts(draft, briefs, template, { taskId })      [新增]
  → 选择 concept（P1 取第一个；失败降级 editorial）                 [新增]
  → resolveDeckConcept(concept, pageFacts, pageCount)              [新增]
  → generatePresentationDesign(draft, briefs, template, { concept }) [扩参]
  → apply-ai-designed-draft（带 designConcept + 每页 recipe）       [扩参]
  → runDesignQualityStage（已有）
```

Rust 新增：

```rust
#[tauri::command]
pub async fn generate_deck_concepts(
    request: GenerateConceptsRequest,
    cancels: State<'_, CancelRegistry>,
) -> Result<serde_json::Value, String>
```

输入：`draft`（已审核内容摘要）、`briefs`、`template`、`visualGoal`、`taskId`。输出：

```json
{
  "concepts": [
    {
      "preset": "editorial",
      "name": "编辑式年报",
      "idea": "用细线和大字号把结论排成编辑部版面，不用卡片。",
      "typeContrast": "strong",
      "imagery": "none",
      "rationale": "内容以判断和要点为主，没有可支撑的图片或数字。"
    }
  ]
}
```

提示词要求：

1. 只能从 `preset` 枚举中选；P1 只有 `editorial`。
2. `name`/`idea`/`rationale` 不得复述正文，只描述视觉策略。
3. 不得输出坐标、字号、颜色值、装饰或新内容。
4. 内容没有数字时不得声称会使用数据图表；没有图片时不得声称使用摄影。
5. 输出 1 个方向（P1）；P2 再改为 2–3 个方向并让用户选择。

逐页设计提示词新增“页面配方”一节：

- 可用配方只有 `editorial-index`、`asymmetric-split`；
- 3–6 条短要点优先 `editorial-index`；2–5 条较长要点优先 `asymmetric-split`；
- 结构化块、引文、封面/章节/总结页不选配方，继续用原 `layout`；
- 配方与 `layout` 不冲突；配方是 `layout` 内部的骨架；
- 输出可选 `recipe`、`variant`、`focal`，不得输出坐标。

TS 侧 zod：

```ts
const recipeSchema = z.enum(["editorial-index", "asymmetric-split"]);
const conceptSchema = z.object({
  preset: z.enum(["editorial"]),
  name: z.string().trim().min(1).max(20),
  idea: z.string().trim().min(1).max(80),
  typeContrast: z.enum(["calm", "strong", "dramatic"]),
  imagery: z.enum(["none", "hero", "band", "side", "texture"]),
  rationale: z.string().trim().min(1).max(120),
});
const deckConceptsSchema = z.object({ concepts: z.array(conceptSchema).min(1).max(3) });
```

`aiPresentationDesignSchema` 增加可选 `recipe`、`variant`、`focal`。校验失败返回稳定错误码，不把未知值传进核心层。

错误码约定：

| 错误码                         | 触发条件                                               |
| ------------------------------ | ------------------------------------------------------ |
| `AI_CONCEPT_REQUEST_INVALID`   | draft/briefs 为空、页数不一致、preset 枚举为空         |
| `AI_CONCEPT_REQUEST_TOO_LARGE` | 序列化请求超过 120KB                                   |
| `AI_CONCEPT_JSON_INVALID`      | 响应不是合法 JSON 或 zod 校验失败                      |
| `AI_CONCEPT_COUNT_INVALID`     | concepts 数量不在 1–3                                  |
| `AI_CONCEPT_RHYTHM_INVALID`    | 生成的节奏长度与页数不一致                             |
| `AI_DESIGN_RECIPE_INVALID`     | 模型返回未实现/不在概念允许集合内的 recipe；记录后回退 |
| `AI_DESIGN_CONTENT_LOSS`       | `consumed` 与实际内容不一致；拒绝写入文档              |

确定性 fallback：如果模型没有返回 recipe，按以下顺序补：

1. body 为空且 bullet items 3–6 且都短 → `editorial-index`；
2. bullet items 2–5 且最长 ≤48 → `asymmetric-split`；
3. 否则不补，走旧分支。

### 5.9 评审（P1 只保证不破坏）

P1 不新增评分维度，也不改修复提示词；配方页面仍接受旧的层级/对齐/可读性评审。修复动作只会在配方生成的元素上做 move/resize/restyle/align，不会重新跑 `apply-ai-designed-draft`，所以配方不会被撤销。

P2 再增加 `conceptFitScore`、`distinctivenessScore` 和 `changeRecipe`，避免 P1 同时改生成、渲染、评审三条链路导致无法定位回归。

### 5.10 持久化

P1 不把 `DeckConcept` 写入 `PresentationDocument`；它只存在于本次生成会话、质量报告和日志中。理由是：

- P1 的目标是验证“概念能改变画面”，不是让用户重新打开后继续编辑概念；
- 写入文档需要 schema 迁移、fixture 和恢复逻辑，会把一个渲染试验变成持久化改造。

P2 再决定放在文档 `design` 侧还是项目旁路；无论放哪，都不进入 `contentHash`，只递增 `designRevision`。

### 5.11 内容/设计隔离

- 配方只读 `SlideContent`，返回新元素；不写 `slide.content`。
- 设计命令前后比较 `hashSlideContent` 和 `content.version`，必须相同。
- `consumed` 校验是额外的丢字保护：少一条要点、少一个块 id 都拒绝出稿。
- 概念、配方、令牌只影响 design/document revision；撤销是一次设计事务。

## 6. 实施步骤

### Step 1：合同与令牌（0.5–1 人日）

1. 新增 `deck-concept.ts`，实现类型、`CONCEPT_PRESETS`、`resolveDeckConcept`、`planConceptRhythm`。
2. 新增 `design-tokens.ts`，实现 `deriveDesignTokens(theme, pageSize, concept)`。
3. 扩展 `AiSlideDesign` 的可选 `recipe/variant/focal`；不接渲染器。
4. 测试：合法/未知 preset、节奏长度、令牌随 page size 缩放、旧设计无字段。
5. 验收：`tsc` 通过；现有测试全过；无行为变化。

### Step 2：配方基础设施（1 人日）

1. 新增 `types.ts`、`registry.ts`、`plan.ts`、`measure.ts`。
2. `measure.ts` 复用 `estimateTextLines`，提供 `fittedSize`、`textHeight`、`rectsOverlap`。
3. `plan.ts` 实现 `selectRecipe`、`planDeckRecipes`、`validateConsumption`。
4. 测试：不支持的内容返回 conflict；节奏调整不改变显式选择；确定性。

### Step 3：两个配方（1.5–2 人日）

1. 实现 `editorial-index`：标题轴、可选引导段、编号行、细线、正文；不产生白卡/面板。
2. 实现 `asymmetric-split`：左标题栏、右正文栏、可选引导段、竖向细线、页码、焦点变体。
3. 所有坐标用 `frame()` 从归一化值转 EMU；字号用 `fittedSize`。
4. 测试：
   - 3–6 条 / 2–5 条各一组，元素全部在安全区内、互不重叠；
   - 条目文本逐字等于输入；
   - 4 条短要点没有整宽白色卡片；
   - 相同输入两次输出完全一致；
   - 超长文本回退 conflict，不压字号。
5. 人工渲染：用 13.33×7.5in 页面导出 PNG，检查标题轴和行距。

### Step 4：命令层接入（1 人日）

1. `apply-ai-designed-draft` 命令增加 `designConcept?: DeckConcept`。
2. 在旧分支前调用 `resolveRecipe`；成功则 `slide.elements.push(...plan.elements)`，失败走旧链。
3. 页脚、页码、对比度、视觉修复后处理保持不变；确认没有双页脚。
4. 在命令末尾校验 `consumed`，失败抛 `AI_DESIGN_CONTENT_LOSS`。
5. 测试：
   - 带 recipe 的 4 条短要点 → `editorial-index` 元素；
   - 带 recipe 的 5 条长要点 → `asymmetric-split`；
   - 无 recipe → 与 HEAD 旧输出等价；
   - 内容哈希、内容 revision、审核状态不变；
   - 设计 revision 增加一次；
   - 删除/改写条目时 `consumed` 拒绝。

### Step 5：概念生成与流水线（1.5 人日）

1. Rust 新增 `GenerateConceptsRequest`、`generate_deck_concepts`、提示词、取消和超时。
2. TS 新增 `generateDeckConcepts`，zod 校验；P1 要求至少 1 个、最多 3 个，客户端取第一个。
3. `generatePresentationDesign` 增加可选 `concept` 参数；请求体带 concept；zod 增加 recipe 字段。
4. App `startDesign` 插入概念阶段：进度 12% 生成方向、20% 选定方向、46% 逐页设计；失败降级 `editorial`，不阻断。
5. `designQualityReport` 增加 `concept`、`recipePlan`、`recipeConflicts`。
6. 测试：概念解析失败走默认；未知 recipe 回退旧分支；取消向上传播。

### Step 6：真实出稿验证（1 人日）

1. 用一份 10 页“销售汇报”测试内容（去掉真实业务数据或使用合成数据）跑完整链路。
2. 导出 PPTX，用 PowerPoint 打开并逐页渲染。
3. 检查：
   - 第 1/3/5/9/10 页为编辑式编号行，无白卡、无计数面板；
   - 第 2/4/6/8 页为非对称分栏；
   - 第 7 页流程仍正常；
   - 配方页面标题左轴、正文字号、页脚一致；
   - 图标/文字均为原生对象；
   - 内容无丢失、无改写。
4. 保存前后截图到任务记录，作为 P2 基线。

### Step 7：文档与收尾（0.5 人日）

1. 更新 ADR 0046 状态为“已接受（P1）”，补充实测结果和未覆盖。
2. 在本任务记录填写实际耗时、失败案例和回退次数。
3. 跑 `tsc`、`eslint`、`vitest run`、`npm run build`。
4. 确认没有把 P1 未实现的 preset/recipe 写进 zod 枚举。

## 7. 测试与验收

### 7.1 自动测试

| 文件                                               | 覆盖                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `src/core/design/deck-concept.test.ts`             | preset 解析、节奏、未知 preset、确定性                       |
| `src/core/design/design-tokens.test.ts`            | 主题字阶、typeContrast、页面尺寸缩放、默认值                 |
| `src/core/layout/recipes/editorial-index.test.ts`  | 3/4/6 条、引导段、安全区、无卡片、文本逐字、确定性、超长回退 |
| `src/core/layout/recipes/asymmetric-split.test.ts` | 2/5 条、标题/正文区、焦点变体、无重叠、确定性                |
| `src/core/layout/recipes/plan.test.ts`             | 合法性、连续配方限制、fallback                               |
| `src/core/commands/commands.test.ts`               | recipe 应用、旧分支等价、内容哈希/修订、`consumed` 拒绝      |
| `src/services/ai-service.test.ts`                  | 概念 schema、未知 recipe、fallback、concept 传递             |
| `src/features/pptx-export/export-pptx.test.ts`     | 配方页面导出、无图片 part、原生对象计数                      |

### 7.2 验收标准

- **AC-1**：同一份内容生成 1 个 `editorial` 概念，`resolveDeckConcept` 的 `recipes` 只含已实现配方。
- **AC-2**：10 页样例中 1/3/5/9/10 页走 `editorial-index`，2/4/6/8 页走 `asymmetric-split`，7 页走旧流程。
- **AC-3**：结构化块/引文/模板页请求配方时返回 conflict，最终仍能出稿。
- **AC-4**：配方页面标题 x=0.07、标题 y=0.09、正文基准字号一致；不再出现 14–20pt 随版式跳。第 7 页流程作为已知例外，P2 迁移。
- **AC-5**：设计前后 `hashSlideContent`、`content.version`、`status` 不变；撤销一次回到旧设计。
- **AC-6**：无 `recipe` 的旧设计元素几何与 HEAD 一致；视觉回归基线不更新。
- **AC-7**：导出的 PPTX 在 PowerPoint 打开；无 SVG/PNG 回退图片；文字和图标可编辑。
- **AC-8**：概念接口超时/返回非法时，使用默认 `editorial` 继续生成，报告写明降级。
- **AC-9**：同一输入连续生成两次，元素的 frame/text/style 序列化完全一致。
- **AC-10**：全部自动测试、类型检查、lint、生产构建通过。

### 7.3 人工验收

- 用 PowerPoint 逐页检查 10 页样例；
- 检查标题、正文、页脚、编号；
- 检查 PPTX 选择窗格：文字是文本框，图标是形状，不是整页图片；
- 检查取消生成：概念阶段和逐页阶段都能中断。

## 8. 风险与回退

| 风险                                     | 处理                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| 配方与现有后处理（页脚/对比度/修复）冲突 | 配方只追加内容元素；后处理保持原顺序；用 10 页样例逐页比较   |
| 文本溢出/重叠                            | 所有字号经 `fittedSize`；超限返回 conflict，回退旧分支       |
| 模板页被误套配方                         | `hasArtwork` 为 true 时 `supports` 直接 false；P1 不处理模板 |
| 模型输出未实现配方                       | zod 枚举只含已实现值；未知值回退确定性映射/旧分支            |
| 评审把新页面判低                         | P1 不新增评审维度；记录分数，P2 再调                         |
| 内容丢失                                 | `consumed` + 文本逐字断言 + 内容指纹                         |
| 旧设计回归                               | `recipe` 可选；无字段走旧分支；视觉回归基线不更新            |
| 概念调用增加延迟/成本                    | 一次额外小请求；可取消；失败降级，不阻断                     |

回退顺序：

1. 关闭 `designConcept` / `recipe` 字段，回到旧分支；
2. 保留概念和配方代码，但从 App 流水线移除概念调用；
3. 删除新文件，不影响旧文档。

## 9. P2/P3 预留

- **P2a**：`cover-statement`、`data-story`、`image-led` 配方；设计方向选择器（3 个概念 + 真实缩略图）。
- **P2b**：`conceptFitScore`、`distinctivenessScore`、`generic-layout`、`changeRecipe`；评审锚点“等权卡片阵列 ≤69”。
- **P2c**：模板页配方适配（安全区、背景图、Logo 避让）。
- **P3**：概念持久化、重新设计、跨项目复用；概念与用户手动编辑的冲突策略。

## 10. 开放问题

1. `editorial-index` 的编号列是否允许“01–04”大写数字，还是必须用内容里的真实数字？P1 用序号，不冒充数据。
2. 2 条要点的 `asymmetric-split` 右栏会显得空；P2 是否允许右栏放一张已审核的视觉素材？P1 先不允许。
3. 10 页样例的第 3/10 页有 5/4 条要点，`editorial-index` 行高会偏紧；P1 允许最小 0.075 行高，低于则回退旧分支。
4. 概念 `name/idea` 是否允许用户改写后重新生成？P2 设计方向选择器再定。

## 附录 A：10 页样例映射

| 页码 | 内容形态     | 目标配方           | 备注                      |
| ---- | ------------ | ------------------ | ------------------------- |
| 1    | 4 条短要点   | `editorial-index`  | 替换 2×2 白卡             |
| 2    | 4 条较长要点 | `asymmetric-split` | 替换左右等宽面板          |
| 3    | 5 条短要点   | `editorial-index`  | 去掉“05 项要点”计数面板   |
| 4    | 5 条较长要点 | `asymmetric-split` | 左标题栏 + 右正文栏       |
| 5    | 4 条短要点   | `editorial-index`  | 替换 2×2 白卡             |
| 6    | 4 条较长要点 | `asymmetric-split` | 右栏留白，允许，不补装饰  |
| 7    | 4 步流程     | 旧分支             | P2 用 `process-rail` 迁移 |
| 8    | 4 条较长要点 | `asymmetric-split` | 风险/阻力页               |
| 9    | 4 条短要点   | `editorial-index`  | 行动计划页                |
| 10   | 4 条短要点   | `editorial-index`  | 结尾页，去掉计数面板      |

这张表是 P1 的人工验收基准，不是硬编码映射；内容事实改变时配方应随之变化。

## 实施记录（P1）

已落地文件：

- `src/core/design/deck-concept.ts`、`design-tokens.ts` 及测试。
- `src/core/layout/recipes/{types,measure,elements,content,editorial-index,asymmetric-split,registry,plan}.ts` 及测试。
- `src/core/commands/template-layouts.ts` 的可选 `recipe/variant/focal`。
- `src/core/commands/commands.ts` 的概念分派、模板页回退和 `AI_DESIGN_CONTENT_LOSS` 守卫。
- `src/services/ai-service.ts` 的概念 schema、`generateDeckConcepts`、页面事实派生和 design 请求的 concept。
- `src-tauri/src/commands/ai.rs` 的 `generate_deck_concepts` 与设计提示词配方段。
- `src/app/App.tsx` 的概念阶段、失败降级、质量报告概念行和命令参数。

实测：

- 4 条短要点的编辑式页已用 PowerPoint 渲染：编号栏、细线、无白卡，标题/条目为原生文本框。
- 5 条较长要点的非对称分栏页已渲染：左标题栏、右正文栏、无卡片。
- 全量 `vitest run` 865 项通过；`tsc --noEmit`、`npm run build` 通过。

实现时的两处合同细化：

- `resolveDeckConcept` 返回 `{ concept, conflicts }`，冲突进入报告；调用方取 `.concept`。
- `DesignTokens` 增加 `fonts.heading/body`，配方不直接读主题字体。
- `asymmetric-split` 支持 2–5 条（样张第 2/4/6/8 页实际有 4/5/4/4 条）。

未完成：真实 AI 接口的 10 页端到端复核、设计方向选择器、其余配方、评审新评分与 `changeRecipe`、概念持久化。
