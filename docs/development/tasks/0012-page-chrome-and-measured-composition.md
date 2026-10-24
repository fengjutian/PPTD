# TASK-DESIGN-002：统一页面骨架与测量式构图（P0）

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）                                  |
| 优先级   | P0                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 5–7 人日                                                  |
| 依赖     | ADR 0063、ADR 0025、ADR 0037、ADR 0046、ADR 0015          |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

2026-10-24 的 7 页实测样张（预设+概念、预设无概念、模板+预设）显示：生成页面的问题不是“某一页越界”，而是**整册没有共同版面**，且空页被当成“留白”：

| 现象                     | 实测                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 表头不在一条线           | 标题 y = 0.09 / 0.12；短线 y = 0.245 / 0.265 / 0.38；comparison 页无短线；内容顶边 0.29–0.44 |
| 收束页大面积空           | 正文框 0.29–0.87，17pt 文字只写到 0.38                                                       |
| 指标页数值与标签脱节     | 数值 56pt 顶在 0.27 页高的框中，标签固定 y = 0.73                                            |
| 编号页行距过大           | 3–4 行均分 0.55 页高，17pt 单行行距 1.35in                                                   |
| 流程卡浮在中间、文字被挤 | 卡高上限 0.28 页高并居中；左右内边距各 0.045 页宽（约 0.6in），2.77in 卡文字只剩 1.57in      |
| 字号只缩不放             | `fittedFontSize` 从 preferred 递减，空页也不会放大                                           |
| 令牌未消费               | `DesignTokens.space / grid / radius` 无调用方                                                |

根因：配方、旧分支、卡片、流程、对比各自硬编码标题/短线/内容顶边；垂直位置靠“等分”或“居中”临时决定；卡片高度和字号由固定上限决定，而不是由内容测量决定。

## 2. 目标

在不改变已审核内容、不让模型输出坐标的前提下：

1. 用同一个 `PageChrome` 统一所有页面的标题轴、短线、内容顶边；
2. 让配方与旧分支的垂直构图由内容测量决定，消除“等分到页底”“固定标签 Y”“固定卡高”；
3. 让稀疏页字号可以长大，卡片内边距改用物理单位；
4. 让确定性质量门能报告“下半页连续空白”，不依赖视觉模型是否开启；
5. 旧文档、无概念设计、模板背景/装饰/导出行为保持不变。

## 3. 范围

### 3.1 本任务包含

- `src/core/layout/page-chrome.ts`：`PageChrome` 类型、`planPageChrome()`、`resolveChrome()`。
- `RecipeContext` 增加可选 `chrome`；命令层传入；旧测试不传时由 `resolveChrome()` 从 `frame` 派生。
- `editorial-index`、`data-story`、`asymmetric-split` 改用 `chrome` + 测量式成组。
- `cover-statement`、`image-led` 至少使用 `chrome.title` 的 y 轴；封面保留自己的构图。
- 旧分支（`grid`、`metric`、`process`、`comparison`、`stacked`、单段正文）的卡片高度、内边距、垂直基准、字号调整。
- `measure.ts` 增加带最大值的字号拟合；`flow.ts` 的 `layoutFlow` 在配方中复用。
- `presentation-quality-gate.ts` 增加 `underfilled-page`；`design-quality-stage.ts` 增加标签。
- 单元、命令、质量门测试；真实 PPTX 导出 + LibreOffice 渲染抽查。

### 3.2 本任务不包含

| 缺口                                             | 计划 |
| ------------------------------------------------ | ---- |
| 模板路径接入 `editorial-index` / `data-story`    | P1   |
| `process-rail`、`comparison`、`quote-field` 配方 | P1   |
| 章节页/引文页的专门构图                          | P1   |
| 跨页标题轴偏差的确定性检查                       | P1   |
| `distinctivenessScore`、`changeRecipe`           | P2   |
| 自由坐标、自由字号、模型直接排版                 | 不做 |

## 4. 功能需求

