# 0066：视觉评审换配方与独特性评分

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-005](../development/tasks/0015-visual-review-recipe-change.md)。

## 背景

ADR 0046 把视觉评审从“只修整齐”推进到“能要求换配方”，但落地一直停在生成侧：

- 评审指标是层级、对齐、可读性、一致性；等权卡片阵列只要对齐就能拿到不低的分数；
- 修复动作只有 move / resize / restyle / align / changeLayout，不能换 `recipe`；
- 修复计划不知道页面当前用了什么配方，模型只能反复微调同一张卡；
- 结果是“评审能看出平庸，但没有词汇和动作去改变它”。

现在 `editorial-index`、`asymmetric-split`、`data-story`、`process-rail`、`comparison` 都已可渲染，评审侧需要一条“换一个设计想法”的闭环。

## 决策

### 1. 增加 `distinctivenessScore`

- `VisualReview` 增加可选 `distinctivenessScore`（0–100），逐页 `slideScores` 也带可选值；
- 评审提示词要求：等权卡片阵列、同一骨架重复、没有第一视觉入口时不得高于 69，并报告 `generic-layout`；
- `minimumScores.distinctiveness` 默认 72，但可选：模型没有返回该分数时不据此判失败，旧评审继续有效；
- 逐页低分和整册低分都进入可修复范围。

### 2. 修复计划增加 `recipe`

- `VisualRepairPlan.repairs[]` 增加可选 `recipe`，取值是已实现的七个配方；
- 修复提示词说明：换配方优先于逐块微调；换配方时不要再叠加 `elementActions` 的几何修复；
- 模型输入增加每页当前 `recipe`，避免“不知道现在是什么配方”；
- 未知配方丢弃；只有配方、没有其他动作的修复仍算有效修复；
- 命令层继续用 `selectRecipe` 校验内容是否装得下；不合法时回退旧分支，不丢内容。

### 3. 修复循环保留“更有想法”的版本

- 原循环只按 `overallScore` 选最佳版本；一个换配方修复如果总分不变、独特性提高，会被回退。
- 新规则：总分相同且 `distinctivenessScore` 更高时，保留修复后的版本；
- 达到目标仍要求所有已评分的阈值都过；缺失独特性分数不阻塞。

### 4. 质量报告

- 评审说明增加独特性分数；
- `weakPages` 在分数存在时纳入独特性阈值；
- `generic-layout` 进入 App 的问题标签。

## 边界

- 内容仍然只读；换配方只改设计。
- 模型不输出坐标、字号或颜色值；配方只能选枚举。
- 配方不合法时命令层回退旧分支，评审报告保留建议。
- 旧 `VisualReview`（无独特性）和旧修复计划（无配方）继续可用。
- 视觉评审仍不阻塞出稿（ADR 0015）。

## 结果

- 评审第一次能把“这页太通用”变成“换成 `process-rail` / `comparison` / `editorial-index`”的可执行动作。
- 生成侧已有的配方库被评审闭环真正用起来，而不是只在首次生成时选一次。
- 换配方不会改内容；失败时仍有旧分支兜底。
- 评分缺失时保持向后兼容，不伪造分数。

## 未覆盖

- `conceptFitScore`、整册级“配方节奏”评分。
- 换配方后的定点重渲染/复检优化；当前仍按整轮评审走。
- 模板页换配方时的模板版式意图（`layoutIntents`）尚未跟着配方调整。
- 评审模型对 `distinctivenessScore` 的校准仍需真实 10 页样张验证。
