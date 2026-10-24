# TASK-DESIGN-013：同单位指标页原生图表

| 项目     | 内容                                   |
| -------- | -------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）               |
| 优先级   | P0                                     |
| 里程碑   | V0.4 设计能力                          |
| 预估     | 1 人日                                 |
| 依赖     | ADR 0073、ADR 0072、ADR 0064           |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent |

## 1. 背景

指标页把 2–3 个数字放大并排，能读但不能看趋势；项目已有原生图表能力，配方没有使用。

## 2. 目标

1. 同单位指标页画原生柱状图；
2. 图表指回 metric 块，不复制数字；
3. 混合单位继续大数字；
4. 导出保持原生可编辑图表。

## 3. 实施

### 3.1 条件

```ts
const parsed = metrics.map((metric) => parseMetricValue(metric.value));
const chartable = parsed.every(Boolean) && parsed.every((p) => p.unit === parsed[0].unit);
```

### 3.2 图表

- `ChartElement`，`contentBlockIds = metrics.map(m => m.id)`；
- `kind` 来自 `designPlan.chart.kind`（column/bar/line/pie），缺省 column；
- `showValueLabels: true`，`showLegend: false`；
- 全宽内容区，高度 `min(available * 0.82, 0.62)`；
- `seriesColors: [colors.accent]`。

### 3.3 回退

- 单位不同、数值不可解析、指标少于 2 → 保留大数字组；
- `consumed` 两种分支都覆盖全部 metric 块。

## 4. 测试

| 文件                                      | 覆盖                                           |
| ----------------------------------------- | ---------------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts` | 同单位 3 指标生成 chart、contentBlockIds、消费 |
| 既有指标测试                              | 混合单位仍生成大数字                           |
| 导出测试                                  | 原生 chart 计数（既有 chart 导出测试）         |

## 5. 验收

- **AC-1**：`38/52/71` 三指标 → 一个 column chart。
- **AC-2**：`contentBlockIds` 等于三个 metric 块 ID。
- **AC-3**：`consumed.blockIds` 等于三个 metric 块 ID。
- **AC-4**：`38 万 / 260 家 / 5 天` 仍生成大数字，不画图。
- **AC-5**：导出后图表是原生对象，不是图片。
- **AC-6**：内容逐字不变。

## 6. 实施记录（2026-10-24）

- `data-story` 增加 chart 分支；同单位指标生成全宽原生图表。
- 图表类型由 `designPlan.chart.kind` 选择（column/bar/line/pie），缺省 column；`RecipeContext.chartKind` 传入配方。
- 混合单位保留大数字组。
- 样张：`.tmp/render25/p1.png`。

验证：

- `npx vitest run src/core/layout/recipes/recipes.test.ts`：通过。
- 全量：137 个测试文件、1090 项通过，1 项视觉回归按环境跳过；类型检查、Lint、生产构建、`cargo fmt --check`、`cargo check` 通过。

## 7. 未完成

- 时间序列 / 多系列数据仍不支持。
- `visualBrief.form=chart` 到 metric 块的内容生成约束仍靠提示词。
- 图表多系列色板。
