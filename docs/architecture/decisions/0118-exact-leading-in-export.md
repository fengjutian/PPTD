# 0118 行距按精确磅值写入文件，默认行距只有一个常数

## 背景

排版系统把 `TextElementStyle.lineHeight` 当作**字号的倍数**来用：

- 画布（`RichText`）用 CSS `line-height` 直接画；
- 预览渲染器按 `fontSizePt × lineHeight` 逐行下移；
- 审计、重排、质量门和 `fit-text` 命令都按 `fontSizePt × lineHeight` 估算文字高度。

导出却写成 `lineSpacingMultiple: lineHeight`，PptxGenJS 把它翻成 OOXML 的 `<a:spcPct>`。`spcPct` 不是"字号的百分比"，而是**字体单倍行距的百分比**，而单倍行距本身约为 1.2em。于是：

| `lineHeight`    | 页面上的行距 | 文件里的行距              |
| --------------- | ------------ | ------------------------- |
| 1.25（默认）    | 1.25em       | 不写，PowerPoint 用 1.2em |
| 1.3（主题正文） | 1.3em        | 130% ≈ 1.56em             |
| 1.5（列表）     | 1.5em        | 150% ≈ 1.8em              |

两个后果：

1. **预览与文件不一致**：同一页在预览里是 1.3em，在 PowerPoint 里接近 1.56em。
2. **文件里的字比设计的小**：文字块比测量时更高，`normAutofit` 于是把字号缩小一档——导出稿的字比设计页小，这正是"预览看着对、打开却不一样"的一类。

同时仓库里存在四个"默认行距"：画布 CSS 1.2、预览/审计/重排 1.25、`textOverflowsFrame` 1.2、`fittingTextSize` 1.2 且带 1.08 容差。同一个文本框，判它是否溢出的人和修它的人用的是不同的行距。

## 决策

### 1. 文件写精确行距

导出改为 `lineSpacing: (style.lineHeight ?? DEFAULT_LINE_HEIGHT) × style.fontSizePt`，PptxGenJS 写 `<a:lnSpc><a:spcPts val="…"/></a:lnSpc>`，即 PowerPoint 的"固定值"。文件、画布、预览和测量从此是同一个行距，文字块高度也一致，`normAutofit` 不再因为行距差而缩字。

### 2. 默认行距只有一个常数

`DEFAULT_LINE_HEIGHT = 1.25`（`core/rendering/text-fit.ts`）被画布、预览渲染器、审计、重排、质量门和导出共同引用；样式没写行距时六处取同一个值。

### 3. 适配/修复用同一个谓词

`fittingTextSize` 不再自带 `1.2` 行距和 `1.08` 容差，而是逐个字号调用 `textOverflowsFrame(候选元素)`，直到放得下。判它溢出的人和修它的人从此是同一段代码。

## 后果

- 一页多行正文在文件里会比以前**紧约 20%**，与预览一致；这不是视觉变紧，而是文件此前一直比设计松。
- 行距使用"固定值"：若样式要求 1.08 这类接近字面高度的行距，`Exactly` 可能裁到超出字面高度的西文上下伸部。设计侧的最小行距是 1.08（显示标题），中文标题不受影响；需要更紧的行距时应在设计侧放松，而不是让文件回到百分比。
- 视觉回归的参考图没有重录：夹具页面的文字都是单行，改行距只让字形移动约半个点的量级，未超过 0.2% 的像素阈值。夹具加入多行正文页时需要重录一次参考图（`PPTD_VISUAL_BASELINE=update`）。
- `lineSpacingMultiple` 不再出现在导出代码里；以后若需要"相对单倍行距"的表达，必须在设计侧转换成 em 倍数，而不是直接写百分比。

## 验证

- `export-pptx.test.ts`：28pt、行距 1.5 → `spcPts val="4200"`；无行距的 20pt → `spcPts val="2500"`；不再出现 `spcPct val="130000"`。
- `commands-template.test.ts`：`fit-text` 缩字后 `textLikelyOverflows` 为假——判据与修复共用同一行距。
- `RichText.test.tsx`：画布行数等于 `estimateTextLines`，默认行距同样是 1.25。
- 用真实 PowerPoint 渲染导出夹具（封面与指标页）逐页查看：中英文均无裁切，行距与预览一致。
