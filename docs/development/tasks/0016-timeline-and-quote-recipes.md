# TASK-DESIGN-006：时间线轨与引文页配方

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P1，2026-10-24）                                  |
| 优先级   | P1                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 3–4 人日                                                  |
| 依赖     | ADR 0067、ADR 0065、ADR 0063、ADR 0046                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

`timeline` 和 `quote` 是最后两个没有配方的内容块：

- 时间线旧分支是横向线 + 上下交错小字，3–6 步时字号被压缩，页面下半部空；
- 引文旧分支是一个大文本框 + 引号，字号和行宽没有统一，长引文容易顶满；
- 两类页面在模板页和预设页都走旧分支，整册节奏缺两个页型。

## 2. 目标

新增 `timeline-rail` 与 `quote-field`，覆盖 timeline/quote 块；模板/预设共用；内容不丢；放不下回退旧分支。

## 3. 范围

### 3.1 包含

- `RecipeId` 增加 `timeline-rail`、`quote-field`。
- 两个配方、注册表、概念预设、自动选择、zod/提示词。
- 命令层配方分派、模板页兼容。
- 测试、导出、样张渲染。

### 3.2 不包含

- 超过 6 条时间线的分页。
- 多引文、引文配图。
- 章节页 / 表格页配方。
- `conceptFitScore` / 整册配方节奏评分。

## 4. 功能需求

| ID   | 需求                                                     | 验收 |
| ---- | -------------------------------------------------------- | ---- |
| FR-1 | 3–6 条时间线使用 `timeline-rail`，日期左、轨道中、事件右 | AC-1 |
| FR-2 | 引文页使用 `quote-field`，大引文 + 引号 + 署名           | AC-2 |
| FR-3 | 两配方消费 timeline/quote 块，块 ID 进入 `consumed`      | AC-3 |
| FR-4 | 模板底图、`showRule=false`、模板墨色下可读               | AC-4 |
| FR-5 | 放不下时 conflict 回退旧分支，不丢内容                   | AC-5 |
| FR-6 | 无概念/无 recipe 的旧设计输出不变                        | AC-6 |
| FR-7 | 导出原生对象，页数/版式引用不变                          | AC-7 |
| FR-8 | 相同输入得到相同几何                                     | AC-8 |

## 5. 技术设计

### 5.1 timeline-rail

输入：唯一 `timeline` 块，3–6 条。

| 区域 | 规则                                                          |
| ---- | ------------------------------------------------------------- |
| 标题 | `chrome.title`；`showRule` 时画 `chrome.rule`                 |
| 左栏 | 宽 0.16 页；标签 16pt 粗体右对齐                              |
| 轨道 | x = content.x + 0.18；竖线 0.006 宽；圆点直径 0.12in          |
| 右栏 | x = 轨道 + 0.03；宽 = content 剩余；说明 16pt，最小 12pt      |
| 行高 | max(标签高, 说明高) + 0.008；步距 12–28pt；组在内容区垂直居中 |
| 溢出 | 先缩说明；仍放不下 conflict                                   |

### 5.2 quote-field

| 区域 | 规则                                                                |
| ---- | ------------------------------------------------------------------- |
| 标题 | `chrome.title`，24pt；`showRule` 时画短线                           |
| 竖线 | x = content.x + 0.02，宽 0.006，accent，覆盖引文组高度              |
| 引号 | 72pt，accent，位于引文左上                                          |
| 引文 | 32–40pt，行宽 ≤ content.width * 0.72；测量后垂直居中；过长缩至 24pt |
| 署名 | 16pt，引文下方 0.02；无署名则省略                                   |
| 正文 | body 非空且不是引文时，作为 16pt 引导段放在标题下；否则并入引文     |
| 溢出 | 引文/署名放不下返回 conflict                                        |

### 5.3 选择

`chooseRecipeId` 顺序在 comparison/process 之后：

```ts
if (facts.hasTimeline && concept.recipes.includes("timeline-rail")) return "timeline-rail";
if (facts.hasQuote && facts.layout === "quote" && concept.recipes.includes("quote-field")) return "quote-field";
```

