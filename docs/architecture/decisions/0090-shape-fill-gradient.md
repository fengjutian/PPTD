# 0090：形状支持原生渐变填充

## 状态

已接受（2026-10-25）。用于封面、章节页的大面积强调色块，以及后续主题设计。

## 背景

生成页的封面和章节页使用整块强调色矩形。纯色在深色主题下显得生硬，也不符合“多使用渐变”的设计方向。但 PptxGenJS 4.0.0 的形状填充只有 solid/none，没有渐变 API；若用渐变图片代替，会把本可编辑的原生形状降级成图片，违反导出保真目标。

## 决策

1. `ShapeElementStyle` 增加可选 `fillGradient`：

   - `angleDeg` 采用 DrawingML 约定（0° 向右，90° 向下）；
   - `stops` 为 2–10 个 `{ offset, color, transparency? }`，按 offset 递增；
   - `fill` 继续保留，作为纯色回退。

2. 封面与章节页的强调色块由主题 accent 生成三档渐变（亮肩、主色、深边），45°；细规则线保持纯色。

3. 三端一致：

   - 画布渲染器用 `createLinearGradient`；
   - 编辑器矩形/椭圆用 CSS 渐变，其他预设形状用 SVG `<linearGradient>`；
   - 导出器先用纯色写入 PptxGenJS，再在打包后的 slide XML 中按 `objectName` 定位原形状，把 `<a:solidFill>` 替换为 `<a:gradFill>`，保持形状本身可编辑。

4. 渐变写入失败时保留纯色回退，并在导出报告 `warnings` 中记录数量；不阻断导出。

5. 显式修改形状纯色（`set-shape-style.fill` 且未同时给 `fillGradient`）会清除旧渐变，避免用户选了新颜色却仍被旧渐变覆盖。

## 后果

正面：

- 渐变是原生 PowerPoint 渐变，形状仍可选中、改大小、改渐变角度和色标。
- 预览、编辑器、PPTX 三端一致；用 LibreOffice 渲染导出的封面确认渐变生效。
- 旧文档不受影响：字段可选，不需要 schemaVersion 迁移。

代价与限制：

- `linkThemeColors` 的主题色引用不会重写渐变里的 `srgbClr`；在 PowerPoint 里改主题色不会自动重算渐变，需要重新应用主题。
- 表格表头、图表系列等仍使用纯色；它们有各自的填充路径，不在本次范围。
- PptxGenJS 没有原生渐变 API，导出依赖 XML 后处理；已有单测覆盖替换与回退。

## 验证

- `src/core/design/shape-gradient.test.ts`：色标混合、角度换算、透明度和 CSS 输出。
- `src/core/document-model/schema.test.ts`：接受合法渐变，拒绝乱序色标。
- `src/features/pptx-export/shape-gradient-xml.test.ts`：只替换指定形状的填充，保留描边，找不到形状时原样返回。
- `src/features/pptx-export/export-pptx.test.ts`：样张导出包含 `<a:gradFill>`，无渐变回退警告。
- `src/features/editor/ShapeView.test.tsx`：编辑器输出 CSS 渐变。
- 全量 Vitest 通过；LibreOffice 实际打开导出的 政务红 样张，封面渐变正常。