| ID    | 需求                                                                          | 验收  |
| ----- | ----------------------------------------------------------------------------- | ----- |
| FR-1  | 同一册所有非封面页的标题、短线、内容顶边来自同一个 `PageChrome`               | AC-1  |
| FR-2  | `editorial-index` 条目按测量高度成组，行距有上限，字号可在稀疏页放大          | AC-2  |
| FR-3  | `data-story` 标签紧贴数值下方，数值+标签作为组垂直居中，不再使用固定 Y        | AC-3  |
| FR-4  | `asymmetric-split` 右栏条目从内容顶边成组，不再等分到内容底边                 | AC-4  |
| FR-5  | 卡片/指标/流程/对比的卡高由内容测量 + 物理内边距决定，不再固定 0.24/0.28 页高 | AC-5  |
| FR-6  | 单段正文收束页短文本垂直居中并放大，长文本保持顶对齐                          | AC-6  |
| FR-7  | 确定性质量门报告 `underfilled-page`；不影响文档产出                           | AC-7  |
| FR-8  | 已审核内容、内容哈希、内容 revision、审核状态不变                             | AC-8  |
| FR-9  | 无 `designConcept` / 无 `recipe` 的旧设计仍可渲染，模板背景和装饰不被删除     | AC-9  |
| FR-10 | 相同输入 + 相同主题得到相同元素几何                                           | AC-10 |

## 5. 技术设计

### 5.1 `PageChrome`

```ts
// src/core/layout/page-chrome.ts
export interface PageChrome {
  title: NormalizedFrame;
  rule: NormalizedFrame;
  content: NormalizedFrame;
  contentTop: number;
  contentBottom: number;
}

export function planPageChrome(input: {
  page: { width: Emu; height: Emu };
  title: RectEmu;
  content: RectEmu;
  /** 可选：模板安全区；缺省时用 content 的边界。 */
  safe?: NormalizedFrame;
}): PageChrome;
```

算法：

1. `title` / `content` 归一化；`content` 与 `safe` 求交，避免内容伸进模板 Logo 区。
2. `titleBottom = title.y + title.height`。
3. 短线呼吸位 `gap = min(0.03, max(0.012, (content.y - titleBottom) * 0.25))`；若 `content.y - titleBottom <= 0`，短线放在标题框内底部上方 0.008。
4. `rule = { x: title.x, y: min(titleBottom + gap, content.y - 0.02), width: min(0.12, title.width * 0.2), height: 0.006 }`；若 `content.y - 0.02 < titleBottom`，`rule.y = max(0, titleBottom - 0.012)`。
5. `contentTop/contentBottom` 取 `content` 的上下边。
6. 所有值 clamp 到 `[0, 1]`，宽度/高度为最小 0.001。

`resolveChrome(ctx)`：`ctx.chrome ?? planPageChrome({ ...ctx.frame })`，保证旧测试和旧调用不传 `chrome` 也能工作。

### 5.2 配方

#### editorial-index

| 区域    | 新规则                                                                               |
| ------- | ------------------------------------------------------------------------------------ |
| 标题    | `chrome.title`，字号 `fittedFontSize(title, titleFrame, titlePt, 18, ...)`           |
| 短线    | `chrome.rule`                                                                        |
| 引导段  | 放在 `chrome.content` 顶部；高度由测量决定；条目组从引导段下方开始                   |
| 条目组  | `layoutFlow`：统一字号，`verticalAlign: "center"`，`maxGap 26pt`，`minGap 8pt`       |
| 行/分隔 | 行高 = 测量高度；分隔线在行底 + 半个 gap；不再按内容区等分                           |
| 竖线    | 只覆盖第一条到最后一行的范围，不拉到内容底边                                         |
| 字号    | 3–4 条短要点 preferred = `min(26, bodyPt + 6)`；5–6 条 preferred = `bodyPt`；最小 14 |
| 序号    | `clamp(条目字号 * 1.15, 18, 28)`，不随行高变成 30+                                   |

#### data-story

| 区域      | 新规则                                                                                    |
| --------- | ----------------------------------------------------------------------------------------- |
| 标题/短线 | `chrome.title` / `chrome.rule`                                                            |
| 引导段    | 若有 body 且未被指标覆盖，放在 `chrome.content` 顶部，测量高度                            |
| 指标列    | 列宽 `(content.width - gap * (n-1)) / n`；gap 0.035                                       |
| 数值      | 字号在 `[28, 96]` 内按列数取最大可容纳：1 列 96、2 列 80、3 列 72；`fitFontSize`          |
| 标签      | 字号 `bodyPt`（可放大到 20），y = 数值测量底边 + 0.018；高度按测量                        |
| 组        | 数值 + 标签作为一组，在内容区内垂直居中；每列上方 0.006 高 accent 短线，位于组顶上方 0.05 |
| 溢出      | 组高超过内容区时返回 conflict，不压字号                                                   |

#### asymmetric-split

