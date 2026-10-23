# 领域模型与版本规则

## 1. 聚合边界

`PresentationDocument` 是单次编辑事务的聚合根。`Slide`、`SlideElement`、`ContentItem`、`Theme` 和 `Scene3D` 只能通过文档命令变更，所有跨对象引用使用稳定 ID。

```ts
interface PresentationDocument {
  id: DocumentId;
  schemaVersion: number;
  title: string;
  pageSize: SizeEmu;
  revisions: { document: number; content: number; design: number };
  content: ContentModel;
  design: DesignModel;
  slides: Slide[];
  scenes3d: Record<SceneId, Scene3D>;
  assets: Record<AssetId, AssetMetadata>;
  source?: ImportSource;
  compatibility?: CompatibilityReport;
}
```

生产类型使用带品牌的 ID 和 EMU 整数类型，禁止用数组位置充当标识。所有可选字段必须有明确的缺省语义，避免 `null`、缺字段和空字符串表示三个不同状态。

## 2. 内容与设计的引用关系

内容块是语义事实，页面元素是呈现形式。`SlideElement.sourceContentId` 将一个呈现元素关联到内容块。允许一个内容块映射为多个视觉元素；删除最后一个映射时只删除呈现，除非用户明确发出内容删除命令。

| 内容字段                   | 设计字段                      |
| -------------------------- | ----------------------------- |
| 标题、正文、数值、表格数据 | 坐标、尺寸、旋转、层级        |
| 图表语义数据               | 图表类型、配色、标签样式      |
| 引用、来源、备注           | 字体、颜色、间距、背景        |
| 页面语义顺序               | 版式、图片裁剪、阴影、3D 引用 |

## 3. 强类型元素

```ts
type SlideElement =
  TextElement | ShapeElement | LineElement | ImageElement | TableElement | ChartElement | GroupElement | Scene3DElement;

interface ElementBase {
  id: ElementId;
  frame: RectEmu;
  rotationMilliDegree: number;
  zIndex: number;
  locked: boolean;
  sourceContentId?: ContentId;
  /** generated = 版式生成器创建；user = 用户手工创建。旧文档可缺省。 */
  origin?: "generated" | "user";
}
```

每个联合成员拥有自己的 `style` 和数据结构，不使用无约束的 `Record<string, unknown>`。颜色、线型、字体、裁剪、对齐等均定义为可校验值对象。

线条是独立成员而不是"很扁的矩形"：它没有填充，只有描边色、线宽、两端箭头和虚线标志。导出时写成原生线条对象，箭头与虚线必须真的进入 OOXML，不能只留在画布上。详见 [0038 线条是独立元素类型](decisions/0038-line-element-and-fit-to-window.md)。

`origin` 只用于设计层重排，不参与内容哈希。缺少该字段的旧文档按保守规则推断来源；无法证明属于生成构图的对象必须保留。设计层重排复用已审核的 `slide.content`，不改变内容 revision，也不能覆盖用户添加的图片或文本。详见 [0007 内容感知的版式选择](decisions/0007-content-aware-layout-selection.md)。

## 4. 命令与不变量

首期命令至少包括：

- `CreateSlide`、`DeleteSlide`、`MoveSlide`
- `AddElement`、`DeleteElements`、`DuplicateElements`
- `TransformElements`、`ReorderElements`、`SetElementLock`
- `EditText`、`SetTextStyle`、`FitText`、`SetTextEmphasis`、`ClearTextEmphasis`、`SetShapeStyle`、`SetImageCrop`
- `SetPageSize`、`ApplyThemeTokens`
- `ApproveSlideContent`、`ReopenSlideContent`

每个命令声明影响域：`content`、`design` 或两者。处理器必须保证以下不变量：

1. 所有 ID 在文档内唯一，所有引用均能解析。
2. 页面顺序和元素层级是确定的，不依赖对象枚举顺序。
3. 长度为有限范围内的 EMU 整数；宽高必须为正数。
4. 被锁定元素不能被普通编辑命令修改。
5. 设计命令不能改变内容文本、数值、来源、备注和页面语义顺序。
6. 已审核内容被内容命令修改后，状态变为 `changed` 或 `needs_review`。
7. 资源引用计数为零后才能由资源清理任务删除物理文件。

## 5. Revision 规则

| 变更                         | document | content | design |
| ---------------------------- | -------: | ------: | -----: |
| 修改正文或业务数据           |       +1 |      +1 |      0 |
| 新增/删除/调整语义页面       |       +1 |      +1 |      0 |
| 移动、缩放、换色、换版式     |       +1 |       0 |     +1 |
| 同时拆页并重新排版           |       +1 |      +1 |     +1 |
| 选择、缩放视口等瞬时 UI 状态 |        0 |       0 |      0 |

