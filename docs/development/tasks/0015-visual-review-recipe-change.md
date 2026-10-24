# TASK-DESIGN-005：视觉评审换配方与独特性评分

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）                                  |
| 优先级   | P0                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 2–3 人日                                                  |
| 依赖     | ADR 0066、ADR 0046、ADR 0065、ADR 0015                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

视觉评审的动作只有 move / resize / restyle / align / changeLayout；模型看不出“这页是等权卡片”，也没有词要求“换一个配方”。结果评审只能把平庸的页面修整齐，不能要求换一个设计想法。

## 2. 目标

让评审能：

1. 给“是否有设计想法”打分（`distinctivenessScore`）；
2. 把“版式过于通用”报告为 `generic-layout`；
3. 在修复计划里直接换 `recipe`；
4. 在总分不变但独特性提高时保留修复版本；
5. 不破坏旧评审、旧修复计划和内容隔离。

## 3. 范围

### 3.1 包含

- `VisualReview.distinctivenessScore`、逐页分数、`generic-layout` issue。
- `minimumScores.distinctiveness`（默认 72，可选）。
- `VisualRepairPlan.repairs[].recipe`；规范化、提示词、当前配方输入。
- `design-quality-stage` 把 recipe 写回设计；命令层继续校验。
- 循环 tie-break：总分相同、独特性更高时保留修复版本。
- App 问题标签、质量报告、测试。

### 3.2 不包含

- `conceptFitScore`、整册配方节奏评分。
- 换配方后的定点重渲染优化。
- 模板页 `layoutIntents` 跟随配方。
- 真实模型评分校准。

## 4. 功能需求

| ID   | 需求                                                    | 验收 |
| ---- | ------------------------------------------------------- | ---- |
| FR-1 | 评审可返回 `distinctivenessScore`；旧响应无此字段仍合法 | AC-1 |
| FR-2 | 等权卡片/同骨架/无焦点页报告 `generic-layout`           | AC-2 |
| FR-3 | 修复计划可只给 `recipe`，不需要几何动作                 | AC-3 |
| FR-4 | 未知配方被丢弃；不传给渲染器                            | AC-4 |
| FR-5 | 配方写回设计，命令层按内容校验，不合法回退旧分支        | AC-5 |
| FR-6 | 总分相同、独特性更高时保留修复版本                      | AC-6 |
| FR-7 | 内容、内容哈希、审核状态不变                            | AC-7 |
| FR-8 | 质量报告显示独特性分数/低分页                           | AC-8 |

## 5. 技术设计

### 5.1 评分合同

```ts
export interface VisualReview {
  // existing scores...
  distinctivenessScore?: number;
  slideScores?: Array<{
    // existing scores...
    distinctivenessScore?: number;
  }>;
  issues: Array<{ issue: "generic-layout" | ... }>;
}
```

`minimumScores.distinctiveness?: number`，默认 72。达到目标时：

```ts
goal.distinctiveness === undefined ||
  review.distinctivenessScore === undefined ||
  review.distinctivenessScore >= goal.distinctiveness;
```

缺失分数不判失败，避免旧模型/旧夹具被误伤。

### 5.2 修复计划

```ts
repairs: Array<{
  slideIndex: number;
  layout?: LayoutKind;
  recipe?: RecipeId;
  backgroundAction: ...;
  hierarchyAction: ...;
  elementActions: ...;
  reason: string;
}>;
```

- 未知 recipe 丢弃；只有 recipe 的计划仍是有效计划。
- 修复提示词：换配方优先；换配方时不要叠加几何修复；可用配方列出七个。
- 模型输入每页 `{ index, title, layout, recipe? }`。

### 5.3 命令层

`design-quality-stage` 的 repair 映射：

```ts
return {
  ...slide,
  layout: repair.layout ?? slide.layout,
  ...(repair.recipe === undefined ? {} : { recipe: repair.recipe }),
  ...
};
```

命令层 `selectRecipe` 继续校验 content facts；不合法时走旧分支。内容指纹在修复前后比较，变化即拒绝。

### 5.4 循环

`runVisualAlignmentLoop` 的最佳版本：

```ts
if (
  review.overallScore > bestScore ||
  (review.overallScore === bestScore && (review.distinctivenessScore ?? -1) > (bestReview?.distinctivenessScore ?? -1))
) {
  bestValue = value;
  bestReview = review;
}
```

### 5.5 报告

