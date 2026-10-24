# TASK-DESIGN-010：设计计划编译器与模板内容区接管

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）                                  |
| 优先级   | P0                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 2–3 人日                                                  |
| 依赖     | ADR 0070、ADR 0069、ADR 0068、ADR 0063                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景

AI 目前只输出 layout/recipe；`commands.ts` 的 5000 行分支决定几何；模板页只是把字填进卡片。设计思想要变成“AI 艺术指导、代码几何”，需要先建立语义设计计划和编译器。

## 2. 目标

1. 定义 `PageDesignPlan`：role / composition / density / templatePolicy / recipe / focal / emphasis。
2. 新增 `compileDesignPlan`：计划 → 配方校验 → 元素。
3. `templatePolicy: "takeover"`：保留页眉/Logo/页脚，覆盖模板正文卡片。
4. AI 合同接受可选 `designPlan`；旧响应不变。
5. 计划失败回退旧分支，内容不丢。

## 3. 范围

### 3.1 包含

- `src/core/design/design-plan.ts`
- `src/core/layout/design-compiler.ts`
- `AiSlideDesign.designPlan`、zod schema、Rust 提示词
- 命令层接入、takeover 内容面、ink 推导
- 单元/命令/AI schema 测试、ADR、任务文档

### 3.2 不包含

- `emphasis` / `focal` 的编译消费
- `DesignPatch` 视觉评审回写
- `templatePolicy: "ignore"` 的完整实现
- 原生 chart/diagram 的 focal 编译
- 真实模型输出校准

## 4. 功能需求

| ID   | 需求                                        | 验收 |
| ---- | ------------------------------------------- | ---- |
| FR-1 | 计划角色 + facts 能选出合法配方             | AC-1 |
| FR-2 | 计划配方不支持内容时返回 conflict，不写半页 | AC-2 |
| FR-3 | takeover 在正文区画内容面，覆盖模板卡片     | AC-3 |
| FR-4 | takeover 保留页眉/Logo/页脚                 | AC-4 |
| FR-5 | 内容面为深色时正文 ink 翻为浅色             | AC-5 |
| FR-6 | `templatePolicy: "use"` 不画内容面          | AC-6 |
| FR-7 | 旧设计无 designPlan 行为不变                | AC-7 |
| FR-8 | 内容逐字保留，`consumed` 通过               | AC-8 |

## 5. 技术设计

### 5.1 计划

```ts
type DesignRole = "cover" | "section" | "claim" | "comparison" | "process" | "timeline" | "quote" | "summary";
type DesignPrimitive = "split" | "stack" | "grid" | "rail" | "overlay" | "band";
type TemplatePolicy = "use" | "takeover" | "ignore";
```

### 5.2 编译器

```ts
compileDesignPlan(input): RecipePlan | { conflict }
```

- `planRecipe()`：role → recipe；facts 决定 claim 的 editorial/asymmetric/data-story；
- `recipe.supports()` 硬校验；
- takeover 时先生成 `surface`，再以 surface 内缩区域作为 chrome.content/frame.content；
- 深色 surface 下 body ink 改为 `#DCE3EA`，accent 过暗时也提亮；
- 返回 `[surface, ...recipe.elements]`。

### 5.3 命令层

- `design.designPlan` 存在 → 编译器；
- 编译器 conflict/无 concept → 旧分支；
- `consumptionProblem` 仍然守卫内容；
- `recipePlan.imageFrame` 逻辑不变。

### 5.4 AI 合同

- `AiSlideDesign.designPlan?`；
- zod `pageDesignPlanSchema`；
- Rust 提示词增加 designPlan 字段、role/primitive/templatePolicy 规则和 takeover 示例；
- 旧响应不要求该字段。

## 6. 测试

| 文件                                      | 覆盖                                    |
| ----------------------------------------- | --------------------------------------- |
| `src/core/layout/design-compiler.test.ts` | 计划→配方、takeover、ink、use、conflict |
| `src/core/commands/commands.test.ts`      | 命令层 takeover、内容保留、内容面覆盖   |
| `src/services/ai-service.test.ts`         | designPlan 可选字段解析                 |

### 验收标准

- **AC-1**：claim + 长要点 → asymmetric-split；短要点 → editorial-index。
- **AC-2**：claim + process-rail 但无 process → conflict。
- **AC-3**：takeover 首元素（配方前）为内容面，覆盖正文区。
- **AC-4**：页眉/Logo 图形仍在内容面上方可见（样张目视）。
- **AC-5**：深色 surface 下正文颜色不等于模板 bodyColor。
- **AC-6**：use 不产生内容面。
- **AC-7**：无 designPlan 的既有 1000+ 测试不变。
- **AC-8**：标题/正文逐字一致，`consumed` 通过。

## 7. 实施记录（2026-10-24）

- 新增 `PageDesignPlan` + `compileDesignPlan` + `planRecipeId`。
- 命令层接入；takeover 时内容面覆盖模板正文卡片，保留页眉/Logo/页脚。
- `RecipeContext.colors` 在 takeover 下重新推导 body/accent。
- AI schema 与 Rust 提示词增加可选 designPlan。
- 样张：`.tmp/render19/p1.png`；模板两张白卡被覆盖，改为非对称要点，页眉/Logo 保留。

验证：

- `npx vitest run src/core/layout/design-compiler.test.ts`：4 项通过。
- `npx vitest run src/core/commands/commands.test.ts`：136 项通过。
- 全量：137 个测试文件、1085 项通过，1 项视觉回归按环境跳过；类型检查、Lint、生产构建、`cargo fmt --check`、`cargo check` 通过。

## 8. 未完成

- `emphasis` / `focal` 尚未编译；目前只进入合同。
- `DesignPatch` 评审回写。
- `templatePolicy: "ignore"`。
- takeover 内容面是纯色，未保留模板纹理。
- 真实模型对 designPlan 的输出稳定性。