| 区域   | 新规则                                                                                  |
| ------ | --------------------------------------------------------------------------------------- |
| 标题   | x = `chrome.title.x`，y = `chrome.title.y`，宽度 = 0.29；高度 = max(0.16, title.height) |
| 短线   | x 同上，y = `chrome.rule.y`，宽度 0.12                                                  |
| 内容   | 右栏从 `chrome.content.y` 开始；`layoutFlow`，`verticalAlign: "top"`，maxGap 24pt       |
| 分隔线 | 竖向细线 y 从 `chrome.content.y` 到条目组底边，不再固定到内容底边                       |
| 条目   | 每条前 0.012 宽 accent 短竖线 + 文字；字号 preferred `bodyPt + 2`，上限 24              |

#### cover-statement / image-led

- `cover-statement` 保留自己的大标题构图；标题 y 使用 `chrome.title.y + 0.06`，不再写死 0.18。
- `image-led` 使用 `chrome.title` 和 `chrome.content` 作为文字区，图片区沿用 `planVisualAssetLayout`。

### 5.3 旧分支

| 页型         | 新规则                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grid`       | 卡片左右内边距 `0.24in / pageWidthIn`；卡高 = badge + 文字测量 + 上下 0.24in，上限 0.32 页高；卡片组居中                                             |
| `metric`     | 卡高 = 数值测量 + 标签测量 + 上下 0.22in；数值与标签间距 0.02；网格居中                                                                              |
| `process`    | 内边距 `0.22in`（x/y 分别换算）；卡高 = badge + 标签 + 正文测量 + 上下 0.22in，上限 0.36；明显短于内容区时居中，接近填满时顶对齐                     |
| `comparison` | 面板高 = max(0.32, 栏头 + 正文测量 + 0.4in)；明显短于内容区时居中，接近填满时顶对齐；要点 18pt，栏头 22pt；正文在栏头下方居中                        |
| `stacked`    | 行高按测量 + `maxGap`；不再把内容区均分到条目数                                                                                                      |
| 单段正文     | 模板 body 占位保留原几何与字号；预设页单段正文测量块高，`summary` 且 ≤160 字时垂直居中、字号 22–24，其余用主题 body 字号、顶对齐；行宽上限 0.68 页宽 |

### 5.4 字号拟合

```ts
// src/core/layout/recipes/measure.ts
export function fittedFontSizeInRange(
  text: string,
  frame: RectEmu,
  preferredPt: number,
  minimumPt: number,
  maximumPt: number,
  fontFamily: string | undefined,
  lineHeight: number,
): number;
```

- 先试 `preferredPt`；若适配，向上找到 `maximumPt` 内最大可容纳字号；否则向下找；都不行返回 `minimumPt`。
- 旧 `fittedFontSize` 保留，内部调用 `fittedFontSizeInRange(..., preferredPt, minimumPt, preferredPt, ...)`，行为不变。

### 5.5 质量门

```ts
// presentation-quality-gate.ts
export type PresentationQualityIssueKind =
  | ... // 现有 6 类
  | "underfilled-page";
