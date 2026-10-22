# 0032：文本字距与行高

## 状态

已接受（2026-10-22）。

## 背景

主题令牌（ADR 0031）已经能声明 `letterSpacingPt` 与 `lineHeight`，但 `TextElementStyle` 没有这两个字段，画布与导出都忽略它们：中文标题没有字距、正文行距只能由渲染引擎固定。结果是令牌里写了的排印参数落不了地。

## 决策

1. `TextElementStyle` 增加两个可选字段：`letterSpacingPt`（-2–20pt）与 `lineHeight`（0.8–3 倍），并进入 schema。
2. 画布 `RichText` 输出 CSS `letter-spacing` 与 `line-height`，单位换算与字号一致；导出写 PptxGenJS 的 `charSpacing`（序列化为 `spc = pt × 100`）与 `lineSpacingMultiple`（`spcPct = 倍数 × 100000`）。
3. 主题令牌在"角色回填"这一步落到元素：`title` 令牌作用于标题，`body` 令牌作用于正文；元素自身的值优先于令牌。
4. 四套预设给标题加 0.6–0.8pt 字距（黑体主题为 0），宋体标题的密排因此松一口气；正文行高暂不设，避免与版式估算冲突。

## 结果

- 画布与导出的字距/行高一致，PPTX 里可以看到 `spc` 与 `spcPct`。
- 预设不只换字号，也换标题的字距。
- 新增 4 条测试：schema/类型、RichText 的 CSS、导出 XML 的 `spc="80"` 与 `spcPct val="130000"`、预设字距落地。

## 未覆盖

- 版式估算：`blockHeight` 已可接收行高，列、流程、卡片、对照这些正文帧按主题行高预留；标题与说明仍按默认 1.25。预设统一给正文 1.3 倍行高。
- 字距会影响文本宽度与换行，估算同样没有计入；当前只用于短标题，误差可接受。
- `caption` 令牌的字距/行高还没有作用到页码、面板说明等小字。
