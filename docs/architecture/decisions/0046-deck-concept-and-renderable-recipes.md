# 0046 整册设计概念与可渲染页面配方

## 状态

提议（2026-10-23）。本决策只定义方向与边界，具体实施见 `docs/development/tasks/0003-deck-concept-and-recipes.md`。

## 背景

ADR 0021 把 AI 的设计输出从“版式 + 四个颜色”扩展到 `composition`、`emphasis`、`densityTarget`、`palette`；ADR 0038 又增加了 `visualNarrative` 和整册明暗节奏。但实际生成的页面仍然反复落回四种骨架：2×2 白卡、左右等宽面板、编号栏加计数面板、流程条。

问题不在模型没有想法，而在系统没有承接想法的地方：

- `AiSlideDesign` 能表达的仍然只是“这页属于哪类容器”。模型写“标题主导”，渲染器只在文本恰好等于 `content.body` 时缩放字号；卡片页和两栏页没有这个元素，意图大半空转。
- 渲染器没有“编辑式细线”“大数字 + 图表”“满版图文”“非对称分栏”这些真正的页面构图；再多的提示词也只能在四种骨架里换颜色。
- 视觉评审的指标是层级、对齐、可读性、一致性；修复动作只能在已有版式内移动、缩放、改色。一张等权卡片阵列只要对齐，就能拿到不低的分数，评审无法要求“换一个设计想法”。
- 设计概念是整册级的。逐页让模型自由发挥，只会得到十种互不相干的风格。

因此需要把“设计想法”拆成 **概念（整册）→ 配方（单页）→ 令牌（系统）** 三层，并保证每一层都有确定的渲染落点。

## 决策

### 1. 概念层：整册一个方向

新增 `DeckConcept`，由模型选择一个**概念预设**，而不是自由组合所有字段：

```ts
export type ConceptPresetId = "editorial" | "instrument" | "documentary" | "signal" | "paper" | "blocks";

export interface AiDeckConcept {
  preset: ConceptPresetId;
  name: string; // 界面展示名，例如“编辑式年报”
  idea: string; // 一句话说明，只展示，不参与渲染
  typeContrast: "calm" | "strong" | "dramatic";
  imagery: "none" | "hero" | "band" | "side" | "texture";
}
```

模型只输出这五个字段。`motif`、`recipes`、`surface`、`rhythm` 由 `resolveDeckConcept()` 从预设目录和页面事实展开：

```ts
export interface DeckConcept extends AiDeckConcept {
  id: string;
  motif: "rules" | "blocks" | "instrument" | "documentary" | "signal" | "paper";
  recipes: readonly RecipeId[];
  rhythm: readonly PageBeat[];
  surface: "flat" | "rules" | "panels" | "full-bleed";
}
```

理由：如果让模型同时输出母题、表面策略、配方集合，它很容易给出“细线母题 + 满版摄影 + 卡片面板”这类没有渲染实现的组合。预设目录把“哪些组合真的画得出来”固化在代码里；模型负责选择和解释，不负责发明不存在的渲染能力。

P1 只开放 `editorial` 一个预设，首批配方为 `editorial-index` 与 `asymmetric-split`。其余预设随配方逐步开放；**没有实现的预设不得出现在枚举里**。

### 2. 配方层：单页如何执行

新增 `LayoutRecipe`。模型只选配方、变体和视觉焦点，坐标由配方计算：

```ts
export interface RecipeContext {
  content: SlideContent;
  facts: CompositionFacts;
  concept: DeckConcept;
  tokens: DesignTokens;
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
  consumed: { title: boolean; body: boolean; items: number; blockIds: readonly string[] };
  conflicts: IntentConflict[];
}

export interface LayoutRecipe {
  id: RecipeId;
  supports(facts: CompositionFacts, concept: DeckConcept): boolean;
  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict };
}
```

配方是纯函数：只读内容和令牌，返回元素；不修改内容，不读写文件，不依赖 React/Tauri。首批配方：

