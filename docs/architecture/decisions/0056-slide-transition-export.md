# 0056 页面切换效果与原生导出

## 状态

已接受（V0.2）

## 背景

动画阶段已经有对象级进入/强调/退出效果，但页面与页面之间始终是硬切。TRS 要求演示文稿可以“按页预览”并保留原生演示行为；用户在实际放映时首先注意到的往往不是单个对象的动画，而是页与页之间的过渡。

PptxGenJS 没有页面切换 API。若把切换做成整页图片或视频，会破坏可编辑性，也违反“普通对象保持原生”的约束。因此切换必须写成 OOXML 的 `<p:transition>`，由 PowerPoint/LibreOffice 在放映时执行。

## 决策

### 数据模型

页面新增可选 `transition`，属于 Design Model：

```ts
type SlideTransitionKind = "fade" | "push" | "wipe" | "split";
type SlideTransitionDirection = "left" | "right" | "up" | "down";
type SlideTransitionSpeed = "fast" | "medium" | "slow";

interface SlideTransition {
  kind: SlideTransitionKind;
  speed: SlideTransitionSpeed;
  direction?: SlideTransitionDirection;
}

interface Slide {
  // ...
  transition?: SlideTransition;
}
```

不存 `"none"` 值：缺少字段就是无切换，旧项目不需要迁移默认值。`set-slide-transition` 接受 `null` 来清除。

### 命令与版本

`set-slide-transition` 是设计域命令，只递增 design/document revision，不改内容哈希、内容版本和审核状态；一次设置或清除是一个撤销项。方向只对 `push`、`wipe`、`split` 有意义，`fade` 不写方向。

新增可选字段使持久化格式升到第 18 版；`17 → 18` 迁移只改版本号，不伪造切换，固定样例见 `v18-document.json`。

### 导出位置

PptxGenJS 生成的包写完之后，导出管线按页把 `<p:transition>` 插到 `ppt/slides/slideN.xml` 的 `<p:clrMapOvr>` 之后。这是 ECMA-376 规定的顺序：`cSld`、`clrMapOvr`、`transition`、`timing`、`extLst`。

- `fade` → `<p:fade/>`
- `push` → `<p:push dir="l|r|u|d"/>`
- `wipe` → `<p:wipe dir="l|r|u|d"/>`
- `split` → 左右方向用 `orient="vert"`，上下方向用 `orient="horz"`；`dir` 取 `out`/`in`

速度 `medium` 写成 OOXML 的 `med`。写入是幂等的：若目标页已经有 `<p:transition>`，整段替换而不是追加。

### 报告

导出报告新增 `nativeTransitionCount`，只统计实际写入的页数；没有切换的页不写空元素。包结构校验在写入后继续执行。

## 后果

- 切换在 PowerPoint 中是可编辑的原生页面属性，不是图片或视频。
- 页面切换和对象动画互不依赖：切页先发生，页内动画再按时间线播放。
- 旧项目打开后没有切换，行为与之前一致。
- LibreOffice 能解析该元素，但放映级动画/切换仍需在 PowerPoint 中人工确认；没有把“文件能打开”当成“切换一定正确播放”。
- 当前不提供切换预览；编辑器没有放映模式，预览入口属于后续的幻灯片浏览/放映任务。

## 验证

- `set-slide-transition` 命令测试：设置/清除、内容不变、非法值拒绝、域为 design。
- Schema 测试：v18 固定样例保留 push 切换；v17 迁移后没有切换。
- 导出测试：`ppt/slides/slide1.xml` 含 `<p:transition spd="med"><p:push dir="l"/></p:transition>`，报告 `nativeTransitionCount = 1`，包结构有效。
- 属性面板测试：无切换时不显示速度和方向，方向性切换显示两者。

## 备选方案

- **只做 CSS 预览**：用户能看到效果，但导出的 PPTX 仍然硬切，等于没有交付演示行为。
- **把切换渲染成整页视频**：破坏对象可编辑性，文件膨胀，且不符合 TRS。
- **让 PptxGenJS 后处理整个 slide XML**：与现有主题色、图片裁剪补丁重复遍历，且拿不到稳定的元素 id；集中在独立模块更容易测试。
