# 0057 原生对象动画导出

## 状态

已接受（V0.2）

## 背景

ADR 0050 把动画扩到九种效果，但导出仍只写静态页面：导出报告逐页说明“未写入原生动画”。用户在编辑器里能预览、能保存、能复制动画，到了 PowerPoint 里却全部消失。切换已经能写成 `<p:transition>`（ADR 0056），对象动画仍缺同一条原生通路。

PptxGenJS 没有动画 API。整页视频会破坏可编辑性，也违反 TRS 对普通对象的要求。

## 决策

### 只写已核对结构的子集

导出支持：

- 出现（`appear`）
- 淡化（`fade`）
- 飞入（`fly-in`）
- 擦除（`wipe`）
- 缩放（`zoom`）

其余四种（`split`、`float-in`、`pulse`、`disappear`）继续只做画布预览和项目持久化，导出报告逐页说明它们没有原生节点。`NATIVE_ANIMATION_EFFECTS` 是编辑器、校验器和导出器共用的唯一清单，避免三处各写一份。

### 对象名就是稳定元素 id

导出时每个原生对象的 `objectName` 写成元素的稳定 id。动画补丁在 `ppt/slides/slideN.xml` 的 `<p:cNvPr>` 里按 name 找到 PowerPoint 分配的 shape id，再写进 `<p:spTgt spid="…">`。不能按对象顺序猜 id：表格、图片和图标都会写出额外的内部节点，猜错会动到别的对象。

图表没有 `objectName` 选项，所以图表的动画即使效果受支持也会被跳过并计入 `nativeAnimationSkipped`；报告不会假装写了。

### 时间线结构与 PowerPoint 一致

`<p:timing>` 按 PowerPoint 自己写出的层级构造：

- 一个 `tmRoot`，一个 `mainSeq`；
- 每个“单击时”开一个新的 click group（`delay="indefinite"`）；
- click group 里每个效果一个 delay holder；
- “与上一动画同时”用 `nodeType="withEffect"`、delay 0；
- “上一动画之后”用 `nodeType="afterEffect"`，holder 的 delay 是前一个效果的持续时间加延迟。

holder 必须是 click group 的兄弟节点。把“之后”的 holder 嵌进第一个效果的 holder 里会让整个文件在 PowerPoint 中报“文件损坏”。

### 写入顺序与幂等

`<p:timing>` 位于 `<p:transition>` 之后（没有切换时位于 `<p:clrMapOvr>` 之后），符合 `cSld → clrMapOvr → transition → timing → extLst`。已存在的 `<p:timing>` 会整段替换，避免重复。

### 报告

`ExportReport` 新增：

- `nativeAnimationCount`：实际写入的效果数；
- `nativeAnimationSkipped`：效果不受支持或目标不是可寻址对象而跳过的数量。

校验器只为“不受支持的效果”产生 `animation-not-exported` 警告；受支持但目标不可寻址的动画由导出补丁计入 skipped，并追加一条警告。

## 后果

- 五种常用动画在 PowerPoint 中可播放、可继续编辑，不再是静态画面。
- 另外四种仍会丢失放映动画，但项目文件和画布预览保留，报告明确说明。
- 图表动画不导出；如果后续 PptxGenJS 暴露图表对象名，或改为直接生成 graphicFrame，可再扩展。
- 动画与切换可以同时存在：切页先播放，页内时间线再按 click group 推进。

## 验证

- 单元测试：fade 导出包含 `<p:timing>`、`filter="fade"` 和 `bldLst`，报告计数为 1；pulse 不写 timing，报告跳过并告警。
- 结构测试：`npm run test:visual` 之外，用 PowerPoint COM（`Presentations.Open`、`Timeline.MainSequence.Count`）打开一份包含“单击淡化 + 之后飞入 + 单击擦除 + 页面切换”的探针文稿，PowerPoint 正常打开并读到 3 个效果。这次验证发现并修掉了 holder 嵌套错误导致的文件损坏。
- 包结构校验继续在补丁后执行。

## 备选方案

- **九种效果一次性全写**：split/float-in/pulse/disappear 的节点没有逐项核对，写错会让 PowerPoint 修复文件；先交付已验证子集更诚实。
- **按元素顺序推断 shape id**：表格/图片/图标会产生额外节点，顺序推断会指错对象。
- **把动画渲染成视频**：破坏可编辑性，文件膨胀，不符合产品原则。
