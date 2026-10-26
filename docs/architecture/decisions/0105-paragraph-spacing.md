# 0105 原生段前与段后间距

## 状态

已接受。

## 背景

PPTX 占位符和正文段落可以声明 `a:spcBef/a:spcAft`。此前导入器会读取行距，但静默丢失段前、段后间距，造成版式纵向节奏变化。

## 决策

- `TextElementStyle` 增加可选的 `paragraphSpaceBeforePt`、`paragraphSpaceAfterPt`，单位为 point，范围 0–200。
- 当前模型仍是一段文本共享一种段落样式；两个值作用于文本框中的每个换行段落，不伪装成逐段独立格式。
- PPTX 导入读取 `spcPts`，并遵守 slide → layout → master 的占位符继承。
- 画布按相同 point 值换算显示；PptxGenJS 通过原生 `paraSpaceBefore/paraSpaceAfter` 写入 OOXML。
- Schema 25→26 为恒等迁移；旧文档不凭空增加间距。

## 后果

常规统一段落间距可以导入、编辑模型保存并原生导出。逐段不同间距、百分比段距、制表位仍需要新的段落级结构，继续作为明确限制。
