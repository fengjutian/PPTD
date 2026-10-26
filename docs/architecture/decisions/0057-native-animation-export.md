# 0057 原生对象动画导出

## 状态

已接受（V0.2）

## 背景

ADR 0050 把动画扩到九种效果，但导出仍只写静态页面：导出报告逐页说明“未写入原生动画”。用户在编辑器里能预览、能保存、能复制动画，到了 PowerPoint 里却全部消失。切换已经能写成 `<p:transition>`（ADR 0056），对象动画仍缺同一条原生通路。

PptxGenJS 没有动画 API。整页视频会破坏可编辑性，也违反 TRS 对普通对象的要求。

## 决策

### 九种效果都有已核对节点

导出支持全部九种编辑器效果：

- 进入：出现（`appear`）、淡化（`fade`）、飞入（`fly-in`）、浮入（`float-in`）、劈裂（`split`）、擦除（`wipe`）、缩放（`zoom`）
- 强调：脉冲（`pulse`）
- 退出：消失（`disappear`）

节点映射：

| 效果 | 原生节点                                                             |
| ---- | -------------------------------------------------------------------- |
| 出现 | `set style.visibility=visible`                                       |
| 淡化 | `set` + `animEffect filter="fade"`                                   |
| 飞入 | `set` + `ppt_x`/`ppt_y` 位移                                         |
| 浮入 | `set` + `animEffect filter="fade"` + `ppt_y` 上浮                    |
| 劈裂 | `set` + `animEffect filter="barn(inVertical)"`                       |
| 擦除 | `set` + `animEffect filter="wipe(…)"`                                |
| 缩放 | `set` + `ppt_w`/`ppt_h` 从 0 到原尺寸                                |
| 脉冲 | `animScale by=105000 autoRev="1"`（PowerPoint 中显示为 Grow/Shrink） |
| 消失 | `set style.visibility=hidden`，`presetClass="exit"`                  |

`NATIVE_ANIMATION_EFFECTS` 是编辑器、校验器和导出器共用的唯一清单，避免三处各写一份。脉冲在 PowerPoint 的效果名是 Grow/Shrink 而不是中文“脉冲”，但“放大后自动回位”的播放语义一致；这一点在文档里如实记录。

图表没有 `objectName`，所以图表的动画仍会被跳过并计入 `nativeAnimationSkipped`；报告不会假装写了。

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
- `nativeAnimationSkipped`：目标不是可寻址对象、对象类型暂不导出动画或效果不支持而跳过的数量。

全部九种效果都可写，因此 `animation-not-exported` 只会留给未来新增、尚未核对节点的效果；当前实际跳过来自图表等动画尚未验证的目标，由导出补丁计入 skipped 并追加警告。

## 后果

- 九种对象动画在 PowerPoint 中可播放、可继续编辑，不再是静态画面。
- 图表动画仍不导出。后续 0109 已给图表补稳定 `objectName` 以便原生分组，但“有名字”不等于动画节点已核对；在 PowerPoint 中逐项验证图表动画前，导出仍显式跳过。
- 脉冲在 PowerPoint 效果列表中显示为 Grow/Shrink（放大后自动回位），与编辑器的“强调脉冲”语义一致，但名称不完全相同。
- 动画与切换可以同时存在：切页先播放，页内时间线再按 click group 推进。

## 验证

- 单元测试：fade 导出包含 `<p:timing>`、`filter="fade"` 和 `bldLst`，报告计数为 1；包含 split/float-in/pulse/disappear 的导出包含 `barn(inVertical)`、`presetID="30"`、`<p:animScale>`、`presetClass="exit"` 和 `visibility=hidden`，计数为 4。
- 图表动画：即使已有稳定对象名，仍因图表动画未验证而跳过，报告 `nativeAnimationSkipped=1` 并追加“未写入 PPTX”警告。
- 结构测试：用 PowerPoint COM（`Presentations.Open`、`Timeline.MainSequence.Count`）打开包含四种新增效果的探针文稿，读到 4 个效果（Split、Float、Grow/Shrink、Exit）；此前的五种效果另有探针。另用 PowerPoint 重新保存后，`animScale autoRev`、`barn(inVertical)`、`ppt_y+0.25`、`visibility=hidden` 均保留，未被修复或丢弃。
- 包结构校验继续在补丁后执行。

## 备选方案

- **只交付五种效果**：另外四种节点没有逐项核对；本轮已用 PowerPoint 生成并核对 Split/Float 的真实 XML，Pulse 用 Grow/Shrink + auto-reverse，Disappear 用 exit + hidden。
- **按元素顺序推断 shape id**：表格/图片/图标会产生额外节点，顺序推断会指错对象。
- **把动画渲染成视频**：破坏可编辑性，文件膨胀，不符合产品原则。
