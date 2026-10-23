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

V0.1 的实现把这条关系具体化为三个字段：图表的 `contentBlockIds`、表格的 `contentBlockId`、指标卡文字的 `contentBlockRef`（块 id 加 `label` / `value` 字段）。三者都只保存引用，不保存内容副本。

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
| 确认或退回内容审核           |       +1 |      +1 |      0 |
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
- 设计未变的页批次复用上一轮评审结论；模型返回逐页分数时，批内只上传缺少当前设计结论的页，并按页拼回批次结论；没有逐页分数时退回整批。整册总览每轮重新评审，没有整册评审时携带缩略图的第一批也每轮重看。
- 逐页请求失败时保留未变化页的结论；覆盖不完整时报告明确写出未评审页不能视为通过，界面保留报告而不是静默成功。覆盖范围和降级说明跟随最终采用的评审轮次。
- 最终采用的那一轮的评分、逐页评分、逐页建议和覆盖页数随结果返回并在报告中展示；修复被回退时不是最后一轮。未评审时为空，不能解释为“检查通过”。
- 逐页评审可返回 `slideScores`（总分、层级、对齐、可读性），只保留实际检查过的页；一致性仍是整套指标。缺省时退回批次级评分，合并总分把批次分和逐页分一起取最小值：低分页不能被同批的高分掩盖，但分数本身不单独授权修复。
- 视觉评审跑过但未达到目标、覆盖不完整或整体失败时，结果标记 `visualPassed = false`，界面保留报告；用户主动关闭视觉评审时为空，不当作评审失败。确定性质量门通过不能替代这一项。
- 视觉评审默认开启，但用户可以在设置中关闭；关闭后不上传任何页面渲染图，并在报告中明确说明只做了确定性校验。

详见 [0037 运行时视觉评审的执行边界](decisions/0037-visual-review-execution-bounds.md)。

## 15. 视觉叙事与整册艺术指导

设计模型在版式和构图之前记录逐页 `visualNarrative`，用于区分结论、证据、对比、时序、框架、引语与场景叙事。该字段只表达传播意图，不包含坐标或内容副本；最终构图仍需通过内容容量校验。

整册艺术指导只调整模板色板角色和页面节拍：封面、章节与结论页形成深色视觉节点，普通内容页保持浅色，连续深色页会被打断。视觉评审另外报告重复控制、主题匹配和视觉焦点；视觉服务不可用时这些分数保持缺失，不以确定性质量门冒充。

详见 [0038 逐页视觉叙事与整册艺术指导](decisions/0038-visual-narrative-and-deck-art-direction.md)。

## 16. 内容复核闭环（V0.1 已实现）

已确认内容被内容命令修改后变成 `changed`，导出预检会持续提示该页未完成审核。如果只能改、不能确认，用户消除提示的唯一办法就是撤销修改。

因此补上两个内容域命令：

- `approve-slide-content`：把目标页设为 `approved`。
- `reopen-slide-content`：把目标页设为 `review`，退回审核而不是退回草稿。

两者只改 `slide.content.status`，不碰标题、正文、块、备注、对象和页序；文档与内容 revision 各 +1，设计 revision 不变。确认还会按 §18 留下内容版本快照，快照本身不额外递增 revision。目标状态已经达成时命令返回 `null`，不产生空撤销项。

编辑器状态栏展示当前页审核状态，并按状态只给一个动作：未确认时"确认本页内容"，已确认时"退回审核"。状态说明解释这一页为什么还算未审核，而不是重复状态名。

导出仍以警告（`content-not-approved`）而不是错误对待未确认页面；复核闭环提供消除警告的入口，不替用户做确认。详见 [0040 内容复核闭环](decisions/0040-content-reapproval-loop.md)。

## 17. 结构化内容的编辑器入口（V0.1 已实现）

指标和表格数据是内容，但它们的呈现对象不是"一段可以随便改的文字"：

