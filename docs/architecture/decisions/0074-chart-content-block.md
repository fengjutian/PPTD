# 0074：chart 内容块与 chart-story 配方

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-014](../development/tasks/0024-chart-content-block.md)。

## 背景

ADR 0073 让同单位 metric 块可以画原生图表，但内容阶段仍然只能输出“三个数字 + 标签”，不能表达：

- 分类名称；
- 数值本身（不是带单位的字符串）；
- 趋势/占比对应的图表类型；
- 多一个 chart 块就多一张图表页。

结果图表页仍依赖 metric 块的字符串解析，AI 不能直接给出图表数据。

## 决策

### 1. 新增 `chart` 内容块

```ts
interface ChartContentBlock {
  id: string;
  type: "chart";
  kind: "column" | "bar" | "line" | "pie";
  categories: string[]; // 2–8
  values?: number[]; // 单系列简写
  series?: Array<{ name: string; values: number[] }>; // 多系列
  unit?: string;
}
```

- 数值是 number，不是展示字符串；图表不再解析 `"38 万"`；
- `categories`/`values`/`series` 是审核内容，进入内容哈希；
- `series` 存在时优先使用，每个 series 的 values 必须与 categories 等长；
- 长度不一致时由 `resolveChartData` 拒绝，不画半张图；
- 旧文档没有该块，schema 不需要版本迁移；新块是可辨识联合的新增分支。

### 2. 新增 `chart-story` 配方

- 仅用于存在 chart 块的页面；
- 标题/短线走 `PageChrome`；
- 可选 body 说明，宽度 0.72、字号 ≤16；
- 原生 `ChartElement`，`contentBlockIds: [chartBlock.id]`，全宽、高度最多 0.72；
- 图表类型来自块的 `kind`，导出为可编辑图表；
- `consumed.blockIds` 包含 chart 块 ID。

### 3. 选择

- `chooseRecipeId`：有 chart 块优先 `chart-story`；
- 设计计划 role claim + facts.hasChart 也选 `chart-story`；
- AI 内容合同允许输出 chart 块；设计提示词说明图表类型。

### 4. 图表数据

`resolveChartData` 先找 chart 块：

- `series` 存在时按多系列返回；否则把 `values` 当作单系列；
- 每个 series 的 values 与 categories 等长才返回；
- 否则拒绝；
- 旧的 metric 解析路径保留。

### 5. 审核页编辑

内容审核页的 chart 块提供：

- 图表类型（柱/条/折/饼）；
- 类别（逗号分隔）；
- 每个系列的名称与数值（逗号分隔，失焦提交）；
- 添加/删除系列（最多 6 个）。

数字仍在内容块里，编辑图表不会复制一份数值到设计层。

## 结果

- 内容阶段可以显式给出图表数据，不再依赖 metric 字符串；
- 图表页有独立配方，标题、说明、图表区不再挤在 metric 卡片逻辑里；
- 多系列图表可导出为同一张原生图（如“收入/利润”分组柱状图）；
- 审核页可直接编辑图表类别、系列名称和数值；
- 旧 metric 图表页保持兼容。

## 未覆盖

- 图表样式（legend/axis/多色）仍由配方固定；
- AI 提示词是否能稳定输出 chart 块未做真实模型校准；
- 设计计划里的 chart.kind 与 chart 块 kind 冲突时，目前配方以块为准。
