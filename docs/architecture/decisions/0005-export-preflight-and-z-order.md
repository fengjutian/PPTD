# 0005 PPTX 导出预检、z-order 与报告

## 状态

已采纳（2026-10-21）。

## 背景

导出器此前按元素 `y` 坐标排序，导致画布层级与 PPTX 对象顺序不一致；报告中的 `warnings` 始终为空，调用方无法知道内容未审核、字体缺失、文本溢出或图片源不可用。只检查 `PK` 文件头也不足以证明 ZIP/OOXML 结构可打开。

## 决策

1. 导出前运行纯函数 `validatePresentationForExport`，检查空页、内容审核状态、越界、文本溢出、缺失字体、图片源和替代文本。结构性错误阻止导出，提示性警告写入报告。
2. 元素严格按 `slide.elements` 数组顺序写入，不排序。数组末尾即画布和导出中的最上层。
3. 圆角矩形映射为 PptxGenJS `roundRect`，并把 `radiusPt` 转换为英寸，受短边一半限制。
4. 生成后解析 ZIP 中央目录，检查 `[Content_Types].xml`、`ppt/presentation.xml`、关系文件和幻灯片 XML 数量；失败时抛出 `EXPORT_PACKAGE_INVALID`。
5. 导出支持 `AbortSignal`，在页面和元素循环中检查取消。导出始终基于当前不可变快照，不改变文档 revision。
6. 导出报告包含页数、原生对象数、警告列表、结构化问题和 ZIP 校验结果，由 UI 的导出报告对话框展示。

## 影响

- 旧测试只验证 `PK` 和对象数量，已补充解压幻灯片 XML 的 z-order 断言。
- 预检是启发式检查，不能替代 PowerPoint/LibreOffice 的视觉验收；字体可用性依赖运行环境的 `document.fonts`。
- 图片必须是内嵌 data URL；外部路径和 `asset://` 引用在导出前会作为错误阻止。