- 指标卡文字通过 `contentBlockRef` 指向指标块的某个字段。编辑卡片就是编辑指标块，同一字段的所有卡片文字一起更新。
- 原生图表通过 `contentBlockIds` 读取指标块。图表属性面板的"指标"字段发出 `set-metric`，不写图表自身的副本。
- 原生表格通过 `contentBlockId` 读取表格块。属性面板的单元格网格发出 `set-table-cell`，表格对象仍然没有单元格。

三个入口都是内容域命令：文档与内容 revision 各 +1，已确认页面进入 `changed`。值与现值相同时返回 `null`，不产生空撤销项。长度上限与持久化 Schema 一致，越界单元格抛 `TABLE_CELL_OUT_OF_RANGE`。

`contentBlockRef` 是 Schema 13 新增的可选字段。迁移不猜测旧卡片指向哪个块；旧文档的卡片保持普通文本。设计换版会重映射临时块 id，映射不到时删除绑定；粘贴的卡片不保留绑定。

详见 [0041 在编辑器内编辑结构化内容](decisions/0041-structured-content-editing.md)。

## 18. 内容版本快照、差异与恢复（V0.1 已实现）

"确认"不只是一个状态位，还是一次可追溯的内容版本。确认本页内容或应用已审核的 AI 内容时，文档把整份文稿的内容字段复制成一份快照：

- 内容部分只保存标题、正文、内容块和演讲备注，不保存审核状态。
- 同一快照还保存确认时刻的设计副本：页面尺寸、主题、版式、每页背景、元素、动画、切换和分组。设计副本不参与内容签名和重复判定。
- 快照以内容 revision 和文档 revision 标注；快照本身不额外递增 revision。
- 同一份内容重复确认不会新增版本；设计套用重新生成的对象和块 id 不算内容变化。
- 最多保留 30 个版本，超出时丢弃最旧的快照。
- 快照随项目文件保存；命令撤销时，该命令内新增的快照一并撤销。

编辑器状态栏的"内容版本"入口可以选中任一版本，与当前文稿逐页比较。页面按稳定的 slide id 匹配；页面集合不变时报告页序调整，增删页时不把后续页面的索引位移误报成移动。差异按标题、正文、备注和内容块展示，表格块以行列摘要呈现，不展开成单元格级 diff；内容块先按 id、再按类型配对，只重新生成 id 不算内容变化，纯顺序变化单独报告。

`restore-content-version` 默认只恢复标题、正文、内容块、演讲备注和页序。恢复保留当前内容块 id，并重映射仍指向旧 id 的卡片、图表和表格引用；不重建元素、样式、背景或版式。传入 `includeDesign: true` 时，同一命令还恢复该版本的设计副本（页面尺寸、主题、版式、背景、元素、动画、切换、分组），版本窗口把它显示为“同时恢复版式”。页面集合与当前文稿不一致，或内容块数量和类型无法一一对应时，命令分别返回 `CONTENT_VERSION_PAGE_SET_MISMATCH` 和 `CONTENT_VERSION_BLOCKS_INCOMPATIBLE`，只允许查看差异。恢复后的页面进入 `changed`，需要用户重新确认。

`contentVersions` 是 Schema 14 新增的可选字段；Schema 19 给每个版本加上可选的设计副本。迁移不伪造历史；旧文档在第一次确认时生成第一个版本。已经全部确认的旧文档不会在打开时自动补历史，需要先退回审核再重新确认一页来建立基线。详见 [0043 内容版本快照、差异与恢复](decisions/0043-content-version-history.md) 与 [0060 设计快照与评审留痕](decisions/0060-design-snapshot-and-review-trace.md)。

视觉评审的摘要另存为 `reviewTraces`：总分、问题数、逐页评分和时间。它只保存评分结果，不保存模型原始响应或页面图片，最多 20 条。

## 19. 字符与段落格式（V0.2 已实现）

`TextElementStyle` 增加斜体、下划线、删除线、垂直对齐、项目符号和缩进级别，全部是可选的设计字段，不进入内容哈希：

