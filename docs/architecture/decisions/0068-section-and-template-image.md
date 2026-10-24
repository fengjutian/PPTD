# 0068：章节页与模板图片配方

## 状态

已接受（2026-10-24）。实施见 [TASK-DESIGN-007](../development/tasks/0017-section-and-template-image.md)。

## 背景

- `section` 页仍走旧分支：长 deck 没有专门的章节构图，削弱了整册节奏。
- `image-led` 只接受无模板底图的页面；模板即使有图片占位，生成图也无法落到模板的图框里。
- 模板分析已经能产出 `role: "image"` 区域，命令层只是没有使用它。

## 决策

### 1. `section-statement`

- 仅用于 `layout === "section"`，且没有模板底图 / 模板版式；
- 左侧 0.32 页宽 accent 竖栏，栏内大号页序号 92pt、白色；
- 右侧标题 28–40pt、accent 短线、说明 14–20pt；
- 标题/说明必须能放进右侧区域，否则返回 conflict 回退旧分支；
- `consumed.title/body` 为 true，块 ID 为空；内容不改。

### 2. 模板页 `image-led`

- 模板分析已有 `image` region；新增 `templateImageRegion()` 读取它。
- `RecipeSupportOptions` 增加 `hasTemplate`、`hasTemplateImage`；`RecipeContext` 增加 `templateImage`。
- `image-led` 支持两种图框：
  - 无模板：右侧 48% 的固定图框；
  - 有模板图片占位：使用模板 `image` region 作为 `imageFrame`，文字使用模板 title/body 占位。
- `image-led.supports`：有底图但没有模板图位时拒绝；有图位时允许。
- 模板意图增加 `"image"`：`design.recipe === "image-led"` 或 `design.visualAsset.enabled` 的页面优先选择带图片占位的版式；没有这种版式时回退普通正文版式，配方再被 `supports` 拒绝，旧分支兜底。
- 命令层把 `templateImage` 传给配方；配方返回的 `imageFrame` 仍由命令层重设图片框并重算裁剪。

### 3. 图片页要点排版

`image-led` 的要点从“内容区等分”改为 `layoutFlow` 测量成组：统一字号、10–28pt 行距、放不下返回 conflict。这样模板图文页的三条要点不会再被拉成 1.5in 行距。

## 边界

- 模板背景、Logo、装饰、页脚仍由现有逻辑处理；配方只追加内容/图片框。
- 内容不可变；`consumed.blockIds` 守住 block。
- 模板没有图片占位时仍走旧分支，不硬把生成图压到正文上。
- 模型不输出坐标/字号。

## 结果

- 预设章节页有稳定的深色竖栏 + 大序号 + 标题 + 说明。
- 模板图文页能把生成图放进模板图框，文字收在模板 body 占位。
- 模板意图能优先选择带图片占位的版式；没有时安全回退。
- 图片页要点不再等分拉长。

## 实施结果（2026-10-24）

- 预设章节样张：accent 竖栏、92pt 页序号、标题、短线、说明；无底图/模板时生效。
- 模板图文样张：生成图落在模板 `image` region（0.54/0.12/0.4/0.7），文字在模板 body 占位；三条要点按测量行距排列。
- 模板意图 `"image"` 优先选带图位的版式；没有图位时回退正文版式，配方拒绝后走旧分支。
- 全量前端测试 1074 项通过；类型检查、Lint、构建、`cargo fmt --check`、`cargo check` 通过。视觉回归仍按环境跳过。

## 未覆盖

- 模板图片占位与模板装饰重叠时的避让；当前依赖模板分析的安全区。
- 章节序号是否应使用“第几个章节”而不是页序号；当前使用页序号。
- 模板封面/引文的图片占位。
- 真实 AI 生图与模板图框比例的批量校准。