- `mergeReviews` / `slideReviewFromBatch` / `batchReviewFromSlides` 聚合独特性；
- 评审说明追加“独特性”；
- `weakPages` 在分数存在时检查阈值；
- App `visualIssueLabels` 增加“版式过于通用”。

## 6. 实施步骤

1. 评分 schema、issue、goal、聚合、循环（0.5 人日）。
2. 修复 schema、规范化、提示词、当前配方输入（0.5 人日）。
3. 阶段写回 recipe、报告、App 标签（0.5 人日）。
4. 测试：旧响应兼容、generic-layout、recipe-only 修复、未知配方、tie-break、内容不变。
5. 文档与记录。

## 7. 测试与验收

| 文件                                        | 覆盖                                          |
| ------------------------------------------- | --------------------------------------------- |
| `src/services/visual-alignment.test.ts`     | 独特性阈值、recipe 规范化、未知配方、无效计划 |
| `src/services/design-quality-stage.test.ts` | recipe 写回设计、独特性修复、内容不变         |
| `src/services/ai-service.test.ts`           | 设计合同不受影响                              |
| `src/app/App.tsx`                           | `generic-layout` 标签                         |

### 验收标准

- **AC-1**：无 `distinctivenessScore` 的旧 review 仍通过 `normalizeVisualReview`。
- **AC-2**：`generic-layout` issue 可解析、可展示。
- **AC-3**：`{ slideIndex:0, recipe:"process-rail", reason:"..." }` 是合法修复。
- **AC-4**：未知 recipe 的计划被丢弃；没有其他动作时抛 `AI_REPAIR_RESPONSE_UNREPAIRABLE`。
- **AC-5**：stage 返回的 design 带 recipe；命令层可渲染，内容不变。
- **AC-6**：总分相同 + 独特性提高 → 保留修复后的 design。
- **AC-7**：内容指纹在修复前后一致。
- **AC-8**：报告出现独特性分数；低分页进入 weakPages。

## 8. 风险与回退

| 风险                       | 处理                                              |
| -------------------------- | ------------------------------------------------- |
| 模型给独特性分数过于宽松   | 阈值 72 先保守；真实样张校准                      |
| 换配方与模板版式意图不一致 | 命令层仍按内容校验；模板 `layoutIntents` 暂不跟随 |
| recipe 修复后内容装不下    | `selectRecipe` 拒绝，回退旧分支；内容不丢         |
| 旧测试/旧夹具无独特性      | 字段可选；缺失不判失败                            |
| 换配方后总分不升被回退     | tie-break 保留独特性更高的版本                    |

回退顺序：

1. 从 goal 移除独特性阈值；
2. 评审仍可返回分数，但不参与修复授权；
3. 修复计划忽略 recipe，保留旧 action。

## 9. 开放问题

1. 独特性 72 是否适合所有主题？先用默认值，按 10 页真实样张校准。
2. 换配方后是否应强制同轮重渲染？当前下一轮自然重渲染。
3. 模板页换配方时是否要同时换模板版式？当前只换内容容器。

## 实施记录（2026-10-24）

已落地：

- `visualReviewSchema` / `VisualReview` / `slideScores` 增加可选 `distinctivenessScore`；`minimumScores.distinctiveness` 默认 72。
- `generic-layout` issue、App 中文标签。
- `visualRepairPlanSchema` / `normalizeVisualRepairPlan` 增加可选 `recipe`；未知值丢弃；只有配方的修复有效。
- Rust 评审提示词增加独特性评分与 `generic-layout`；修复提示词增加 recipe 词汇、约束和输出示例；`PlanRepairSlide` 增加当前 `recipe`。
- `design-quality-stage` 把 recipe 写回设计、聚合独特性分数、weakPages 纳入阈值、报告显示独特性。
- `runVisualAlignmentLoop` 在总分相同、独特性更高时保留修复版本。
- 测试：独特性授权、recipe-only 修复、未知配方丢弃、stage 写回 recipe。

验证：

- `npm run typecheck`、`npm run lint`（仅既有 warning）、`npm run build` 通过。
- `PPTD_SKIP_VISUAL=1 npm test`：135 个测试文件、1063 项通过，1 项视觉回归按环境跳过。

未完成：

- 真实视觉模型对独特性分数的校准；当前只有合同与提示词，没有线上样本。
- 换配方后的模板 `layoutIntents` 跟随。
- 整册 `conceptFitScore` / 配方节奏评分。
