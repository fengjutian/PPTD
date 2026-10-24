# 0084 设计计划的样式权限边界

## 状态

已接受（2026-10-25）。

## 背景

`PageDesignPlan` 与 AI 设计 Schema 逐步增加了 `density`、`focal`、`emphasis` 等字段，但编译器只消费了 `role`、`composition.ratio`、`recipe`、`chart`、`templatePolicy`。

结果是合同比实现大：模型被要求认真选择，代码却忽略；测试只验证 Schema 接受，无法发现字段没有行为。`emphasis` 甚至承诺了“字符范围强调”，但配方没有 blockId → run 的映射，根本无从实现。

## 决策

### 1. 权限边界写死

- AI：艺术方向、配方、构图意图、配色角色、配图意图、数据关系、页面密度倾向、第一视觉对象。
- 代码：所有几何、字号、字体、间距、安全区、裁剪、内容消费、导出对象与校验。
- AI 不写坐标、字号、CSS、装饰元素，也不能绕过内容守卫。

### 2. 能落地的字段必须接线

- `focal` 映射到配方层：`title` → 标题层；`number`/`image`/`chart` → 正文层。
- `density: "dense"` 让 `claim`/`summary` 在没有更强内容事实时选择 `asymmetric-split`；`sparse` 保持 `editorial-index` 的留白路径。

密度只影响配方选择，因为配方没有统一的间距参数；不假装它能改同一配方的几何。

### 3. 不能落地的字段从合同移除

`emphasis` 从 `PageDesignPlan`、Schema 与提示词中删除。未来若实现，需要先为配方文本建立 block/range 映射，再单独决策。

### 4. 有 plan 时，plan 优先

存在 `designPlan` 时，顶层 `recipe`、`variant`、`focal` 不参与编译；这是有意优先级，避免两套样式指令互相覆盖。文档与提示词必须说明。

### 5. 新字段的准入条件

必须同时有类型、Schema、提示词、真实消费点、行为测试。只加合同不加消费点的字段不允许进入 AI 输出。

## 后果

正面：

- 合同与实现一致，模型不会再输出被静默忽略的字段。
- `focal` 与 `density` 从“装饰性字段”变成真实行为。
- 权限边界可测试、可解释。

代价与限制：

- `density` 只影响配方选择，不是通用间距控制；同一配方内仍由代码决定密度。
- 删除 `emphasis` 是一次合同收缩；依赖该字段的旧模型输出会被 Zod 丢弃（对象非 strict），不会报错，但也不会生效。
- 字体与字阶仍不由 AI 控制；这是设计与内容安全的取舍。

## 验证

- `design-compiler.test.ts`：dense claim/summary → asymmetric-split；`focal: number` 提升正文层字号。
- 全量测试、类型检查、ESLint、生产构建、`cargo check` 通过。

## 备选方案

- **保留 `emphasis` 并假装支持**：会继续制造“模型选了但没实现”的假合同。
- **把 `density` 做成通用配方参数**：需要改 12 个配方的几何，收益与风险不成比例；先只影响选择。
- **让 AI 直接写坐标/字号**：违反内容安全、跨页一致性与可测试性。
- **删除 `focal` 而不是接线**：配方已有 focal 能力，接线成本低，保留更有价值。