`hasRowBlock` 的旧拒绝逻辑放在这两个之后；带引文的列表页仍走 editorial/comparison。

## 6. 实施步骤

1. 类型、注册表、概念预设、zod/提示词。
2. `timeline-rail` + 测试。
3. `quote-field` + 测试。
4. 自动选择 + 命令层测试（模板/预设）。
5. 导出/样张、文档与记录。

## 7. 测试与验收

| 文件                                           | 覆盖                                     |
| ---------------------------------------------- | ---------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts`      | 两个配方的支持、几何、消费、重叠、确定性 |
| `src/core/layout/recipes/plan.test.ts`         | 时间线/引文自动选择、优先级              |
| `src/core/commands/commands.test.ts`           | 模板 + 概念 → 时间线/引文；无概念等价    |
| `src/features/pptx-export/export-pptx.test.ts` | 配方导出、原生对象                       |
| `src/services/ai-service.test.ts`              | zod 枚举                                 |

### 验收标准

- **AC-1**：5 条时间线生成 5 个日期标签、5 个圆点、5 段说明。
- **AC-2**：引文页生成大引号、引文、署名，字号 ≥28（短引文）。
- **AC-3**：`consumed.blockIds` 含 timeline/quote 块 ID。
- **AC-4**：模板页配方生效，底图/页眉保留。
- **AC-5**：7 条时间线/超长引文返回 conflict，内容逐字不变。
- **AC-6**：无 `designConcept` 输出不变。
- **AC-7**：导出页数、版式引用、原生对象计数正确。
- **AC-8**：两次生成元素序列化一致。

## 8. 风险与回退

| 风险                   | 处理                                                        |
| ---------------------- | ----------------------------------------------------------- |
| 时间线日期过长         | 左栏 0.16 页宽，标签可换行；行高按测量                      |
| 引文过长               | 先缩至 24pt；仍放不下 conflict                              |
| 模板底图墨色           | 命令层 accent/rule 回退；配方只读 ctx.colors                |
| 带引文的列表页误用引文 | `chooseRecipeId` 只在 `layout === "quote"` 时选 quote-field |

回退顺序：

1. 从概念预设移除两个配方；
2. 保留文件，`chooseRecipeId` 不选；
3. 删除注册，旧分支不变。

## 9. 开放问题

1. 时间线是否允许 2 条？当前 3–6，避免两点成线。
2. 引文页标题是否必要？当前保留为 kicker。
3. 引文很长时是否允许跨页？当前返回 conflict，不拆页。

## 实施记录（2026-10-24）

已落地：

- `RecipeId`、`editorial` 概念预设、zod、Rust 设计/修复提示词增加 `timeline-rail`、`quote-field`。
- `timeline-rail.ts`：日期左栏、0.006 轨道、0.12in 圆点、16pt 日期/说明、测量行高、12–28pt 步距、3–6 条。
- `quote-field.ts`：24pt kicker、72pt 引号、32–44pt 引文、16pt 署名、accent 竖线；引文测量后垂直居中。
- `chooseRecipeId` 增加时间线/引文选择；引文只在 `layout === "quote"` 时选择，避免抢走带引文的列表页。
- 命令层模板/预设统一生效；`consumed.blockIds` 守住 timeline/quote 块。
- 测试：配方几何/消费、自动选择、命令集成。

验证：

- 时间线样张：5 个日期、5 个节点、5 段事件，纵向轨道贯通。
- 引文样张：大引号、44pt 引文、署名、accent 竖线，模板页眉保留。
- 全量前端测试通过（136 个文件、1069 项）；`cargo fmt --check`、`cargo check`、类型检查、Lint、生产构建通过。

未完成：

- 超过 6 条时间线的分页。
- 多引文轮播、引文配图。
- 章节页/表格页配方。
- 视觉回归基线未更新：本机图表页与 10/23 基线有 0.476% 像素差，与本次改动无关。
