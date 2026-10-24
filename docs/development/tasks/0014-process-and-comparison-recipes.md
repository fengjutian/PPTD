# TASK-DESIGN-004：流程轨与对比页配方

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）                                  |
| 优先级   | P0                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 3–4 人日                                                  |
| 依赖     | ADR 0065、ADR 0064、ADR 0063、ADR 0046                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

流程页和对比页目前仍走旧分支：

- 流程页四张 2.4in 横卡居中，页面下半部空；卡片内标签 20pt、正文 16pt，行高由固定卡高决定；
- 对比页两张面板，面板高度和内容量不成比例，条目是 `• item` 拼成的大文本块；
- 两类内容块在模板页和预设页都走旧分支，同一册有两套视觉语言。

## 2. 目标

新增 `process-rail` 与 `comparison` 两个纯函数配方，覆盖流程页和对比页；模板页和预设页共用；内容不丢、不改；放不下时回退旧分支。

## 3. 范围

### 3.1 包含

- `RecipeId` 增加 `process-rail`、`comparison`。
- 两个配方文件、注册表、合法性、`consumed`。
- `chooseRecipeId` 对 `hasProcess` / `hasComparison` 的选择。
- `editorial` 概念预设新增两个配方。
- Rust/TS 提示词与 zod 枚举增加两个配方。
- 命令层配方分派、模板页兼容、导出测试。
- 7 页样张渲染复核。

### 3.2 不包含

- 超过 6 步的流程分页。
- 三栏对比、矩阵对比、结论条。
- 模板页 `image-led`。
- `changeRecipe` / `distinctivenessScore`。

## 4. 功能需求

| ID   | 需求                                                          | 验收 |
| ---- | ------------------------------------------------------------- | ---- |
| FR-1 | 3–6 步流程页使用 `process-rail`，纵向轨道 + 步骤节点          | AC-1 |
| FR-2 | 2–5 条对比页使用 `comparison`，两栏等高、栏头 accent          | AC-2 |
| FR-3 | 两配方消费 `process` / `comparison` 块，块 ID 进入 `consumed` | AC-3 |
| FR-4 | 模板底图、`showRule=false`、模板墨色下仍可读                  | AC-4 |
| FR-5 | 放不下时返回 conflict，回退旧分支，不丢内容                   | AC-5 |
| FR-6 | 没有配方的旧设计输出不变                                      | AC-6 |
| FR-7 | 导出仍是原生文本/形状，页数和版式引用不变                     | AC-7 |
| FR-8 | 相同输入得到相同元素几何                                      | AC-8 |

## 5. 技术设计

### 5.1 类型与注册

```ts
export type RecipeId =
  | "cover-statement"
  | "data-story"
  | "image-led"
  | "editorial-index"
  | "asymmetric-split"
  | "process-rail"
  | "comparison";
```

`registry.ts` 注册 `processRail`、`comparison`；`CONCEPT_PRESETS.editorial.recipes` 增加两项。

### 5.2 process-rail

输入：`content.blocks` 中唯一 `process` 块，3–6 步。

| 区域 | 规则                                                                |
| ---- | ------------------------------------------------------------------- |
| 标题 | `chrome.title`；`showRule` 时画 `chrome.rule`                       |
| 轨道 | x = content.x + 0.035，y = 组顶到组底，宽 0.006，accent             |
| 节点 | 直径 0.30in 圆，圆心在轨道上；内部序号 12pt 白字                    |
| 标签 | 20pt 粗体，x = 轨道 + 0.06；宽 = content.width - 0.06               |
| 说明 | 16pt，x 同上，标签下 0.008；宽同上；最多三行                        |
| 行高 | `max(labelHeight + 0.008 + textHeight, 0.16 页高)`；步间距 12–32pt  |
| 组   | 总高在 content 内垂直居中；放不下先缩说明到 12pt，仍放不下 conflict |

`consumed`：title true；body 为空或能由说明覆盖；items 0；blockIds = [processBlock.id]。

### 5.3 comparison

输入：`content.blocks` 中唯一 `comparison` 块，左右各 2–5 条。

| 区域 | 规则                                                                     |
| ---- | ------------------------------------------------------------------------ |
| 标题 | `chrome.title`；`showRule` 时画 `chrome.rule`                            |
| 栏宽 | `(content.width - 0.04) / 2`；两栏间距 0.04                              |
| 栏头 | 高 0.36in；accent 填充；白字 20pt 居中                                   |
| 面板 | 高 = max(content.height * 0.55, 栏头 + 上下 0.22in + 较高栏测量高度)     |
| 条目 | 18pt，每行前 0.012 宽 accent 短竖线；行距 10–20pt；每条单独测量          |
| 中轴 | x = 内容区中心；分隔线 0.0014 宽；中心 0.42in accent 圆 + “VS” 14pt 白字 |
| 组   | 面板整体在 content 内垂直居中                                            |

