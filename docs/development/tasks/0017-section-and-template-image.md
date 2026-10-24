# TASK-DESIGN-007：章节页与模板图片配方

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（P1，2026-10-24）                                  |
| 优先级   | P1                                                        |
| 里程碑   | V0.4 设计能力                                             |
| 预估     | 2–3 人日                                                  |
| 依赖     | ADR 0068、ADR 0067、ADR 0064、ADR 0046                    |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent、4.2 内容/设计隔离 |

## 1. 背景与问题

- `section` 页仍走旧分支，长 deck 没有专门的章节构图；
- `image-led` 只接受无模板底图的页面，模板有图片占位时生成图无处可放；
- 模板分析已经能产出 `image` region，命令层没有使用；
- `image-led` 的要点仍按内容区等分，三条要点会被拉成 1.5in 行距。

## 2. 目标

1. 新增 `section-statement`，覆盖预设章节页；
2. 模板有图片占位时，`image-led` 使用模板图框；
3. 模板意图优先选择带图片占位的版式；
4. 图片页要点按测量成组；
5. 内容不丢、模板底图/Logo/装饰不变。

## 3. 范围

### 3.1 包含

- `section-statement` 配方、注册表、概念预设、zod/提示词、自动选择。
- `templateImageRegion()`；`TemplateLayoutIntent` 增加 `"image"` 与候选/评分。
- `RecipeSupportOptions.hasTemplate/hasTemplateImage`、`RecipeContext.templateImage`。
- `image-led` 模板图框、模板文字区、`layoutFlow` 要点排版。
- 测试、样张、文档。

### 3.2 不包含

- 模板图片占位与装饰重叠的自动避让。
- 章节序号按“第几个章节”计数。
- 模板封面/引文图位。
- 真实 AI 生图比例批量校准。

## 4. 功能需求

| ID   | 需求                                                  | 验收 |
| ---- | ----------------------------------------------------- | ---- |
| FR-1 | 预设 `section` 页生成 accent 竖栏、大序号、标题、说明 | AC-1 |
| FR-2 | 模板有 image region 时 `image-led` 使用该图框         | AC-2 |
| FR-3 | 模板意图 `"image"` 优先选带图片占位的版式；没有时回退 | AC-3 |
| FR-4 | 图片页要点按测量行高排，不等分                        | AC-4 |
| FR-5 | 内容 `consumed` 通过，内容哈希/审核状态不变           | AC-5 |
| FR-6 | 无概念/无模板旧输出不变                               | AC-6 |
| FR-7 | 导出图片/文本为原生对象，页数/版式引用不变            | AC-7 |

## 5. 技术设计

### 5.1 section-statement

```text
accent panel 0–0.32
  page number 92pt white x0.055 y0.3
title 0.4/0.26 w0.52 h0.28, 28–40pt
rule 0.4/0.56 w0.12
body 0.4/0.6 w0.52, 14–20pt
```

`supports`：`layout === "section"`、无 asset、无 artwork、无 template。
`consumed`：title/body true；blockIds 空。

### 5.2 template image

```ts
export function templateImageRegion(layout: AiTemplateLayout): AiTemplateRegion | undefined;
```

- `RecipeContext.templateImage`：模板图片占位。
- `RecipeSupportOptions.hasTemplateImage`：是否有图位。
- `image-led.supports`：`hasAsset && (!hasArtwork || hasTemplateImage)`。
- `image-led.plan`：`imageFrame = templateImage ?? IMAGE`；文字区用模板 title/body（`chrome`）。
- 命令层 `layoutIntents`：`design.recipe === "image-led" || design.visualAsset?.enabled` → `"image"`。
- `templateLayoutCandidates("image")`：优先有 image region + content region 的版式；否则回退宽正文版式。

### 5.3 image-led 要点

用 `layoutFlow`：preferred `bodyPt + 2`，min 12，行距 10–28pt，`verticalAlign: "top"`；溢出 conflict。

