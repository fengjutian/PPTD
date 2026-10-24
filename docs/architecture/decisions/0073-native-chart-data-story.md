# 0073：同单位指标页优先原生图表

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-013](../development/tasks/0023-native-chart-data-story.md)。

## 背景

`VisualBrief` 已经把“这页是图/表/图式”带进设计阶段，但数据页仍然把三个指标画成三个大数字：

- 三个数字并排只能说明“有这三个值”，不能说明趋势；
- `data-story` 已经把指标画得很大，但页面下半部仍然空；
- 项目已有原生图表 (`ChartElement` / PptxGenJS) 和 `resolveChartData`，只差在配方里使用。

## 决策

### 1. 同单位指标 → 原生图表

`data-story` 在满足以下条件时改画原生柱状图：

- 指标块 ≥ 2；
- 每个 `metric.value` 都能被 `parseMetricValue` 解析；
- 所有指标单位相同。

图表：

- 全宽内容区，高度 `min(内容区 * 0.82, 0.62)`；
- `kind` 来自 `designPlan.chart.kind`（column/bar/line/pie），缺省 column；`showValueLabels: true`；
- `contentBlockIds` 指向已审核的 metric 块，数字不复制；
- 图表标题/分类/数值由内容块解析，图表不能自造数字。

### 2. 单位不同 → 保留大数字

如果指标单位不同（例如“38 万 / 260 家 / 5 天”），不强行画在同一张图里，继续用现有大数字组；这避免把不同量纲画成同一坐标轴。

### 3. 内容消费

- chart 分支 `consumed.blockIds` 包含全部 metric 块；
- `bodyCovered` 仍按原规则；
- 图表元素计入 `nativeObjectCount`，导出后可在 PowerPoint 中编辑数据。

## 结果

- 趋势型指标页第一次有真正的图表，而不是三个大数字；
- 图表类型由设计计划选择：时间趋势 line、占比 pie、类别比较 column/bar，缺省 column；
- 图表与内容块绑定，编辑内容会改变图表；
- 混合单位页仍保持大数字，不制造错误对比；
- 导出仍是原生图表，不是图片。

## 未覆盖

- 没有时间序列/多系列数据；当前一页最多 3 个分类；
- 图表类型虽可选 line/pie/bar，但数据仍是 3 个分类，不能表达多系列；
- `visualBrief.form=chart` 只是内容建议，内容阶段仍要输出 metric 块；
- 图表配色只用 accent，未做多系列色板。
