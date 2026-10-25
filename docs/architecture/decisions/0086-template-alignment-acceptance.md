# 0086：上传模板作为视觉验收目标

## 状态

已接受（2026-10-25）。

## 背景

模板已经参与生成：`analyze_pptx_template` 读出主题色、主次字体、版式占位符和装饰，`apply-ai-designed-draft` 用这些数据选版式、定标题轴、取模板墨色和字号。但质量验收没有接上同一份数据：

- 视觉评审的 `goal` 仍由 `defaultPresentationVisualGoal()` 生成，默认是 `editorial / modern / left-grid`；
- 评审提示词只拿到整册目标，没有模板的标题轴、内容区、字号和容差；
- 达标判断只看模型给出的 `alignmentScore` 等分数；
- 报告只写“对齐 90”，没有“是否贴合上传模板”。

于是出现一个错位：渲染图里有模板，模型也“看得见”模板，但它看到的是像素，不是可测量的轴线。页内整齐但整体偏离模板的页面仍可能拿到高分；默认目标甚至可能与模板本身冲突（例如模板是居中或正式风格）。

## 决策

### 1. 把模板编译成可测量的验收目标

新增 `src/services/template-review-target.ts`，从 `analyze_pptx_template` 的布局占位符编译 `TemplateReviewTarget`：

- `grid`：标题左轴、标题顶边、内容区左/右/上/下，全部归一化到 0–1 页面坐标；
- `layouts`：逐版式的网格、标题/正文字号，以及 `freeComposition` 标记；
- `palette`、`alignment`、`confidence`、`minimumFit`、`tolerances`。

模板样张不是规范：样张页经常被手工调整过，编译只使用版式占位符。封面、章节、引文、结束页由名称识别为 `freeComposition`，不按内容轴扣分；识别不到的页面按内容页处理。

### 2. 确定性检查负责“贴不贴模板”

新增 `checkTemplateFit(document, target)`，只做可从文档测量的事情：

- 标题左轴 / 顶边与模板标题区的偏差；
- 正文外接框是否越过模板内容区；
- 纯文本页的标题/正文字号是否偏离模板占位符字号；
- 输出稳定 code、页码、元素 id 和偏差值。

分数是报告用的摘要，判定以分项结果为准：任何 `error` 都不通过，分数还必须达到 `minimumFit`（高置信度 90，低置信度 85）。模板没有可用占位符时 `checked=false`，不能当作通过。

这不是模型评分。模型可以“觉得”一页很整齐，但不能把偏离模板轴线的页面判成已按模板验收。

### 3. 评审输入带上模板目标

`VisionReviewPort.review` / `reviewDeck` / `planRepairs` 增加可选 `template`，`TauriVisionReviewPort` 把它序列化进请求；Rust 侧 `ReviewVisualsRequest` 和 `PlanRepairsRequest` 接收并写入提示词：

- 逐页评审：`alignmentScore` 必须体现模板轴线和内容区；偏离模板轴线的页面不得高于 79 分，并报告 `misalignment`；
- 整册评审：一致性、主题匹配和节奏要贴合模板；
- 修复计划：`align` / `move` 的最终位置必须落回模板标题区或内容区。

模型仍然不输出任意坐标；它给意图，确定性排版和修复命令给坐标。

### 4. 达标判断与修复

`runDesignQualityStage` 每轮在渲染评审的同一份文档快照上运行 `checkTemplateFit`，把模板问题并入 `VisualReview.issues`，并把 `templateFitScore` 写进本轮结论。这样：

- `runVisualAlignmentLoop` 的 `reached` 条件要求 `templateFitScore` 达到 `goal.minimumScores.templateFit`；
- `visualPassed` 还要求模板检查已执行、分数达标且没有硬性偏差；
- 修复只允许评审点名的页面变化；
- 标题轴偏差由确定性 `move` 回到模板标题区，即使修复模型漏掉这条也不会把偏离留到下一轮。

模板目标存在但无法编译时，阶段标记为降级，`visualPassed` 为 false，报告明确写“模板符合度未执行”。

### 5. 报告

质检报告新增“模板符合度”：

- 模板名、得分/阈值、偏差数量、版式覆盖页数；
- 逐条偏差及对应页码；
- 与“视觉评审建议”“确定性质量门”分开显示，不合并成一个成功状态。

## 影响

- 上传模板从“生成素材”变成“验收目标”；同一份模板分析同时约束生成、评审、修复和报告。
- 默认 `goal` 不再吞掉模板的轴线语言：有模板时 `alignment` 和 `minimumScores.templateFit` 从模板派生。
- 预设模式不受影响：没有模板目标时仍使用原 `defaultPresentationVisualGoal()`。

## 边界

- 只覆盖可测量的几何与字号。装饰、图片内文字、色彩观感仍由视觉评审负责；`palette` 目前只进入提示词，没有做严格的色板硬判定。
- 模板没有标题/内容占位符（例如纯图片模板）时，编译失败，不能声称按模板验收。
- 仍不做像素对比：内容不同，生成页和模板样张永远不可能逐像素一致。
- 模板目标当前在生成流程内传入。重新打开项目后的手动复检需要重新分析模板；把契约按模板哈希持久化是后续工作。
- 阈值是经验值，先锁定 0.01 页宽（标题左轴/内容边距）、0.005 页高（标题顶边）、1.5pt（字号），需要真实模板回归校准。

## 验证

- `template-review-target.test.ts`：网格编译、字号、轴语言、标题轴偏差、正文越界、封面自由构图、目标继承。
- `design-quality-stage.test.ts`：模板传入评审、修复计划拿到目标、模型全维度通过但模板不符合时 `visualPassed=false`。
- `visual-alignment.test.ts`：`templateFitScore` 低于阈值时循环不算达标。
- `vision-review-port.test.ts`、`manual-visual-review.test.ts`：端口和手动复检仍通过。
- Rust `cargo check` 通过；全量 `vitest` 通过（除一条与本改动无关的导出视觉回归基线差异）。