```ts
italic?: boolean;
underline?: boolean;
strikethrough?: boolean;
verticalAlign?: "top" | "middle" | "bottom";
bullet?: "none" | "dot" | "number";
indentLevel?: number; // 0–8
```

正文仍是字符串，没有逐段结构，因此项目符号、编号和缩进作用于整个文本框：标记画在每行左侧，编号按行递增，标记不写进 `element.text`。逐段格式需要先给内容模型增加段落结构，本阶段不做。

多选格式走批量命令 `set-text-style-elements`，清除格式走 `clear-text-format`；两者都只产生一个设计事务和一个撤销项。锁定对象被跳过；没有可编辑文本时命令拒绝执行。`clear-text-format` 的默认值来自主题的标题/正文令牌，没有主题时回退到工厂默认值，不把硬编码字号写回文档。

字号增减使用 Office 字号阶梯（8、9、10、10.5、11、12、14 … 120），定义在 `src/core/document-model/text-style.ts`。画布与 PPTX 导出共享同一份样式语义：导出写成原生 `i`/`u`/`strike`/`anchor`/`lnSpc`/`buChar`/`buAutoNum`/`lvl` 属性，文本仍是可编辑对象。

新增字段使持久化格式升到第 15 版；`14 → 15` 迁移不写入任何默认格式，固定样例见 `src/core/document-model/__fixtures__/v14-document.json`。详见 [0044 字符与段落格式](decisions/0044-text-character-and-paragraph-formatting.md)。

## 20. 动画效果、阶段与复制（V0.2 已实现）

动画是设计态，挂在页面的 `animations` 时间线上，用稳定 `animation.id` 引用稳定 `elementId`：

```ts
type AnimationEffect = "appear" | "fade" | "fly-in" | "float-in" | "split" | "wipe" | "zoom" | "pulse" | "disappear";
type AnimationPhase = "entrance" | "emphasis" | "exit";

interface SlideAnimation {
  id: string;
  elementId: ElementId;
  effect: AnimationEffect;
  phase: AnimationPhase;
  start: "on-click" | "with-previous" | "after-previous";
  durationMs: number;
  delayMs: number;
  direction: "none" | "left" | "right" | "top" | "bottom";
}
```

阶段不由 UI 选择，而由效果派生：出现/淡化/飞入/浮入/劈裂/擦除/缩放属于进入，强调脉冲属于强调，消失属于退出。`add-animation` 与 `set-animation` 调用 `phaseForEffect`；Schema 在文档校验时拒绝阶段与效果不一致的记录（`ANIMATION_PHASE_MISMATCH`）。

`duplicate-animation` 复制一条动画（新 id、相同效果/计时/开始方式/方向）并插到源动画之后，一次撤销；锁定元素拒绝复制。预览通过 `animation-${effect}` 类与 CSS 关键帧实现，属于临时 UI 状态，不改变 revision、保存状态或撤销栈。

效果枚举从 3 种扩到 9 种、阶段扩为三值，使持久化格式升到第 16 版；`15 → 16` 迁移只改版本号，旧动画（全部为进入）保持有效，固定样例见 `v16-document.json`。导出对出现、淡化、飞入、擦除和缩放写入原生 `<p:timing>`；其余四种只预览，报告逐页说明。详见 [0050 动画阶段由效果派生](decisions/0050-animation-phase-from-effect.md) 与 [0057 原生对象动画导出](decisions/0057-native-animation-export.md)。

## 21. 编辑期选择组（V0.2 已实现）

分组是页面级设计元数据，不是嵌套元素：

```ts
interface SlideGroup {
  id: string;
  elementIds: ElementId[];
}

interface Slide {
  // ...
  groups?: SlideGroup[];
}
```

成员仍平铺在 `slide.elements` 中，保持原有 Z 序；渲染、导出、内容同步和动画都不需要递归。组的作用是选择：store 的 `selectElement`、`toggleElement`、`selectElements` 把任一成员展开成整组，移动、对齐、分布、锁定和删除因此沿用既有多选命令。