## 6. 实施步骤

1. `section-statement` + 测试。
2. `templateImageRegion`、类型、模板意图、候选/评分 + 测试。
3. `image-led` 模板图框 + 测试。
4. `image-led` 要点 `layoutFlow` + 测试。
5. 命令集成、导出/样张、文档。

## 7. 测试与验收

| 文件                                           | 覆盖                                    |
| ---------------------------------------------- | --------------------------------------- |
| `src/core/layout/recipes/recipes.test.ts`      | 章节配方、模板图框、图片要点、消费      |
| `src/core/layout/recipes/plan.test.ts`         | section 选择                            |
| `src/core/commands/template-layouts.test.ts`   | image 意图候选/评分                     |
| `src/core/commands/commands.test.ts`           | 章节命令、模板图位命令、图片框 OCR 几何 |
| `src/features/pptx-export/export-pptx.test.ts` | 导出（沿用现有模板配方夹具）            |

### 验收标准

- **AC-1**：预设章节页出现 accent 面板、`01`、标题、说明。
- **AC-2**：模板图文页的生成图 frame 等于模板 image region。
- **AC-3**：`templateLayoutCandidates("image")` 优先 image 版式；无图位时回退 body。
- **AC-4**：3 条图片页要点的行距 ≤0.1 页高，且不重叠。
- **AC-5**：`consumed` 通过；内容指纹前后一致。
- **AC-6**：无 `designConcept` 输出不变。
- **AC-7**：导出页数/版式引用/原生对象计数正确。

## 8. 风险与回退

| 风险                 | 处理                                                           |
| -------------------- | -------------------------------------------------------------- |
| 模板图位压住正文     | 模板分析应给出 body 与 image 分离；冲突时 recipe supports 拒绝 |
| 章节序号语义不对     | 当前用页序号；后续可改为章节计数                               |
| 模板有图位但没生成图 | `hasAsset` false → 旧分支，不画空图框                          |
| 章节页模板有底图     | `section-statement` 拒绝，走模板自己的章节版式                 |

回退：从概念预设移除 `section-statement`；`image-led` 恢复拒绝 artwork；模板意图删除 `"image"`。

## 9. 开放问题

1. 章节序号是否应改成章节计数？需要内容模型有章节序号。
2. 模板图位与装饰重叠时是否需要 obstacle 检测？当前依赖模板分析。
3. 模板图位是否支持 `band` / full-bleed？当前只支持一个图位。

## 实施记录（2026-10-24）

已落地：

- `section-statement` 配方：accent 面板、92pt 页序号、28–40pt 标题、说明；预设路径生效，模板/底图页拒绝。
- `templateImageRegion()`；`TemplateLayoutIntent` 增加 `"image"`，候选/评分优先图片版式。
- `RecipeContext.templateImage`、`RecipeSupportOptions.hasTemplate/hasTemplateImage`。
- `image-led` 使用模板图框，文字走模板 title/body；无模板图位时保留右半页图框。
- `image-led` 要点改用 `layoutFlow`，行距 10–28pt。
- 命令层 `layoutIntents`：图片页优先选择带 `image` region 的模板版式；没有时回退 body。
- 测试：章节配方、模板图框、模板意图候选、命令集成。

验证：

- 预设章节样张：左侧 accent 面板 + `01` + 标题 + 短线 + 说明。
- 模板图文样张：生成图落在模板 image region（0.54/0.12/0.4/0.7），文字在模板 body 占位；三条要点行距明显缩小。
- `npm run typecheck`、`npm run lint`、`npm run build`、`cargo fmt --check`、`cargo check` 通过。
- 全量前端测试通过（135 文件、1074 项）；视觉回归仍按环境跳过。

未完成：

- 章节序号仍用页序号，不是章节计数。
- 模板图位与装饰重叠的 obstacle 检测。
- 模板封面/引文图位。
- 真实 AI 生图图框比例批量校准。