- `editorial-index`：标题 + 编号 + 细线 + 大字号，没有白卡；适合 3–6 条短要点。
- `asymmetric-split`：约 1/3 标题栏 + 2/3 正文栏，替代左右等宽面板；适合 2–4 条较长要点。

后续配方：`cover-statement`、`data-story`、`image-led`、`process-rail`、`comparison`、`quote-field`。

### 3. 令牌层：让十页像一套系统

新增 `DesignTokens`，从 `DocumentTheme`、页面尺寸和概念派生，不由模型输出具体点数：

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

`typeContrast` 只改变字号比例；具体点数仍受主题和框高约束。标题轴、正文字号、页脚位置由令牌统一，避免当前同一册里 14/16/17/18/20pt 随版式跳动。

### 4. 生成链路

在内容审核之后、逐页设计之前增加“设计方向”阶段：

```text
已审核内容 + SlideBrief
  → generate_deck_concepts（1–3 个 AiDeckConcept；P1 只生成 1 个）
  → 用户选择 / 自动选择
  → resolveDeckConcept（预设 → recipe 集合、母题、节奏）
  → generate_presentation_design（每页 recipe / variant / focal / palette）
  → 配方规划（合法性、节奏、模板安全区）
  → SlideElement[]
  → 质量门 + 视觉评审
```

- 概念是整册一个，不是每页一个。
- 用户输入的“更编辑”“更有数据感”先解释成 `preset / typeContrast / imagery`，解释不了就明确说当前只支持哪几类，不把自由文本直接塞进渲染。
- 概念阶段做内容可行性检查：需要 `data-story` 但没有数字，返回补充指标/表格的内容请求，不画假图表。

### 5. 评审闭环

评审必须能评价和执行“想法”，否则修复循环仍会把页面修回四张白卡：

- 新增 `conceptFitScore`、`distinctivenessScore`；
- 新增 `generic-layout`、`concept-drift`、`weak-focal-point`；
- 等权卡片阵列、没有第一视觉入口的页面，`distinctiveness` 不得高于 69；
- 修复动作增加 `changeRecipe`、`setVariant`、`setFocal`、`setSurface`，并且只能换成内容装得下、概念允许的配方。

## 边界

- 模型不输出坐标、字号、装饰；这些由配方和令牌决定。
- 内容不可变：配方只读内容；`consumed` 校验不丢字；内容哈希和审核状态不变。
- 同一输入 + 同一概念必须得到同一几何；概念选择才是有意的变化点。
- 模板优先：模板已有背景、字体、色板、安全区时，配方必须适配；冲突就拒绝并回退，不覆盖模板。
- 任意“数据河流/星空叙事”等隐喻，如果没有对应配方实现，不支持；不能用提示词假装支持。
- 设计概念属于设计侧；P1 不写入文档，P2 持久化时递增 `designRevision`，不碰 `contentHash`。

## 备选方案

- **只加 `designIdea: string`**：模型会写，渲染器不认，等于第二个 `emphasis`。否决。
- **让模型直接输出坐标和字号**：违反 ADR 0003 和 AGENTS §4.2，产出不可编辑、不可校验。否决。
- **每页独立生成概念**：整册会分裂成十种风格，且无法做节奏。否决。
- **继续扩 prompt 枚举**：没有新渲染分支时，只是换词不换画面。否决。

## 结果

- 设计想法第一次有可验证的落点：概念 → 配方 → 元素。
- 新增页面不再需要往 `commands.ts` 的巨型分支里继续堆特例；配方可独立测试。
- 旧文档和未携带 `recipe` 的设计仍走原分支，视觉回归不变。
- 评审从“修整齐”升级为“可要求换配方”，但内容指纹仍被冻结。

## 未覆盖

- 完整配方库和任意隐喻；首批只覆盖预设主题的编辑式页面。
- 概念选择器的视觉预览与人工评分；P1 只自动选择。
- 概念持久化、重新设计和跨项目复用。
- 模板版式内的配方适配；P1 只保证无模板/预设主题的页面，模板页继续走旧分支。