AI 设计任务记录开始时的三个 revision。应用结果前必须比较 `content` revision；不一致时转为冲突结果并重新评估受影响页面，禁止覆盖新内容。

## 6. 撤销、历史与迁移

一次用户意图对应一个事务和一个撤销项。撤销项保存正向/反向 patch、命令摘要、时间和影响域。自动保存不创建撤销项。

持久化文档必须先通过 Schema 校验，再按 `schemaVersion` 顺序迁移。迁移函数保持纯函数、可重复执行且有固定样例测试。未来版本只保证向前迁移，不直接降级覆盖旧文件；需要降级时另存副本。

## 7. 内容哈希

内容审核快照对规范化内容计算哈希。规范化过程固定字段顺序、统一换行和 Unicode 形式，并排除坐标、字体、颜色等设计字段。这样主题和排版调整不会使已审核内容失效。

## 8. 模板主题与版式绑定（V0.1 已实现）

第 3 版文档在聚合根上保存模板主题和模板版式，页面通过 `layoutId` 指向它所依据的版式：

```ts
interface PresentationDocument {
  // …
  theme?: { name: string; majorFont: string; minorFont: string; colors: Array<{ name: string; value: string }> };
  layouts?: Array<{ id: string; name: string; backgroundColor?: string }>;
}

interface Slide {
  // …
  layoutId?: string;
}
```

两者都是设计态：修改主题或版式绑定只增加 design revision，不触碰内容哈希。`Slide.layoutId` 必须能在 `layouts` 中解析，否则 Schema 拒绝该文档。

版式的整页画面是图片元素，带 `placement: "layout-background"`。画布把它画在页面底层，导出把它放进母版背景，页面上不再重复绘制这张图片。用户为单页设置的背景图片使用 `placement: "slide-background"`，作为锁定的页级图片保留在内容对象下方并原生导出；它可以覆盖母版画面，但不会修改母版。详见 [0008 模板主题与版式落地到导出的 PPTX](decisions/0008-template-master-and-theme-export.md)。

## 9. 图表元素（V0.1 已实现）

图表的数字属于内容，图表的样式属于设计。`ChartElement` 因此不保存数值，只保存它引用了哪些指标块：

```ts
interface ChartElement extends ElementBase {
  type: "chart";
  contentBlockIds: string[];
  kind: "column" | "bar" | "line" | "pie";
  style: ChartElementStyle;
}
```

`resolveChartData` 从 `slide.content.blocks` 里读回这些指标的标签和数值。只有纯数字且单位一致的指标才能成图；否则图表无法解析，导出前检查会报 `invalid-chart-data` 并阻止导出。

新增图表元素使持久化格式升到第 5 版，迁移与固定样例见 `src/core/document-model/__fixtures__/v4-document.json`。详见 [0010 数值指标渲染为原生图表](decisions/0010-native-chart-for-metrics.md)。

## 10. 表格元素（V0.1 已实现）

表格的单元格属于内容，表格的样式属于设计。与图表同理，`TableElement` 不复制单元格，只保存它引用了哪个表格块：

```ts
interface TableElement extends ElementBase {
  type: "table";
  contentBlockId: string;
  style: TableElementStyle;
}
```

表格数据由新的内容块 `table-data` 承载，它带表头和若干行：

```ts
{ id: string; type: "table-data"; header: string[]; rows: string[][] }
```

`resolveTableData` 从 `slide.content.blocks` 里读回表头和行。块缺失、类型不对、表头为空或没有行时表格无法解析，导出前检查会报 `invalid-table-data` 并阻止导出。

新增表格元素使持久化格式升到第 7 版，`6 → 7` 迁移与固定样例见 `src/core/document-model/__fixtures__/v6-document.json`。详见 [0012 表格数据渲染为原生表格](decisions/0012-native-table-for-tabular-data.md)。

## 11. 文字片段（V0.1 已实现）

文字属于内容，片段的样式属于设计。`TextRun` 因此不复制文字，只用偏移量指向文本里的一个区间：

```ts
interface TextRun {
  start: number;
  end: number;
  bold?: boolean;
  color?: string;
  underline?: boolean;
}

interface TextElement extends ElementBase {
  type: "text";
  text: string;
  contentRef?: TextContentRole;
  style: TextElementStyle;
  runs?: TextRun[];
}
```

`textFragments` 把文字切成片段，`resolveFragmentStyle` 决定每段的最终样式：片段提到的属性以片段为准，没提到的以元素为准。片段不参与内容哈希，因此强调是设计态；正文被改写时（`edit-text`）片段被清空，因为偏移量已经指向了旧正文。

