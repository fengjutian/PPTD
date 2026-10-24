# 0085 字阶意图由 AI 选择、代码换算

## 状态

已接受（2026-10-25）。

## 背景

字阶一直是代码独占：主题令牌与 `typeContrast` 决定 display/title/body 的点数，AI 只能选颜色与配方。这样稳定，但也让 AI 无法表达“这一页想更克制”或“这页想更大声”。

直接让 AI 写 `fontSizePt` 会破坏安全边界：模型不知道页面尺寸、模板占位、行长和溢出，点数会变成不可控输入。

## 决策

### 1. 只给三个意图

`PageDesignPlan.typeScale` 可选：

- `compact`：更克制；
- `normal`：默认；
- `expressive`：更强调。

AI 不写点数、不写字体族、不写行高。

### 2. 代码换算并夹取

`deriveDesignTokens` 在主题令牌与 `typeContrast` 之上乘有界系数：

| 层      | compact | normal | expressive |
| ------- | ------- | ------ | ---------- |
| display | 0.90    | 1.00   | 1.12       |
| title   | 0.92    | 1.00   | 1.08       |
| body    | 0.96    | 1.00   | 1.04       |

再套既有上下限：display 24–96、title 18–56、body 12–28pt。系数只影响字阶，不影响间距、坐标或颜色。

### 3. 每页独立，但默认继承

`typeScale` 属于单页 plan；没有 plan 或没有该字段时使用 `normal`。这允许一页更克制、一页更强调，同时保持整册的令牌基线不变。

### 4. 不绕过内容与体检

字阶放大后仍要经过配方容量、溢出检查、体检与内容消费守卫。`typeScale` 不是“强制放大”，只是给代码一个倾向。

## 后果

正面：

- AI 获得一个真实、可测试、不会写出非法点数的排版维度。
- 代码仍持有最终字号与溢出判断。
- 系数与上下限集中在一处，容易校准。

代价与限制：

- 只影响 display/title/body，不影响 subtitle/caption/行高；
- 同一页的配方仍可能因为内容放不下而把放大后的标题缩回去；
- 三个档位是离散的，不能表达更细的层级。

## 验证

- `design-tokens.test.ts`：compact < normal < expressive，body 同向变化。
- `commands.test.ts`：同一份内容与配方下，compact 标题小于 normal，expressive 大于 normal。
- 全量测试、类型检查、ESLint、生产构建、`cargo check` 通过。

## 备选方案

- **让 AI 直接写点数**：不可控，且与模板尺寸耦合；不采用。
- **只做整册一个 typeScale**：无法表达单页强调；当前选每页可选。
- **用连续系数**：模型更难稳定选择，也更难测试；三档足够。
- **只改标题不改正文**：会让强调页失去正文节奏；当前同步小幅调整 body。
