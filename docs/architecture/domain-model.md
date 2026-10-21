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

| 内容字段 | 设计字段 |
|---|---|
| 标题、正文、数值、表格数据 | 坐标、尺寸、旋转、层级 |
| 图表语义数据 | 图表类型、配色、标签样式 |
| 引用、来源、备注 | 字体、颜色、间距、背景 |
| 页面语义顺序 | 版式、图片裁剪、阴影、3D 引用 |

## 3. 强类型元素

```ts
type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | TableElement
  | ChartElement
  | GroupElement
  | Scene3DElement;

interface ElementBase {
  id: ElementId;
  frame: RectEmu;
  rotationMilliDegree: number;
  zIndex: number;
  locked: boolean;
  sourceContentId?: ContentId;
}
```

每个联合成员拥有自己的 `style` 和数据结构，不使用无约束的 `Record<string, unknown>`。颜色、线型、字体、裁剪、对齐等均定义为可校验值对象。

## 4. 命令与不变量

首期命令至少包括：

- `CreateSlide`、`DeleteSlide`、`MoveSlide`
- `AddElement`、`DeleteElements`、`DuplicateElements`
- `TransformElements`、`ReorderElements`、`SetElementLock`
- `EditText`、`SetTextStyle`、`SetShapeStyle`、`SetImageCrop`
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

| 变更 | document | content | design |
|---|---:|---:|---:|
| 修改正文或业务数据 | +1 | +1 | 0 |
| 新增/删除/调整语义页面 | +1 | +1 | 0 |
| 移动、缩放、换色、换版式 | +1 | 0 | +1 |
| 同时拆页并重新排版 | +1 | +1 | +1 |
| 选择、缩放视口等瞬时 UI 状态 | 0 | 0 | 0 |

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

版式的整页画面是图片元素，带 `placement: "layout-background"`。画布把它画在页面底层，导出把它放进母版背景，页面上不再重复绘制这张图片。详见 [0008 模板主题与版式落地到导出的 PPTX](decisions/0008-template-master-and-theme-export.md)。

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
