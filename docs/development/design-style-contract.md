# AI 样式合同：AI 决定什么，代码保证什么

## 结论

PPTD 采用**受约束的样式委托**：

- AI 决定艺术方向、页面配方、构图意图、配色角色、配图意图与数据关系；
- 代码决定坐标、字号、字体、间距、安全区、裁剪、内容不丢、导出对象与校验。

这不是“AI 自由设计、代码照单实现”。AI 的每个选择都必须落在封闭词汇表里，代码有权拒绝装不下内容的方案；AI 不写坐标、字号或 CSS。

## 字段矩阵

### 整册

| 字段                                                     | 谁决定                       | 代码保证                                                    |
| -------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `preset`（editorial / documentary / paper / instrument） | AI                           | 只允许可渲染预设；surface 边距、栏线/竖线与强调线由代码决定 |
| `name` / `idea` / `rationale`                            | AI                           | 长度与字段校验；不得改写内容                                |
| `typeContrast` / `imagery`                               | AI                           | 按预设收敛为合法策略；配图角色由代码放置                    |
| 调色板                                                   | AI 选 palette 角色或十六进制 | 对比度、主题槽位、导出颜色由代码解析                        |

### 单页

| 字段                                     | 谁决定                          | 代码保证                                                                        |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `layout`                                 | AI                              | 只允许固定枚举；不直接产生几何                                                  |
| `composition` / `visualNarrative`        | AI                              | 映射为构图族；冲突时回退                                                        |
| `recipe`                                 | AI 可选                         | `recipe.supports()` 校验内容装得下；否则拒绝或回退                              |
| `designPlan.role`                        | AI                              | 代码据此选配方（无显式 recipe 时）                                              |
| `designPlan.composition.ratio`           | AI                              | 代码换算为分栏比例；越界夹取                                                    |
| `designPlan.density`                     | AI                              | `claim` / `summary` 在 dense 时改用 asymmetric-split；其余角色保持内容事实优先  |
| `designPlan.typeScale`                   | AI 选 compact/normal/expressive | 代码按令牌乘系数并夹取字号；AI 不写点数                                         |
| `designPlan.focal`                       | AI                              | `title` → 标题层；`number` / `image` / `chart` → 正文层；只影响字阶，不产生坐标 |
| `designPlan.chart`                       | AI 决定关系与首选图型           | 代码按关系覆盖不兼容图型；数据仍来自已审核 metric 块                            |
| `designPlan.templatePolicy`              | AI                              | `takeover` 由代码绘制干净内容面，保留页眉/Logo/页脚                             |
| 颜色 / palette                           | AI                              | 代码解析为主题色槽，保证对比与导出                                              |
| `visualAsset`                            | AI 描述画面                     | 代码决定位置、裁剪、占位与是否启用                                              |
| `variant` / 顶层 `focal` / 顶层 `recipe` | AI（legacy 路径）               | 仅在**没有** `designPlan` 时生效；有 plan 时以 plan 为准                        |

### 代码独占

- 坐标、EMU、字号、字体族、行高、字阶；
- 页面 chrome（标题轴、页码、页脚、安全区）；
- 内容消费守卫（`consumptionProblem`）、内容哈希与 revision；
- 图片裁剪、占位、导出原生对象；
- 语义色阶（`surfaceRaised` / `border` / `textMuted` / `accentSubtle`）的派生值：AI 只能选调色板角色，这四个值由 `deriveSemanticColors` 按页面真实底色与墨色算出（ADR 0098）；
- 体检、概念分封顶、评审证据等级、导出回读。

## 视觉词汇的边界

代码保证的视觉手段是封闭集合，AI 只能在集合内选择：

