# TASK-DESIGN-003：模板页接入页面配方

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）                                  |
| 优先级   | P0                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 2–3 人日                                                  |
| 依赖     | ADR 0064、ADR 0063、ADR 0046、ADR 0015                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

ADR 0063 统一了页面骨架和测量式构图，但模板路径仍然被配方排除：

```ts
if (!concept || keepsArtwork || hasTemplate) return undefined;
```

结果：

- 模板页 3–4 条短要点继续画成白卡，内容停在页面上半部；
- 指标页继续把大数字和标签分开；
- 预设页已经使用编号栏/大数字，模板页还是卡片，同一册有两套视觉语言。

配方只追加内容元素，背景图、Logo、装饰和页脚仍由现有逻辑处理，因此可以在模板占位内安全运行；需要解决的问题是“模板已有表头时不要重复画线”和“底图较暗时强调色要可读”。

## 2. 目标

在保留模板底图、Logo、装饰、墨色和版式引用的前提下，让模板内容页使用 `editorial-index`、`data-story`、`asymmetric-split`；配方不适用时继续回退旧分支；内容、内容哈希、审核状态和页序不变。

## 3. 范围

### 3.1 包含

- `PageChrome.showRule`；模板页关闭配方的强调短线。
- 三个内容配方允许 `hasArtwork`（模板底图）。
- `chooseRecipeId` 不再因为 `hasArtwork` 直接放弃自动配方。
- 命令层配方闸门只保留“没有概念”和“配方不合法”。
- 模板页强调色/分隔线按底图亮度回退；未采样底图时不按白页翻转墨色。
- 模板页保留占位 `textColor`；preset 只接管字号/字阶。
- 模板 `summary` 短正文在模板 body 占位内垂直居中。

### 3.2 不包含

- `process-rail`、`comparison`、`quote-field` 配方。
- 模板页 `image-led`。
- 模板封面/章节页配方。
- `changeRecipe` / `distinctivenessScore`。

## 4. 功能需求

| ID   | 需求                                                      | 验收 |
| ---- | --------------------------------------------------------- | ---- |
| FR-1 | 带模板底图的 3–4 条短要点页使用 `editorial-index`，无白卡 | AC-1 |
| FR-2 | 带模板底图的指标页使用 `data-story`，标签紧贴数值         | AC-2 |
| FR-3 | 模板已有表头时配方不画强调短线；内容区分隔线保留          | AC-3 |
| FR-4 | 暗底图 accent 回退标题墨色；未采样底图不翻转模板墨色      | AC-4 |
| FR-5 | 模板背景、Logo、装饰、页脚不被删除或覆盖                  | AC-5 |
| FR-6 | 配方拒绝时回退旧分支，不丢字、不改内容                    | AC-6 |
| FR-7 | 没有 `designConcept` 的模板设计输出与改造前一致           | AC-7 |
| FR-8 | 导出的 PPTX 仍是原生文本/形状，页数和版式引用不变         | AC-8 |
| FR-9 | 同一输入 + 同一主题得到相同元素几何                       | AC-9 |

## 5. 技术设计

### 5.1 PageChrome.showRule

```ts
export interface PageChrome {
  title: NormalizedRect;
  rule: NormalizedRect;
  content: NormalizedRect;
  contentTop: number;
  contentBottom: number;
  /** False when the template already draws its own header rule. */
  showRule: boolean;
}
```

`planPageChrome` 增加可选 `showRule?: boolean`，默认 `true`；命令层在 `hasTemplate` 时传 `false`。配方在追加 `chrome.rule` 前检查 `chrome.showRule`。

### 5.2 配方支持模板底图

- `editorial-index` / `data-story` / `asymmetric-split`：只拒绝 `hasAsset`，不再拒绝 `hasArtwork`。
- `cover-statement` / `image-led` 保持拒绝 `hasArtwork`。
- `chooseRecipeId` 删除 `if (options.hasArtwork) return undefined;`。

### 5.3 命令层

```ts
const hasTemplate = Boolean(
  command.templateLayouts?.length || command.templateDecorations?.length || command.templateTheme,
);

const chrome = planPageChrome({
  ...,
  showRule: !hasTemplate,
});

const recipePlan = (() => {
  const concept = command.designConcept;
  if (!concept) return undefined;
  // 模板背景、Logo、装饰仍由前置逻辑处理；配方只追加内容元素。
  ...
})();
```

### 5.4 墨色与分隔线

```ts
const artworkDark = keepsArtwork
  ? (bodyBackground?.darkest ?? titleBackground?.darkest ?? pageLuminance) < 0.45
  : pageLuminance < 0.45;
const accentInk = artworkDark ? titleInk : design.accent;
const ruleInk = artworkDark ? "#DCE3EA" : "#E2E7EC";
```

未采样到底图亮度时，`text()` 收到 `null`，保留传入的模板墨色，不按白页做对比度翻转。

### 5.5 模板 summary 页

