# 0070：设计计划编译器与模板内容区接管

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-010](../development/tasks/0020-design-plan-compiler.md)。

## 背景

前几轮把“配方”补全了，但页面生成仍有两个结构性问题：

- `commands.ts` 用 5000 行 `layout` 分支决定几何，AI 只能选配方，不能表达“这页的论证方式”；
- 模板页把文字填进模板卡片。模板卡片、网格背景是固定 artwork，文字再精致也只是“往卡片里填字”。

这与“AI 做艺术指导、代码做几何与一致性”的目标相反。

## 决策

### 1. AI 写 `PageDesignPlan`，不写坐标

```ts
interface PageDesignPlan {
  role: "cover" | "section" | "claim" | "comparison" | "process" | "timeline" | "quote" | "summary";
  composition: { primitive: "split" | "stack" | "grid" | "rail" | "overlay" | "band"; ratio?: number };
  density: "sparse" | "normal" | "dense";
  templatePolicy: "use" | "takeover" | "ignore";
  recipe?: RecipeId;
  focal?: { kind: "title" | "number" | "image" | "chart" | "none"; blockId?: string; brief?: string };
  emphasis?: Array<{ blockId: string; start: number; end: number }>;
}
```

- `role` 表达这页在论证里的角色；
- `composition` 表达骨架，不是成品配方；
- `templatePolicy` 决定模板是“使用”还是“接管”；
- `recipe` 只是首选，编译器仍会按内容事实校验；
- `emphasis` 只引用已审核文本的字符范围。

### 2. `compileDesignPlan` 是唯一的几何入口

新增 `src/core/layout/design-compiler.ts`：

- 按 `role` + facts 选择配方（也可用 `plan.recipe`）；
- 用 `recipe.supports` 校验内容能否承载；
- 调 `recipe.plan` 得到元素；
- 所有页面仍走 `PageChrome` 的标题轴/内容区；
- 冲突时返回 conflict，命令层回退旧分支，不写半页。

### 3. 模板内容区接管

`templatePolicy: "takeover"` 时：

- 保留模板页眉、Logo、页脚；
- 在模板正文区画一块干净的内容面（设计背景色）；
- 内容面内重新计算 title/content 安全区，再交给配方构图；
- 根据内容面亮度重新推导正文 ink，避免“白卡片上的深色字被搬到深色面上”；
- 先画内容面，再画配方元素，保证覆盖顺序。

这不是“删除模板”，而是把模板从“内容容器”降级为“品牌框架”。

### 4. AI 合同

`AiSlideDesign` 增加可选 `designPlan`；`aiPresentationDesignSchema` 增加对应 zod schema；Rust 设计提示词增加 designPlan 字段和 takeover 规则。

旧设计没有 `designPlan`，继续走配方/旧分支；模型不输出时行为不变。

### 5. 回退

- 计划缺 role/recipe → 编译器 conflict → 旧分支；
- 配方不支持内容 → 旧分支；
- 无 `designConcept` → 旧分支；
- `templatePolicy: "use"` → 不加内容面，保持原模板。

## 结果

- AI 第一次可以表达“这页是 claim、用 split、接管模板内容区”，而不是只选一个 recipe。
- 模板卡片页可以在保留页眉/Logo 的前提下换成干净编辑式构图。
- 设计计划与几何分离，后续可以加 focal/emphasis/asset patch，而不改命令分支。
- 旧页面、旧模型响应、无概念路径保持兼容。

## 未覆盖

- `emphasis` / `focal` 目前只进入合同，编译器尚未消费；
- `templatePolicy: "ignore"` 只是保留值，尚未实现完全忽略模板；
- takeover 的内容面是纯色，不保留模板纹理；
- 还没有 `DesignPatch` 评审回写；
- 真实模型对 `designPlan` 的输出稳定性未校准。

## 实施结果（2026-10-24）

- 新增 `PageDesignPlan`、`compileDesignPlan`、`planRecipeId`。
- 命令层在 `design.designPlan` 存在时走编译器；否则保持配方/旧分支。
- 模板 takeover 样张：原模板两张白色卡片被内容面覆盖，标题保留在模板标题区，右侧改为非对称要点；正文 ink 自动翻为浅色。
- 测试：编译器 4 项、命令接管 1 项、AI schema 1 项；全量通过。