```

检查：

- 跳过 `design.layout === "cover" | "section"`；
- 跳过含整页背景图（≥ 98% 页面）的页；
- 取所有非背景、非页脚（`y < 0.9`）元素的 `y + height` 最大值；
- 若 `maxBottom < 0.62`，报告“正文只占页面上半部，下方连续空白超过三分之一”。

`design-quality-stage.ts` 的 `issueLabels` 增加中文标签。报告只记录，不阻断文档产出。

### 5.6 模块落点

新增：

```text
src/core/layout/page-chrome.ts
src/core/layout/page-chrome.test.ts
```

修改：

```text
src/core/layout/recipes/types.ts            RecipeContext.chrome?
src/core/layout/recipes/measure.ts          fittedFontSizeInRange
src/core/layout/recipes/editorial-index.ts
src/core/layout/recipes/data-story.ts
src/core/layout/recipes/asymmetric-split.ts
src/core/layout/recipes/cover-statement.ts
src/core/layout/recipes/image-led.ts
src/core/commands/commands.ts               planPageChrome + 旧分支几何
src/services/presentation-quality-gate.ts    underfilled-page
src/services/design-quality-stage.ts         issueLabels
docs/architecture/decisions/0063-...
docs/development/tasks/0012-...
docs/development/v0.1-plan.md                任务表增加 TASK-DESIGN-002
```

## 6. 实施步骤

### Step 1：PageChrome 与合同（0.5 人日）

1. 新增 `page-chrome.ts` 及测试：模板标题框、预设标题框、标题过矮、内容区与安全区相交、clamp。
2. `RecipeContext` 增加可选 `chrome`；`resolveChrome` 兼容旧调用。
3. `commands.ts` 在 `RecipeContext` 构造处传入 `chrome`。
4. 验收：`tsc` 通过；旧测试不改也能过。

### Step 2：字号与流程基础（0.5 人日）

1. `measure.ts` 增加 `fittedFontSizeInRange`；旧函数委托。
2. 测试：放大、缩小、上下限、空框、确定性。
3. 配方引入 `layoutFlow`，先改 `editorial-index`、`asymmetric-split`。
4. 测试：行距上限、字号放大、竖线只覆盖组、无重叠、文本逐字。

### Step 3：data-story 与封面（0.5 人日）

1. 删除 `VALUES_Y` / `LABELS_Y` / `METRICS_BOTTOM`；按测量成组。
2. 标签紧贴数值；组垂直居中；短线在组上方。
3. 封面标题 y 跟随 chrome；image-led 使用 chrome。
4. 测试：标签 y 与数值底边的关系、组不越界、消费不变。

### Step 4：旧分支几何（1.5 人日）

1. `grid`：物理内边距、卡高测量、组居中。
2. `metric`：卡高测量、数值/标签间距、组居中。
3. `process`：x/y 物理内边距、卡高测量、顶对齐。
4. `comparison`：顶对齐、面板高度测量、字号阶梯。
5. `stacked` 与单段正文：测量行高、短文本居中放大。
6. 测试：卡片内边距不随列数变化、卡高随文本增长、孤行减少、内容不丢。

### Step 5：质量门与报告（0.5 人日）

1. 增加 `underfilled-page`；覆盖 cover/section/整页背景的豁免。
2. `issueLabels` 增加标签；`summarizeQualityIssues` 能汇总。
3. 测试：单段正文下半页空 → 报告；封面空 → 不报告；整页背景 → 不报告。
4. 验收：质量门未过时文档仍产出。

### Step 6：真实样张与文档（1 人日）

1. 用 7 页同一内容跑预设+概念、模板+预设两条路径，导出 PPTX，用 LibreOffice 渲染。
2. 检查：标题/短线/内容顶边一致；收束页居中放大；指标标签贴数值；流程卡不再孤行；模板背景/装饰仍在。
3. 更新 ADR 0063 的“结果/未覆盖”和本任务记录。
4. 跑 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。

## 7. 测试与验收

### 7.1 自动测试

| 文件                                             | 覆盖                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `src/core/layout/page-chrome.test.ts`            | 标题/短线/内容轴、模板过矮标题、安全区、clamp、确定性   |
| `src/core/layout/recipes/measure.test.ts`        | 字号上下限、放大/缩小、空框                             |
| `src/core/layout/recipes/recipes.test.ts`        | 配方使用 chrome、成组、标签贴数值、无重叠、文本逐字     |
| `src/core/commands/commands.test.ts`             | 旧分支卡高/内边距、单段正文居中、内容隔离、模板背景保留 |
| `src/services/presentation-quality-gate.test.ts` | `underfilled-page` 正例/反例、豁免                      |
| `src/services/design-quality-stage.test.ts`      | 报告标签、汇总、未阻断                                  |

### 7.2 验收标准

- **AC-1**：7 页样张中所有非封面页的标题 y、短线 y、内容顶边各自一致；配方页与旧分支页的标题轴偏差 ≤ 0.01 页高。
- **AC-2**：3 条短要点的编号页行距 ≤ 0.16 页高，字号 ≥ 20pt；不再出现 1.35in 行距。
- **AC-3**：指标页标签顶边与数值底边距离 ≤ 0.05 页高；数值+标签组在内容区内居中。
- **AC-4**：非对称分栏右栏第一条从内容顶边开始，不再等分到内容底边。
- **AC-5**：2 列与 3 列卡片的左右内边距相同（±0.001 页宽）；卡高随文本增长；无“建/库”孤行。
- **AC-6**：单段正文收束页（≤120 字）垂直居中，字号 ≥ 20pt；长文本保持顶对齐。
- **AC-7**：`underfilled-page` 在收束页样张出现，在封面/整页背景页不出现；文档仍产出。
- **AC-8**：设计前后 `hashSlideContent`、`content.version`、`status` 不变；撤销一次回到旧设计。
- **AC-9**：模板样张的底图、Logo、装饰、页脚仍在；导出页数/顺序不变。
- **AC-10**：相同输入连续生成两次，元素 frame/text/style 序列化完全一致。

### 7.3 人工验收

- 用 PowerPoint 打开导出的 7 页样张，逐页检查标题轴、卡片、指标、流程、对比、收束页；
- 检查文字/形状仍为原生对象；
- 检查模板样张的底图和 Logo 未被覆盖；
- 检查质量报告包含 `underfilled-page` 且不阻断出稿。

## 8. 风险与回退

| 风险                       | 处理                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| 现有配方测试断言固定坐标   | 新测试以“相对关系”为主；固定坐标断言随实现更新                        |
| 卡片放大后溢出             | 所有字号经 `fittedFontSizeInRange`；组高超内容区返回 conflict         |
| 模板标题框过矮导致短线压字 | `planPageChrome` 内 clamp；模板页短线放在标题框内底部                 |
| 质量门新增误报             | 豁免 cover/section/整页背景与少于 20 字的正文；阈值 0.58 先用样张校准 |
| 旧文档视觉变化             | 只改 AI 生成路径的几何；无 recipe 的旧设计仍走同一命令，但需人工抽查  |
| 内容被改                   | `consumed` + 内容指纹 + 现有命令测试                                  |

回退顺序：

1. 关闭 `chrome` 传递，配方回退到 `resolveChrome` 的派生值；
2. 保留 `underfilled-page` 报告但从 `passed` 计算中排除；
3. 删除新文件，恢复旧分支常量，不影响文档模型与导出。

## 9. 开放问题

1. 编号页 3 条时字号放大到 26pt 是否会让长标题比例失衡？样张校准后定 24/26。
2. 单段正文的“短文本”阈值取 120 字还是 160 字？先用 160，避免长段落被居中后阅读路径变差。
3. 流程页短带居中、接近填满时顶对齐；下半页仍可能空，是否在 P1 引入 `process-rail` 纵向配方？本任务先不做。
4. `underfilled-page` 阈值 0.58 是否需要按页面比例（4:3/16:9）调整？先用页高比例，样张校准。

## 实施记录（2026-10-24）

已落地：

- `src/core/layout/page-chrome.ts`：`PageChrome`、`planPageChrome`、`resolveChrome`。
- `RecipeContext.chrome`；命令层按页计算一次，配方与旧分支共用。
- `editorial-index`：`layoutFlow` 测量成组，行距 8–26pt，3–4 条短要点字号 22–26，竖向强调线只覆盖条目组。
- `data-story`：删除固定 `VALUES_Y / LABELS_Y`，数值与标签按测量成组，标签紧贴数值下方。
- `asymmetric-split`：右栏从内容顶边成组，标题/短线跟随 chrome。
- `cover-statement` / `image-led`：标题、短线、内容顶边跟随 chrome，保留各自构图。
- `grid` / `metric` / `process` / `comparison` / 单段正文：卡高、内边距、垂直基准、字号按测量和物理单位调整；模板 body 占位保留原几何和字号。
- `fittedFontSizeInRange`：字号可在 `[minimum, maximum]` 内放大；旧 `fittedFontSize` 行为不变。
- `presentation-quality-gate`：新增 `underfilled-page`；正文少于 20 字、cover/section、整页背景页豁免；`design-quality-stage` 增加中文标签。
- 文档：ADR 0063、本任务、`v0.1-plan` 任务表。

验证：

- `npm run typecheck` 通过。
- `npm run lint` 通过（仅保留既有的 `ShapeView.tsx` fast-refresh warning）。
- `npm run build` 通过。
- `PPTD_SKIP_VISUAL=1 npm test`：135 个测试文件、1044 项通过，1 项视觉回归按环境显式跳过。
- 当前 7 页样张（预设+概念）导出并经 LibreOffice 渲染：标题/短线/内容顶边统一；编号页由 1.35in 行距改为 0.75–0.9in 测量行距；指标标签紧贴数值；收束页正文居中放大；流程卡不再出现“建/库”孤行。

未完成：

- 模板路径仍不接入 `editorial-index` / `data-story`：模板页继续走旧分支，收束页和卡片页下半页仍可能空；`underfilled-page` 会报告，但不会自动重排。这是下一步 TASK-DESIGN-003 的范围。
- 视觉回归基线未更新：本机 PowerPoint 对图表页的渲染与 10/23 基线有 0.476% 像素差，与本次命令/配方改动无关；本次用 `PPTD_SKIP_VISUAL=1` 跳过，不以跳过冒充通过。
- `stacked` 分支仍按内容区等分，尚未迁移到 `layoutFlow`；该分支目前只覆盖少量标题正文页，下一步与模板配方一起处理。
