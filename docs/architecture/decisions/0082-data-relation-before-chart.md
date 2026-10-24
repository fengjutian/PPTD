# 0082 数据页先定关系再选图表

## 状态

已接受（2026-10-24）。

## 背景

指标页此前只按“同单位 + 点数”决定图表：2–4 个用柱状，5 个以上用条形。模型在 `designPlan.chart.kind` 给出的选择没有被编译器采用，数据页也没有“这页在讲什么关系”的维度。

结果是：时间趋势可能被画成饼图，占比可能被画成柱状，三个大数字永远得到同一根柱子。数字没错，论证错了。

## 决策

### 1. 五种关系

```ts
type DataRelation = "proportion" | "change" | "composition" | "comparison" | "magnitude";
```

- `proportion`：一个整体被分成份额；
- `change`：随时间变化；
- `composition`：由哪些部分组成；
- `comparison`：类别之间对比；
- `magnitude`：量级大小。

### 2. 关系优先于模型点选的图型

`resolveChartKind`：

- 有 `relation` 时，模型请求的 `kind` 只有与关系兼容才保留；
- 不兼容时用关系对应的图型（例如 `change` 一律 `line`，`proportion` 在 ≤5 类时 `pie`，否则 `bar`）；
- 没有 `relation` 时保持旧行为：用请求的 kind，缺省按点数选柱状/条形。

兼容矩阵：

| 关系        | 可用图型    |
| ----------- | ----------- |
| proportion  | pie、bar    |
| change      | line        |
| composition | pie、bar    |
| comparison  | column、bar |
| magnitude   | column、bar |

### 3. 关系是生成时维度，不写进文档

`PageDesignPlan.chart.relation` 由设计模型输出；编译器用它决定最终的 `ChartElement.kind`。文档只保存结果图型，不新增字段，因此 Schema 不变。

这避免为一个可由 kind 反推的临时判断增加持久化负担；代价是属性面板无法显示“这页的关系”，评审也无法直接读取。

### 4. 只影响自动生成，不限制手工编辑

手工 `add-chart` / `set-chart-kind` 行为不变：用户可以自由选择图型。关系规则只约束 AI 设计编译，不锁死编辑器。

### 5. 不新增图表能力

当前原生图表只有 column、bar、line、pie，没有 100% 堆叠、散点、气泡或双轴。关系决定的是“现有四种里选哪个”，不是“声称支持更多图型”。

## 后果

正面：

- 趋势不会再被画成饼图，占比不会再被画成折线。
- 数据页开始有“先讲关系、再选图型”的论证顺序。
- 旧设计没有 relation 时行为完全不变。

代价与限制：

- 关系不持久化：重新打开文档后无法知道当初的判断，编辑器也不显示。
- 没有 100% 堆叠图，`composition` 只能用饼图或条形近似。
- 关系与图型的映射是启发式，真实数据里可能有反例；编译器只保证不出现明显错配。
- 视觉评审仍按图型与画面评分，没有单独的“关系匹配分”。

## 验证

- `data-relation.test.ts`：兼容矩阵、点数偏好、兼容请求保留、错配覆盖、无 relation 保持旧行为。
- `commands.test.ts`：模型请求 pie + `change`，最终生成 `line`。
- 全量测试、类型检查、ESLint、生产构建、`cargo fmt --check`、`cargo check` 通过。

## 备选方案

- **持久化 relation 到 ChartElement**：可显示、可评审，但需要 Schema 迁移与固定样例；当前收益不足，等需要“关系匹配分”时再做。
- **直接信任模型给的 kind**：无法阻止趋势画成饼图。
- **关系不兼容时拒绝生成**：会让整册因为一个图表选择失败；覆盖为兼容图型更稳。
- **新增 100% 堆叠图**：需要导出器与画布同时支持，属于独立能力，不在本次范围。
