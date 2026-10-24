# 0072：VisualBrief 与加权对比

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-012](../development/tasks/0022-visual-brief-and-weighted-split.md)。

## 背景

到 ADR 0071 为止，页面仍然靠“排得整齐”支撑：

- 内容阶段已经输出 `visualIntent`，但没有一个明确的“这页是图、表、图式还是纯文字”的合同；
- 对比页只有 50/50 等宽，真实对比里的“现金牛 vs 第二曲线”被迫五五开；
- 设计阶段看到的内容摘要里没有视觉形式，只能猜。

## 决策

### 1. `visualBrief` 进入内容阶段

`SlidePlan` 增加可选：

```ts
interface VisualBrief {
  form: "image" | "chart" | "diagram" | "quote" | "metric" | "table" | "none";
  brief?: string;
  aspect?: "16:9" | "4:3" | "1:1";
}
```

规则：

- 内容阶段决定形式，不决定坐标；
- `brief` 只描述画面/图式，不新增数字、结论或引语；
- 没有视觉证据时 `form: "none"`，不要为了“好看”强行配图；
- 设计阶段把 `visualBrief.form` 当作约束：chart/diagram/table 优先找能承载对应内容块的配方；`none` 不配图；
- 旧草稿没有该字段，继续走 `visualIntent`。

### 2. `weighted-split`：主次对比

- 仅用于 comparison 内容块，左右各 2–5 条；
- `ratio` 默认 0.62；0.62 表示左主，0.38 表示右主；
- 主栏标题 26pt、条目 20pt；次栏标题 18pt、条目 16pt；
- 主栏宽度按 ratio 分配，中缝一条细线，无卡片；
- 条目按测量分布，行距 10–42pt；
- 设计计划 `composition.ratio` 偏离 0.5 时，编译器选 `weighted-split`。

### 3. 边界

- 内容不变；主次只改版式权重，不改哪条内容属于哪一侧；
- 比例限制在 0.32–0.68，避免一侧无法读；
- 没有 comparison 块的页面不能使用；
- 不支持三等分、嵌套对比。

## 结果

- 内容阶段第一次明确回答“这页靠什么视觉形式承载”；
- 对比页可以表达主次，而不是所有对比都五五开；
- 设计阶段拿到的 `SlideBrief` 包含视觉形式，配方选择不再只看条数；
- `visualAssetForBrief` 把 form 落到资产：`image` 用 `brief` 补图片 prompt，`none/chart/diagram/table` 直接关闭配图，避免图表页被塞一张 stock photo；
- 旧草稿、旧设计、无 visualBrief 的路径保持兼容。

## 未覆盖

- chart/diagram/table 的原生渲染仍依赖内容块，`visualBrief` 目前是合同与选择约束，不是绘图引擎；
- `visualBrief.brief` 已用于补图片 prompt，但图片模型是否遵守 brief 未做真实样张校准；
- ratio 只支持左右主次，不支持三栏/嵌套；
- 真实模型对 visualBrief 的输出稳定性未校准。
