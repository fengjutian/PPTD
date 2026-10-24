# TASK-DESIGN-012：VisualBrief 与加权对比

| 项目     | 内容                                   |
| -------- | -------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）               |
| 优先级   | P0                                     |
| 里程碑   | V0.4 设计能力                          |
| 预估     | 2 人日                                 |
| 依赖     | ADR 0072、ADR 0071、ADR 0070           |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent |

## 1. 背景

内容阶段已有 `visualIntent`，但没有明确的视觉形式合同；对比页只有 50/50 等宽，主次关系被迫抹平。

## 2. 目标

1. `SlidePlan.visualBrief`：form / brief / aspect；
2. 设计阶段把 `visualBrief.form` 当作约束；
3. 新增 `weighted-split`：0.38/0.62 主次分栏；
4. 设计计划 ratio 偏离 0.5 时编译器选 weighted-split；
5. 旧草稿/旧设计兼容。

## 3. 实施

### 3.1 VisualBrief

```ts
const visualBriefSchema = z.object({
  form: z.enum(["image", "chart", "diagram", "quote", "metric", "table", "none"]),
  brief: z.string().max(300).optional(),
  aspect: z.enum(["16:9", "4:3", "1:1"]).optional(),
});
```

- 加入 `slidePlanSchema.visualBrief?`；
- `SlideBrief` 自动带出；
- Rust 内容阶段提示词要求输出；
- 设计提示词要求尊重 form；`none` 不强行配图；
- 旧草稿缺省。

### 3.2 weighted-split

- `RecipeId` 增加 `weighted-split`；
- 新配方：comparison 块、2–5 条/侧、ratio 0.32–0.68；
- 主栏 26/20pt，次栏 18/16pt；主栏宽度按 ratio；
- 无卡片、无 VS，中缝细线；
- `RecipeContext.ratio`；编译器从 `designPlan.composition.ratio` 传入；
- `planRecipe` 在 comparison + ratio≠0.5 时选 weighted-split。

### 3.3 合同

- `aiDesignRecipeIds` 增加 `weighted-split`；
- Rust 设计/修复提示词增加；
- 视觉修复 enum 增加。

## 4. 测试

| 文件                                      | 覆盖                                   |
| ----------------------------------------- | -------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts` | 主栏字号/宽度大于次栏、内容消费、无 VS |
| `src/services/ai-service.test.ts`         | visualBrief 解析                       |
| `src/core/layout/design-compiler.test.ts` | ratio 选择 weighted-split（待补）      |
| `src/core/design/deck-concept.test.ts`    | 配方列表                               |

## 5. 验收

- **AC-1**：content plan 可解析 `visualBrief`，旧草稿无该字段仍合法。
- **AC-2**：`form: "none"` 时设计提示词禁止强行配图。
- **AC-3**：comparison + ratio 0.62 → weighted-split。
- **AC-4**：主栏标题/条目大于次栏，主栏宽度 > 次栏。
- **AC-5**：内容逐字保留，`consumed` 通过。
- **AC-6**：无 comparison 块时 weighted-split conflict/不支持。
- **AC-7**：旧 `comparison` 50/50 行为不变。

## 6. 实施记录（2026-10-24）

- `visualBriefSchema` + `slidePlanSchema.visualBrief?`；内容/设计提示词增加约束。
- `visualAssetForBrief`：`image` 用 brief 补图片 prompt；`none/chart/diagram/table` 关闭配图，避免图表页被塞 stock photo。
- `weighted-split` 配方、注册、概念、zod、修复 enum。
- `RecipeContext.ratio`；编译器从 designPlan 传 ratio；comparison role 在 ratio≠0.5 时选 weighted-split。
- 样张：`.tmp/render23/p1.png`（0.62 左主）。
- 测试：配方、AI schema、概念列表。

验证：

- `npx vitest run src/core/layout/recipes/recipes.test.ts`：通过。
- `npx vitest run src/services/ai-service.test.ts`：通过。
- 全量：137 个测试文件、1089 项通过，1 项视觉回归按环境跳过；类型检查、Lint、生产构建、`cargo fmt --check`、`cargo check` 通过。

## 7. 未完成

- chart/diagram/table 的真正绘制仍依赖内容块；visualBrief 目前是合同和选择约束。
- `visualBrief.brief` 已用于补图片 prompt，但图片模型是否遵守未做真实校准。
- 三栏/嵌套对比。
- 真实模型输出校准。