导出把有片段的文本写成原生 run，导出前检查不阻止导出——片段是装饰，缺了片段只是少一处强调，不会让文件不可用。

新增片段使持久化格式升到第 8 版，`7 → 8` 迁移与固定样例见 `src/core/document-model/__fixtures__/v7-document.json`。详见 [0013 文字片段级样式](decisions/0013-styled-text-fragments.md)。

## 12. 文字度量与适配（V0.1 已实现）

核心层不测量字体，只声明一个端口，由运行中的应用注入实现：

```ts
interface TextMeasurer {
  /** The width of the text in em, relative to the font size. */
  widthEm(text: string, fontFamily: string): number;
}
```

宽度用 em 表示，与字号解耦：同一段文字测一次即可用于所有候选字号。应用层提供基于 canvas 的适配器（`src/services/text-metrics-canvas.ts`），在 100px 下测量后换算为 em，并按 `字体 + 文本` 缓存。没有注册 measurer 时，度量回退到固定启发式（CJK 1 em、拉丁 0.55 em），无头工具与测试因此不受影响。

`fit-text` 命令把溢出文本的字号逐档下调到 8pt，只改 `style.fontSizePt`，属于设计态：不改文字、数字、来源与备注，内容哈希与审核状态不变，可撤销。它使用的溢出阈值与质量门完全一致，因此修复后质量门的溢出报告会真的消失。

已知边界：度量本身不提供字体是否安装的信息，字体是否安装由 `src/services/font-availability.ts` 单独判定；度量解决宽度，不解决与 PowerPoint 之间的断行差异。详见 [0016 真实字体度量与文字适配](decisions/0016-real-text-metrics-port.md)。

## 13. 导出视觉回归（V0.1 已实现）

结构检查看不出"文件看起来变了"。视觉回归比对把导出的 PPTX 交给真正的演示文稿程序渲染成图片，再和参考图逐像素比较：

- `src/core/rendering/png.ts`：不依赖图像库的 PNG 编解码。PowerPoint 写的是调色板 PNG，所以调色板、真彩色、灰度与带 alpha 的变体都要支持；隔行的图片明确拒绝，不读成错图。
- `src/core/rendering/pixel-diff.ts`：纯像素比较。颜色通道有容差，尺寸不同不逐像素比较而是单独报出。
- `src/core/rendering/visual-regression.ts`：回归判定。变化像素比例超过容忍度才算回归，尺寸不同一律算回归。

渲染器是外部程序（首选 PowerPoint，其次 LibreOffice），每个渲染器有自己的一份参考图，参考图与生成它的机器绑定。检查写在 `tools/visual-regression/`，不随产品发布；没有可用渲染器时它会跳过并说明，而不是假装检查通过。详见 [0017 导出视觉回归比对](decisions/0017-export-visual-regression.md)。

## 14. 运行时视觉评审的执行边界

生成流程里的 AI 视觉评审（`src/services/design-quality-stage.ts`）受以下边界约束：

- 评审上限为 40 页，与 PPTX 栅格化器一致；超过上限或评审不可用时报告“本次未做视觉评审”，不假装通过。
- 内容隔离由 `documentContentFingerprint` 从真实文档快照计算，覆盖标题、正文、结构化块、备注和页序。
- 模型没给出逐页指导时保持缺失；规则降级和模型修复计划都只能作用于评审指出问题的页面。
- 评分下降或停滞时回退到评分最高的设计；修复前后设计等价时以 `no-change` 停止，不再重复渲染与评审。
- 分批请求互相独立，部分批次失败时保留成功结论，并如实报告覆盖页数。
- 整册总览由单独的 `deckOnly` 评审给出跨页一致性，它不输出逐页几何；逐页批次不携带缩略图。没有整册评审时才退回“第一批附带缩略图”，总览失败时退回批内评分并记录降级。
- 未变化页不重复栅格化；PPTX 仍整册构建，PowerPoint 仍每轮启动。
- 设计未变的页批次复用上一轮评审结论；整册总览每轮重新评审，没有整册评审时携带缩略图的第一批也每轮重看。
- 最后一轮的评分、逐页建议和覆盖页数随结果返回并在报告中展示；未评审时为空，不能解释为“检查通过”。
- 视觉评审默认开启，但用户可以在设置中关闭；关闭后不上传任何页面渲染图，并在报告中明确说明只做了确定性校验。

详见 [0037 运行时视觉评审的执行边界](decisions/0037-visual-review-execution-bounds.md)。
