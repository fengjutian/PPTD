# 0106 原生文本制表位

## 状态

已接受。

## 决策

- `TextElementStyle.tabStops` 保存最多 32 个文本框级制表位。
- 每项包含 `positionPt` 和 `left/center/right/decimal` 对齐；领域单位为 point，不保存裸英寸或 EMU。
- PPTX 导入把 DrawingML `a:tab/@pos` 从 EMU 换算为 point；导出再换算为 PptxGenJS 要求的英寸并生成原生 `a:tabLst`。
- 画布根据首个制表位宽度近似显示 tab。PowerPoint 的中心、右侧和小数点对齐属于最终渲染语义，画布不声称像素等价。
- Schema 26→27 为恒等迁移，旧项目不产生虚构制表位。

## 边界

当前文本框共享一组制表位。逐段独立 tab stops 必须等待段落数组模型，不能通过复制字符串空格伪实现。
