# TASK-DESIGN-014：chart 内容块与 chart-story

| 项目     | 内容                                   |
| -------- | -------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）               |
| 优先级   | P0                                     |
| 里程碑   | V0.4 设计能力                          |
| 预估     | 2 人日                                 |
| 依赖     | ADR 0074、ADR 0073、ADR 0072           |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent |

## 1. 背景

图表页只能从 metric 字符串解析数字，内容阶段不能直接给 categories/values/kind，也无法表达趋势/占比。

## 2. 目标

1. 新增 `chart` 内容块：kind/categories/values/series/unit；
2. `chart-story` 配方画原生图表；
3. 自动选择 chart-story；
4. `resolveChartData` 支持 chart 块；
5. AI 内容/设计提示词允许 chart 块；
6. 旧 metric 图表页兼容。

## 3. 实施

### 3.1 内容块

- 文档模型 `ContentBlock` 增加 chart；
- 文档 schema、AI `contentBlockSchema` 增加；
- `toContentBlocks` / `toAiBlocks` / `cloneContentBlocks` / `slide-relayout` / `content-diff` / review labels 增加分支；
- `resolveChartData` 优先读 chart 块；`series` 多系列或 `values` 单系列，长度不一致返回 undefined。

### 3.2 chart-story

- `supports`: facts.hasChart，无 asset，非封面/章节/引文；
- 标题/短线/可选说明 + 全宽 ChartElement；
- `kind` 来自 chart 块；
- `consumed.blockIds` 包含 chart 块；
- `chooseRecipeId` / 编译器 role claim 优先 chart-story。

### 3.3 提示词

- 内容阶段：chart 块格式与“数字来自审核内容”；
- 设计阶段：chart-story 配方、chart.kind 约束；
- 视觉修复 enum。

### 3.4 审核页编辑

- chart 块在内容审核页渲染为：
  - 图表类型；
  - 图表单位；
  - 类别（逗号分隔）；
  - 每个系列的名称与数值；
  - 添加/删除系列（≤6）。
- 数值失焦提交，避免每敲一个字符就重排。
- 图表元素仍只指向 chart 块，审核页没有第二份数字。

## 4. 测试

| 文件                                         | 覆盖                                                |
| -------------------------------------------- | --------------------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts`    | chart-story 生成 chart、kind、contentBlockIds、消费 |
| `src/core/document-model/chart-data.test.ts` | chart 块解析                                        |
| `src/services/ai-service.test.ts`            | chart 块 schema                                     |
| `src/features/ai/content-review.test.tsx`    | 审核页 chart 编辑器                                 |
| 既有 metric 图表测试                         | metric 路径不变                                     |

## 5. 验收

- **AC-1**：chart 块 `{kind:"line",categories,values,unit}` 可解析。
- **AC-2**：chart-story 生成一个 chart 元素，kind 与块一致。
- **AC-3**：`contentBlockIds`/`consumed.blockIds` 含 chart 块 ID。
- **AC-4**：categories 与 values 不等长时 `resolveChartData` 返回 undefined。
- **AC-5**：多系列 `series` 按名称/值返回，导出为多系列原生图。
- **AC-6**：旧 metric 图表页仍工作。
- **AC-7**：导出原生图表，不是图片。
- **AC-8**：内容逐字不变。

## 6. 实施记录（2026-10-24）

- 新增 chart 内容块、chart-story 配方、注册/概念/zod/提示词/修复 enum。
- `resolveChartData` 支持 chart 块（单/多系列）；旧 metric 路径保留。
- 命令层 block 转换/克隆/重排/审核标签补 chart 分支。
- 多系列导出：`series` 逐条写入 PptxGenJS，多系列自动显示 legend。
- 审核页 chart 编辑器：类型/单位/类别/系列名称/数值/增删系列。
- 样张：`.tmp/render27/p1.png`（收入/利润分组柱状图）。
- 测试：配方、chart 数据、AI schema。

验证：

- `npx vitest run src/core/layout/recipes/recipes.test.ts src/core/document-model/chart-data.test.ts`：通过。
- 全量：137 个测试文件、1096 项通过，1 项视觉回归按环境跳过；类型检查、Lint、生产构建、`cargo fmt --check`、`cargo check` 通过。

## 7. 未完成

- 图表样式（legend/axis/多色）仍固定；
- AI 输出 chart 块的真实模型稳定性；
- 单 chart 块最多 6 个系列，不支持组合图。
