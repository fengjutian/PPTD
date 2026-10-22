# 0031：主题字号令牌与内置主题预设

## 状态

已接受（2026-10-22）。

## 背景

生成器的字号是散落的魔法数：标题 30（封面 42、章节 36）、正文 18（部分分支 19、20）、说明 12。模板只提供"占位符字号"，没有"层级"概念；没有模板时更是只有一套默认值。结果是同一册里层级不稳定，模板也决定不了自己的排印关系。

参考 open-ppt-skill 的 PPTD 规范（theme.textStyles + `$token` 引用）：**设计层级应该是一份可继承的令牌，而不是每个版式分支各写一遍数字**。我们不采用它的 YAML 格式，只借这个模型。

## 决策

1. `DocumentTheme.textStyles` 增加五个命名层级：`display / title / subtitle / body / caption`；每个令牌包含 `fontSizePt`（必填）、`bold`、`color`、`lineHeight`、`letterSpacingPt`。字段可选，缺失的层级回落到默认值。
2. 新增 `resolveTypeScale(theme)`：默认 `42 / 30 / 18 / 18 / 12`，章节标题由 `display − 6` 推导；令牌字号超出 8–120pt 视为无效并回落，不让一个坏值把整册放大或缩小。
3. 生成器所有分支改为读 `typeScale`，不再写 30/36/42/18/19/20。**模板占位符的字号仍然优先**（`templateTitleSize ?? typeScale.title`），模板依旧是它自己排印的权威。
4. 新增四套内置主题预设（`src/core/design/theme-presets.ts`）：纸墨、青编、藏青、素纸。每套包含主/正文字体、色板槽位（primary / accent / muted / surface）和完整字阶；默认预设为"青编"。
5. 预设与模板主题共用同一个 `DocumentTheme` 结构，渲染器不需要为"内置主题"单开一条路径。
6. `apply-ai-designed-draft` 增加可选 `themePresetId`：没有模板主题时用预设兜底；模板主题永远优先于预设。

## 结果

- 主题第一次能表达"层级"，而不是只表达"字体和颜色"。
- 生成器的字号从 18 处硬编码收敛到一个对象；换一套预设即可整体换字阶。
- 新增 9 条测试：令牌回落与范围校验、四套预设的色板/字阶单调性、schema 接受与拒绝、生成器读取主题字号、无模板时预设兜底。

## 未覆盖

- 还没有选择预设的界面：AI 设计流程、模板选择器与属性面板都未接入，目前只能由调用方通过 `themePresetId` 指定。
- 预设的**色板与字体还没有接到生成器**：这一轮只消费字号；字体仍由 `command.fontFamily` / 模板主题决定，强调色仍来自设计。预设要真正改变观感，下一步必须把 palette 映射到 design、把 major/minor font 接到文本。
- 令牌里的 `bold` / `color` / `lineHeight` / `letterSpacingPt` 已进入 schema 与预设，但生成器只消费字号；颜色仍走对比度修复，行高仍由排版引擎固定。
- 模板导入还没有把占位符字号写回 `textStyles`，模板的层级仍靠 `templateTitleSize` 逐页传递。