| 手段     | 可用取值                                             | 说明                                      |
| -------- | ---------------------------------------------------- | ----------------------------------------- |
| 图片构图 | `image-led` / `side-image-text` / `full-bleed-image` | 后两者按内容形状自动选择，ADRP 0099       |
| 浮起面   | `surfaceRaised`                                      | 卡片、题板、色带；不使用透明度            |
| 分隔     | `border` 细线、`chrome.rule` 强调线                  | 深色页面自动改用浅墨                      |
| 次要文字 | `textMuted`                                          | 图注、来源、副标题                        |
| 强调填充 | `accentSubtle`                                       | 标题色带；强度受对比度约束                |
| 标题字族 | `majorFont` 或 `theme.displayFont`                   | 只影响 display 尺寸，体检允许一种额外字族 |

不在此表内的视觉效果（半透明蒙版、多图拼贴、渐变文字、任意 SVG）没有渲染实现，不得在提示词里承诺。

## 本轮修复的缺失

### 1. `focal` 之前只进合同

`PageDesignPlan.focal` 在 Schema 与提示词里存在，但编译器从未读取。现在映射到配方层的 `focal`：

- `title` → `title`，标题层放大；
- `number` / `image` / `chart` → `body`，正文层放大；
- `none` / 缺省 → 不干预。

配方只在自身支持时响应，代码仍负责最终字阶与溢出。

### 2. `density` 之前只进合同

现在 `density: "dense"` 会让 `claim` / `summary` 在没有更强内容事实时选择 `asymmetric-split`，而不是短文案默认的 `editorial-index`。`sparse` 保持 editorial-index 的留白路径。

这是有限但真实的接线：配方没有统一的“密度参数”，所以密度只影响配方选择，不直接改坐标。

### 3. `emphasis` 没有实现路径，已从 AI 合同移除

`PageDesignPlan.emphasis` 原本承诺“字符范围加粗”，但配方生成的是整段文本，没有 blockId → run 的映射，无法安全实现。继续保留只会让模型输出一个被忽略的字段。

处理：

- 从 `PageDesignPlan`、`pageDesignPlanSchema` 与设计提示词中删除；
- 不做“假装支持”的降级；
- 若未来要做，需要先给配方文本元素建立 block/range 映射，再单独加 ADR。

### 4. 新增 `typeScale` 字阶意图

AI 可以选择 `compact` / `normal` / `expressive`，但只能表达意图：

- 代码按令牌乘以有界系数：display ×0.90–1.12、title ×0.92–1.08、body ×0.96–1.04；
- 最终仍夹在 24–96 / 18–56 / 12–28pt；
- 体检、溢出与内容消费守卫照常运行。

AI 不写点数，也不直接控制字体族。

## 扩展规则

新增一个 AI 样式字段时，必须同时满足：

1. 在 `PageDesignPlan` 或 `AiSlideDesign` 里有明确类型；
2. 在 Schema 与提示词中说明取值范围；
3. 在编译器或配方里有真实消费点；
4. 有行为测试（不是只测 Schema 接受）；
5. 若暂时不消费，**不要加进 AI 合同**，或明确标为 reserved 并从提示词移除；
6. 同步更新 `design-contract.test.ts` 的“有消费点”清单；清单与 Schema 不一致会直接失败。

## 验证

- `design-compiler.test.ts`：dense claim/summary 选 asymmetric-split；`focal: number` 提升正文层字号。
- `design-contract.test.ts`：plan 字段与消费点清单一致，`emphasis` 不会回流。
- `ai-service.test.ts` / `prompt-regression.test.ts`：设计 Schema 不再接受 plan.emphasis，既有输出仍通过。
- 全量测试、类型检查、构建、`cargo check` 通过。

## 已知边界

- 字体与字阶仍由主题预设与设计令牌决定，AI 只选颜色角色；
- 配方没有通用密度参数，density 只影响选择，不改变同一配方的间距；
- 顶层 `recipe` / `variant` / `focal` 在 `designPlan` 存在时被忽略，这是有意优先级；
- AI 仍不能输出坐标、字号、装饰元素或任意 CSS。