不变量由命令和 Schema 共同保证：

- 组合至少两个、全部存在、全部未锁定、均不属于现有组。
- 组 id 全局唯一，一个元素只能属于一个组，成员必须存在于同一页。
- 删除成员后丢弃整组；`relayout-slide` 清空分组；`duplicate-slide` 不继承分组（元素 id 已重新生成）。
- 组合/取消组合是设计域命令，各一个撤销项。

PptxGenJS 没有分组 API，导出把成员写成独立原生对象，preflight 逐页给出 `group-not-exported` 提示；原生 `<p:grpSp>` 导出属于 TASK-GROUP-002。

新增可选 `groups` 使持久化格式升到第 17 版；`16 → 17` 迁移不伪造分组，固定样例见 `v17-document.json`。详见 [0051 编辑期选择组与导出展平](decisions/0051-editor-selection-groups.md)。

## 22. PPTX 内容导入（V0.3 Level A 首版）

导入不是持久化格式变化：Rust 读取器把 `.pptx` 解析成中性 `ImportedDeck`，TypeScript 纯函数 `importedDeckToDocument` 再生成当前 `schemaVersion` 的 `PresentationDocument`。项目文件始终是 PPTD 自己的文档，不存在“直接编辑 PPTX”的第二种持久化模型。

Level A 映射：

- 页面尺寸与顺序来自 `p:sldSz`、`p:sldIdLst`。
- 文本段落 → 换行，run 样式 → `TextElementStyle`/`TextRun`；标题/正文占位符绑定 `contentRef`。
- 图片 → `ImageElement`（data URL、crop、alt）；基础形状与常见预设形状 → `ShapeElement`（11 种 `ShapeKind`）/`LineElement`；基础表格 → `table-data` 内容块 + `TableElement`，`gridSpan`/`rowSpan` 写入 `merges`。
- 组合（含嵌套）→ 递归组合 `chOff`/`chExt` 变换，展平成员坐标并生成一个 `SlideGroup`；组合旋转按仿射变换写入成员坐标和旋转，组合翻转不保留并报告。
- 单序列图表 → `ChartElement` + 每个分类一个 `metric` 内容块；多序列只取第一个，其他图表类型报告后跳过。
- 主题色/字体写入 `document.theme`；演讲备注写入 `content.speakerNotes`。
- 导入页 `content.status = "review"`，保证导出预检提示未审核；导入后是未保存的新项目，必须另存为 `.pptd`。

不支持的对象（图表、组合、SmartArt、OLE、媒体、动画、切换）不进入文档，只进入 `ImportReport`；合并单元格、超过 8 列/30 行的表格降级或截断并报告。母版/版式只用于补齐占位符几何，不做视觉重建。详见 [0052 PPTX Level A 内容导入](decisions/0052-pptx-level-a-import.md)。

## 23. 页面切换（V0.2 已实现）

页面切换是设计态，挂在页面的 `transition` 上，与对象动画分开：

```ts
type SlideTransitionKind = "fade" | "push" | "wipe" | "split";
type SlideTransitionSpeed = "fast" | "medium" | "slow";

interface SlideTransition {
  kind: SlideTransitionKind;
  speed: SlideTransitionSpeed;
  direction?: "left" | "right" | "up" | "down";
}
```

缺少 `transition` 表示无切换，不存 `"none"`。`set-slide-transition` 只改设计 revision，一次设置/清除一个撤销项；方向只对 `push`/`wipe`/`split` 生效。导出在 `<p:clrMapOvr>` 之后写入原生 `<p:transition>`，报告用 `nativeTransitionCount` 记录实际写入页数。

新增可选字段使持久化格式升到第 18 版；`17 → 18` 迁移不伪造切换，固定样例见 `src/core/document-model/__fixtures__/v18-document.json`。详见 [0056 页面切换效果与原生导出](decisions/0056-slide-transition-export.md)。