模板 body 占位保留原字号；`design.layout === "summary"` 且正文 ≤160 字时，按测量块高在模板 body 区域内垂直居中。

## 6. 实施步骤

1. `PageChrome.showRule` + 命令层 `hasTemplate`；配方检查。
2. 放开三个配方的 `hasArtwork`；更新 `chooseRecipeId`。
3. 命令层配方闸门；模板页颜色回退。
4. 模板 summary 居中；preset 保留模板 `textColor`。
5. 测试：配方支持、命令渲染、背景保留、无概念等价、内容隔离。
6. 7 页模板样张导出、LibreOffice 渲染、逐页检查。
7. 更新 ADR 0064、任务记录、计划表。

## 7. 测试与验收

| 文件                                             | 覆盖                                          |
| ------------------------------------------------ | --------------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts`        | 模板底图支持、showRule 关闭、模板墨色         |
| `src/core/layout/recipes/plan.test.ts`           | artwork 自动选择、图片优先级                  |
| `src/core/commands/commands.test.ts`             | 模板 + 概念 → 编号栏/指标；背景保留；封面白字 |
| `src/features/pptx-export/export-pptx.test.ts`   | 模板页配方导出、原生对象计数、背景在母版      |
| `src/services/presentation-quality-gate.test.ts` | 模板页下半页空洞仍报告                        |

### 验收标准

- **AC-1**：模板 + 概念 + 3 条短要点 → 编号行元素，无白卡。
- **AC-2**：模板 + 概念 + 3 个指标 → 数值 + 紧贴标签，无固定 0.73。
- **AC-3**：模板页没有配方强调短线；模板底图仍在。
- **AC-4**：暗底图模板的 accent 使用标题墨色；未采样底图时封面白字保持白色。
- **AC-5**：模板背景图、装饰、Logo 区域元素数量与改造前一致。
- **AC-6**：配方冲突 → 旧分支，内容逐字不变。
- **AC-7**：没有 `designConcept` 的模板设计元素几何与改造前一致。
- **AC-8**：导出页数、版式引用、原生对象计数不变。
- **AC-9**：同一输入两次生成元素序列化一致。

## 8. 风险与回退

| 风险                       | 处理                                                          |
| -------------------------- | ------------------------------------------------------------- |
| 配方线与模板表头重复       | `showRule=false`；只保留内容区分隔线                          |
| 暗底图上 accent 不可读     | 按底图亮度回退标题墨色/浅色分隔线                             |
| 未采样底图导致墨色翻转     | `text()` 的 `background=null` 保留模板墨色                    |
| 配方覆盖 Logo/装饰         | 配方只用模板 title/body 占位；装饰仍在配方前绘制              |
| 模板占位过矮导致标题缩太小 | 现有 `fittedFontSize` 下限 18；放不下返回 conflict 回退旧分支 |
| 旧测试断言模板页白卡       | 只对带 `designConcept` 的模板页启用；无概念路径不变           |

回退顺序：

1. 在命令层恢复 `hasTemplate` 闸门；
2. 保留 `showRule`/颜色回退，配方代码不动；
3. 删除模板支持分支，不影响预设路径。

## 9. 开放问题

1. 模板页 `editorial-index` 是否保留行分隔线？当前保留；如果模板底图本身有横线，样张复核后再决定。
2. 模板页 `data-story` 指标短线是否保留？当前保留，作为数字组的小锚点。
3. 模板 summary 居中会改变“正文从顶部开始”的模板意图；先只对 `summary` 且短文本启用。

## 实施记录（2026-10-24）

已落地：

- `PageChrome.showRule`；模板页 `showRule=false`，配方不再画第二条表头线。
- 三个内容配方允许模板底图；`chooseRecipeId` 不再因 `hasArtwork` 放弃自动配方。
- 命令层配方闸门只保留“没有概念”；模板页配方只追加内容元素，背景/Logo/装饰/页脚仍在原有前置后置逻辑中。
- 模板页颜色回退；未采样底图时不按白页翻转墨色。
- preset 只接管字号/字阶，不覆盖模板 `textColor`；修复深色封面标题被翻成深色。
- 模板 `summary` 短正文在模板 body 占位内垂直居中。

验证：

- 7 页模板样张（模板 + 概念 + preset）：第 2/4 页编号栏、第 3 页大数字、第 5/6 页旧分支、第 7 页收束正文居中；模板底图、Logo、页眉线保留，封面标题恢复白色。
- `npm run typecheck`、`npm run lint`（仅既有 warning）、`npm run build` 通过。
- `PPTD_SKIP_VISUAL=1 npm test`：135 个测试文件、1051 项通过，1 项视觉回归按环境跳过。

未完成：

- `process` / `comparison` 已由 [TASK-DESIGN-004](0014-process-and-comparison-recipes.md) 接续。
- 模板页 `image-led` 未接入。
- 模板封面/章节页仍使用模板构图或旧分支。
- 视觉回归基线未更新：本机图表页与 10/23 基线有 0.476% 像素差，与本次改动无关。
