# 0101 语义色阶扩到八个角色，并按页面明暗重新解析

## 状态

已接受（2026-10-25）。修订 [ADR 0098](0098-semantic-color-roles.md)：0098 的四个角色保留，本 ADR 补齐另外四个，并修掉"浅色预设套深色页面"的角色错配。

## 背景

ADR 0098 给出 `surfaceRaised` / `border` / `textMuted` / `accentSubtle` 四个角色，解决了"页面只能画线"的问题。落地后发现两处不足：

1. **只有浮起，没有下沉。** 对比页、表格斑马底、分区底都需要一个"低于页面"的面，用 `surfaceRaised` 代替会让两个层次都往上浮。
2. **只有浅分隔线，没有边界线。** 卡片描边用 `border` 合适，但分栏线、选中边需要一条能读成"线"的边界，hairline 在投影和缩放后会消失。
3. **没有可承载文字的实心强调色。** 浅金、浅橙等品牌色上写白字只有 2:1；配方若直接用 `accent` 做实心，标签就成了糊块。

同时暴露了一个既有缺陷：**预设里存的是"它自己那个底色"派生出来的角色值**，页面构建却无条件复用。浅色预设的 deck 里出现一页深色页时，页面拿到的是预设的近白色 `surfaceRaised`，而这一页仍然用浅色墨——白底浅字的卡片，读不出来。

## 决策

### 1. 八个角色

| 角色            | 职责                     | 来源     |
| --------------- | ------------------------ | -------- |
| `surfaceRaised` | 浮起面                   | ADR 0098 |
| `border`        | 细线、卡片描边           | ADR 0098 |
| `textMuted`     | 次要文字                 | ADR 0098 |
| `accentSubtle`  | 强调色低强度填充         | ADR 0098 |
| `surfaceSunken` | 下沉面（分区、斑马底）   | 本 ADR   |
| `borderStrong`  | 需要读成线的边界         | 本 ADR   |
| `accentStrong`  | 可承载 `onAccent` 的实心 | 本 ADR   |
| `onAccent`      | 实心上的墨色             | 本 ADR   |

### 2. 派生规则（`deriveSemanticColors`）

- 浮起面往"远离页面"的方向走：深色页向白 10%，浅色页向墨 5%。
- 下沉面往另一侧走：深色页向黑 22%，浅色页向墨 10%（比浮起面更强，两者才能区分）。
- `border` 14%（浅）/ 20%（深）；`borderStrong` 30%（浅）/ 36%（深）。
- `accentStrong = fillForInk("#FFFFFF", accent)`：只在白字读不清时才加深，浅金橙因此保留色相而不是变成另一种颜色。
- `onAccent = readableTextColor("#FFFFFF", luminance(accentStrong))`：优先白字，读不清才换深色墨。
- `textMuted` 仍按对比度逐档回退（0098 的规则）。

### 3. 存储的角色只在同类页面上复用

新增 `sameAppearance(a, b)`：两边同属浅色或同属深色时返回 true。页面构建改为：

```text
rolesFitThisPage = 预设存在 且 sameAppearance(预设底色, 本页底色)
角色值 = rolesFitThisPage ? 预设存储值 : 按本页底色现算
```

于是"浅色预设 + 深色页"会现场派生一套深色角色，而不是把近白色的浮起面交给浅色墨。预设仍然在浅色页上提供设计师写定的值，模板页照旧现算。

### 4. 不新增 Schema

`DocumentTheme.colors` 仍是 `{ name, value }[]`，八个角色只是多四个键；旧项目缺这四个键时按派生补齐，不迁移。

## 后果

正面：

- 对比页能画出"两张卡片 + 两个实心栏目头"，深色页与浅色页共用同一套配方（`comparison.ts` 已消费四个新角色）。
- 品牌色偏浅时，栏目头自动加深到白字可读，不再依赖事后修墨。
- 角色错配这个缺陷有了回归夹具：`tools/design-preview/fixture.ts` 的 `buildVocabularyPreviewDocument()` 是一份三页深色文稿。

代价与限制：

- `surfaceSunken` 与 `surfaceRaised` 在纯白页上差异只有 5 个百分点，肉眼偏弱；需要更强对比时应改用 `panel`（饱和面）而不是加深下沉面。
- 深色页的 `accentStrong` 与深色底可能接近，栏目头靠 `onAccent` 的浅色字读出来，而不是靠块本身；这是可接受的取舍，但视觉评审仍需关注。
- 八个角色目前只有四页配方在消费（对比页、图文页），其余消费者在 WP2 的卡片与阴影里。

## 验证

- `design-tokens.test.ts`：深/浅两组浮起面与下沉面方向相反；`borderStrong` 比 `border` 更强；浅金强调色上 `onAccent` 对 `accentStrong` ≥ 4.5:1；深强调色时 `accentStrong` 保持原色且 `onAccent` 为白；`sameAppearance` 的三种组合。
- `theme-presets.test.ts`：17 套预设都写入八个角色，`surfaceRaised` / `surfaceSunken` 都不等于页面底色，槽名不重复。
- `recipes.test.ts`：对比页每栏一个下沉面 + 一个实心栏目头，标签使用 `onAccent`，中线使用 `borderStrong`；模板带装饰时不下沉面。
- `design-preview.test.ts`：深色三页基线里，页面不再出现预设存储的浅色角色；栏目头文字对块底 ≥ 4.5:1；深色封面题板不是预设的浅色值。
- 真实渲染：PowerPoint 导出（`.tmp/vocab-v2`、`.tmp/preview-v2`）逐页目视，浅色页与深色页都可读。

## 备选方案

- **把深色角色存成 `dark:` 前缀的独立槽位**：语义清楚，但每个页面仍要在两套值之间选一次，等于把 `sameAppearance` 的判断挪进数据；当前选择留在代码里，只有一处。
- **照 Radix 12 阶做满**：演示页没有 hover/disabled，多数台阶没有消费者；不采用（0098 已记录）。
- **让配方自己挑角色**：配方会各写一套判断，深浅页行为不一致；不采用。
