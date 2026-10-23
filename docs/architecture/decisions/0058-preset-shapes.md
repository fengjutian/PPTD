# 0058 预设形状模型与原生导出

## 状态

已接受（V0.2）

## 背景

`ShapeElement` 只有 `rectangle` 和 `ellipse` 两种。导入 PPTX 时，三角形、菱形、箭头、星形等常见 `prstGeom` 全部降级成矩形；用户也无法在编辑器里插入这些形状。导出的 PPTX 里，它们自然也不再是原来的形状。

这不是“少一个按钮”的问题：形状名称是 OOXML 的 `prstGeom prst`，必须与画布、文档模型和导出器使用同一套词汇，否则导入和导出各写各的，往返一定失真。

## 决策

### 一套 ShapeKind

`ShapeKind` 成为唯一的形状词汇：

```ts
type ShapeKind =
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "chevron"
  | "arrow"
  | "star"
  | "parallelogram"
  | "trapezoid";
```

圆角矩形不新增类型：它仍是 `rectangle`，圆角半径保存在 `style.radiusPt`。这样既有文档不需要改写，圆角也只是一种样式。

### 画布用真实轮廓

矩形和椭圆继续用 CSS（圆角是样式）。其余形状由 `ShapeView` 按元素像素框生成 SVG 路径，填充、描边、线宽都跟随元素样式。路径与导入/导出使用同一组比例点，避免“画布上是三角形、导出后变成别的三角形”。

### 导出为原生预设

导出映射到 PptxGenJS 的 `ShapeType`：

| ShapeKind | OOXML 预设 |
| --- | --- |
| triangle | triangle |
| diamond | diamond |
| pentagon | pentagon |
| hexagon | hexagon |
| chevron | chevron |
| arrow | rightArrow |
| star | star5 |
| parallelogram | parallelogram |
| trapezoid | trapezoid |

对象仍是原生可编辑形状，不是图片。

### 导入映射与降级

读取器把常见 `prstGeom` 映射到 `ShapeKind`；`roundRect` 映射成带 `radiusPt` 的矩形；`rtTriangle` 归入三角形；`nonIsoscelesTrapezoid` 归入梯形；没有对应模型的预设仍降级为矩形并写入导入报告，不假装保留。

### 持久化版本

形状枚举扩宽使持久化格式升到第 19 版。`18 → 19` 迁移只改版本号：旧文档只含 `rectangle`/`ellipse`，它们仍是合法值；固定样例见 `v19-document.json`。

## 后果

- 导入的常见预设形状保持形状，不再一律变矩形。
- 用户可以通过“插入 → 形状”菜单创建 11 种形状；所有入口都走同一个 `add-shape` 命令。
- 形状的旋转、缩放、层级、分组和动画沿用既有元素能力。
- 尚未覆盖的预设（如 callout、复杂箭头、流程图形状）继续降级并报告，等有真实样例再逐项加入，不批量声明兼容。
- 圆角矩形仍没有独立的 `roundRect` 元素类型；如果将来需要分别编辑圆角和形状，再另立模型变更。

## 验证

- Schema：v19 固定样例保留三角形；v18 迁移后矩形不变。
- 导入：`prst="triangle"` 映射为 `triangle`，且不产生降级警告。
- 导出：三角形在 slide XML 中写成 `<a:prstGeom prst="triangle">`，包结构有效。
- 画布：预设形状输出 SVG 路径，所有路径以 `M` 开始、以 `Z` 闭合。
- 前端全量测试、类型检查、生产构建通过。