`consumed`：title true；body 为空或作为引导段绘制；items 0；blockIds = [comparisonBlock.id]。

### 5.4 选择与提示词

`chooseRecipeId` 顺序：

1. `hasComparison` → `comparison`（概念允许时）；
2. `hasProcess` → `process-rail`（概念允许时）；
3. 其余保持现有顺序。

Rust 设计提示词第 8 节和 zod `recipe` 枚举增加两项；说明 `process-rail` 仅用于 process 块、`comparison` 仅用于 comparison 块。

## 6. 实施步骤

1. 类型、注册表、概念预设、zod/提示词。
2. `process-rail` + 测试。
3. `comparison` + 测试。
4. `chooseRecipeId` + 命令层测试（模板/预设）。
5. 导出测试 + 7 页样张渲染。
6. 文档与记录。

## 7. 测试与验收

| 文件                                           | 覆盖                                     |
| ---------------------------------------------- | ---------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts`      | 两个配方的支持、几何、消费、重叠、确定性 |
| `src/core/layout/recipes/plan.test.ts`         | 流程/对比自动选择、优先级                |
| `src/core/commands/commands.test.ts`           | 模板 + 概念 → 流程轨/对比；无概念等价    |
| `src/features/pptx-export/export-pptx.test.ts` | 配方导出、原生对象                       |
| `src/services/ai-service.test.ts`              | zod 枚举接受/拒绝                        |

### 验收标准

- **AC-1**：4 步流程页生成 4 个节点、4 个标签、4 段说明，纵向轨道贯通。
- **AC-2**：左右各 3 条的对比页生成等高面板，栏头 accent，条目独立。
- **AC-3**：`consumed.blockIds` 含对应块 ID；命令层不报 `AI_DESIGN_CONTENT_LOSS`。
- **AC-4**：模板页配方生效，底图/Logo/表头保留。
- **AC-5**：7 步流程/6 条对比返回 conflict，回退旧分支，内容逐字不变。
- **AC-6**：没有 `designConcept` 的旧设计输出不变。
- **AC-7**：导出页数、版式引用、原生对象计数正确。
- **AC-8**：同一输入两次生成元素序列化一致。

## 8. 风险与回退

| 风险                     | 处理                                                    |
| ------------------------ | ------------------------------------------------------- |
| 流程轨在模板页与页脚冲突 | 组底不超过 contentBottom - 0.03；页脚仍由后处理统一添加 |
| 对比页窄栏长条目溢出     | 每条独立测量，字号 18→14；仍放不下 conflict             |
| 模板底图墨色不可读       | 命令层 accent/rule 回退；配方只读 ctx.colors            |
| 旧测试断言旧卡片         | 新配方只在带概念时启用；无概念路径不变                  |

回退顺序：

1. 从概念预设移除两个配方；
2. 保留配方文件，`chooseRecipeId` 不选它们；
3. 删除注册，旧分支不变。

## 9. 开放问题

1. 流程轨在 6 步时是否改成两列？当前只缩字号，超过 6 步回退旧分支。
2. 对比页中轴 “VS” 是否在无对比语义时也画？当前只要 comparison 块就画。
3. 模板页流程轨是否保留模板的页脚线？当前保留，配方只画内容区。

## 实施记录（2026-10-24）

已落地：

- `RecipeId`、`editorial` 概念预设、zod 合同、Rust 设计提示词增加 `process-rail`、`comparison`。
- `src/core/layout/recipes/process-rail.ts`：纵向轨道、步骤节点、20pt 标签 + 16pt 说明、测量行高、12–32pt 步距、3–6 步。
- `src/core/layout/recipes/comparison.ts`：等高双栏、accent 栏头、独立要点行、中轴分隔线、VS 圆标、2–5 条/栏。
- `chooseRecipeId` 优先选择结构化配方；模板/预设均可用；`showRule`、暗底图 accent、`card` 面色继续由命令层提供。
- 配方 `consumed.blockIds` 包含 `process` / `comparison` 块 ID；冲突回退旧分支。
- 测试：配方几何/消费/确定性、自动选择、模板命令、导出夹具、zod 枚举。

验证：

- 流程样张：4 步纵向轨道，节点 01–04、标签、说明全部为原生对象，轨道从第一步贯通到最后一步。
- 对比样张：两块等高面板，accent 栏头、独立要点、中轴 VS，模板底图/页眉保留。
- `npm run typecheck`、`npm run lint`（仅既有 warning）、`npm run build` 通过。
- `PPTD_SKIP_VISUAL=1 npm test`：136 个测试文件、1060 项通过，1 项视觉回归按环境跳过。

未完成：

- 超过 6 步的流程分页/两列；当前回退旧分支。
- 三栏/矩阵对比、结论条。
- 模板页 `image-led`。
- 视觉回归基线未更新：本机图表页与 10/23 基线有 0.476% 像素差，与本次改动无关。
