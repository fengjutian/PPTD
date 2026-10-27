# TASK-DESIGN-036：低代码布局编辑器与 AI 布局协作

> **状态（2026-10-27）：** 部分实现。阶段 A（`LayoutTree` Schema、节点注册表、编译器、槽位分配与确定性测试）已完成；阶段 B–E（树/属性面板、AI 节点级工具与提案差异、持久化与模板复用、批量排版治理）未开始。完整盘点见 [实现状态](../implementation-status.md)。

## 1. 目标

在现有绝对定位画布之上增加可视化的声明式布局能力。用户可以通过容器、槽位和属性面板搭建可复用页面骨架；AI 可以通过受控 Workbench 工具检查布局、创建草稿、编译、修正并提交提案。最终页面继续使用同一个 `PresentationDocument` 渲染和导出，普通对象保持 PowerPoint 原生可编辑性。

本任务遵循 [ADR 0114](../../architecture/decisions/0114-declarative-low-code-layout-system.md) 和 [ADR 0113](../../architecture/decisions/0113-ai-ppt-workbench-boundary.md)。

## 2. 非目标

- 不实现通用网页搭建器、CSS 解析器或脚本表达式。
- 不允许 AI 直接修改正文、数字、引用、备注或页面语义顺序。
- 不在首版支持跨页面流式排版、母版高保真编辑或任意 PPTX 布局导入。
- 不用整页图片代替文本、形状、图片、表格和常规图表的原生对象。
- 不在本任务中直接修改持久化 Schema；持久化需单独包含迁移和固定样例。

## 3. 用户工作流

### 3.1 创建布局

1. 用户从空白、左右分栏、上下分区、卡片网格等骨架开始。
2. 在画布或布局树面板中插入 `section/row/column/grid/slot`。
3. 在属性面板设置尺寸策略、间距令牌、对齐、列数及最小/最大尺寸。
4. 将页面已有内容绑定到槽位。
5. 编译器实时显示可用空间、溢出、未消费内容和重叠问题。
6. 用户确认后，以单个设计事务应用到页面。

### 3.2 编辑自动布局对象

- 拖动分隔线调整兄弟节点的整数 `fraction` 权重。
- 拖动对象时先展示“调整布局”“移动槽位”“脱离自动布局”三种语义，不直接写临时坐标。
- 高频拖动只保存在交互层，释放时产生一个命令和一个撤销项。
- `detached` 对象保留绝对几何，后续重新编译不得覆盖。

### 3.3 AI 协作

入口包括“AI 重新排版本页”“把这些对象整理成网格”“为当前内容推荐布局”。AI 先生成草稿提案，界面展示前后预览、对象移动摘要、诊断和未解决问题。用户确认后才提交；取消不改变文档和撤销栈。

## 4. 建议领域合同

以下类型用于约束设计方向，正式实现时必须配套运行时 Schema，不能以 `Record<string, unknown>` 代替：

```ts
type LayoutNode = CanvasNode | SectionNode | RowNode | ColumnNode | GridNode | SlotNode;

type LayoutSize =
  | { mode: "fixed"; value: number }
  | { mode: "fraction"; weight: number }
  | { mode: "fill" }
  | { mode: "content"; min?: number; max?: number };

interface LayoutNodeBase {
  id: string;
  width: LayoutSize;
  height: LayoutSize;
  padding?: LayoutSpacing;
  gap?: LayoutSpacingToken;
  layoutState: "managed" | "detached" | "overlay";
}

interface SlotNode extends LayoutNodeBase {
  type: "slot";
  role: "title" | "body" | "image" | "chart" | "table" | "metric" | "decoration";
  contentRef?: string;
  fit?: "contain" | "cover" | "stretch";
}
```

约束：

- 节点 ID 是稳定 UUID/ULID 字符串，不使用数组索引作为持久引用。
- `canvas` 只能是根；树必须无环并限制深度和节点总数。
- `row/column/grid` 才能拥有多个子节点；`slot` 不能有子节点。
- `fraction` 使用正整数权重，避免浮点百分比累积误差。
- `fixed` 使用 normalized-1000 逻辑整数，不把 EMU、英寸或像素暴露给 AI。
- 一个 `contentRef` 默认只能被一个消费型槽位绑定；装饰性重复必须使用显式能力。

## 5. AI 工具协议

### 5.1 会话建立

`createPptWorkbench` 增加布局草稿能力时，输入只读页面快照和 revision 基线。向模型提供：

- 工具定义与 JSON Schema。
- 页面/模板能力和设计令牌。
- 内容块 ID、类型、数量、测量摘要。
- 当前布局树摘要、槽位和诊断。

不得提供可写文档对象、API Key、文件路径或任意系统工具。

### 5.2 典型工具调用

```json
{"kind":"tool-call","name":"layout.inspect","input":{"target":"page"}}
```

```json
{"kind":"tool-call","name":"layout.suggest","input":{"goal":"balanced-two-column"}}
```

```json
{
  "kind":"tool-call",
  "name":"layout.node.update",
  "input":{"nodeId":"content-row","patch":{"gap":"lg"}}
}
```

```json
{"kind":"tool-call","name":"layout.compile","input":{}}
```

工具返回统一结构：

```ts
type LayoutToolResult<T> =
  | { ok: true; value: T; draftRevision: number }
  | { ok: false; issues: WorkbenchIssue[]; draftRevision: number };
```

失败调用不递增 `draftRevision`，也不改变布局草稿。成功的写调用只改变会话草稿，不改变 `PresentationDocument`。

### 5.3 最终提案

模型最终返回的不是任意页面 JSON，而是对当前 Workbench 草稿的完成声明：

```ts
interface LayoutProposalResult {
  kind: "layout-proposal";
  draftRevision: number;
  summary: string;
  unresolvedIssueCodes: string[];
}
```

应用层从 Workbench 读取强类型命令计划，验证：

1. 模型声明的 `draftRevision` 与当前草稿一致。
2. document/content/design revision 与会话基线一致。
3. 编译报告没有硬错误。
4. 内容引用集合与会话开始时一致，没有静默删除或改写。
5. 命令全部属于设计命令白名单。

通过后才能生成预览或提交。提交使用一个领域事务；任一检查失败都不部分应用。

### 5.4 修正循环

AI 收到的诊断应包含稳定 code、节点路径、可公开的测量值和建议动作，不返回堆栈或完整正文。例如：

```json
{
  "code": "INSUFFICIENT_CAPACITY",
  "paths": ["content-grid", "metric-4"],
  "message": "四个指标槽在当前两列网格中高度不足",
  "suggestions": ["increase-rows", "reduce-gap", "choose-alternate-skeleton"]
}
```

AI 最多进行有界轮数的修正。达到上限后返回当前最佳提案和未解决问题，不得绕过质量门。

### 5.5 并发、幂等与工具预算

- 每个写调用必须包含唯一 `callId` 和预期 `draftRevision`。
- 重复 `callId` 返回首次执行结果，不重复增加节点或绑定内容。
- 旧 `draftRevision` 返回 `DRAFT_REVISION_CONFLICT`，AI 必须重新检查后再决定是否重试。
- 单次会话建议限制为：最多 12 轮、100 个节点、8 层嵌套、32 个内容绑定；具体值在实现探针后冻结。
- 单次工具输入、返回结果和完整 transcript 分别设置序列化字节上限；超限返回稳定错误。
- 连续相同错误不得无限重试；编排器应把重复诊断计入循环终止条件。

### 5.6 AI 提案差异

确认界面使用结构化差异，不只显示模型总结：

- 新增、删除、移动和属性变化的布局节点。
- 受影响对象及其前后槽位。
- 内容绑定是否变化；内容值必须保持不变。
- 硬错误和软问题的前后数量。
- 字体替代、测量估算、对象降级及未支持能力。
- 可复现摘要：基线 revision、布局注册表版本、测量快照 ID 和工具轨迹摘要。

用户可以接受全部提案或取消。首版不接受任意部分 patch，以免破坏树和内容绑定不变量；未来如支持部分接受，必须按编译后仍闭合的变更组提供。

## 6. UI 设计

### 6.1 布局树面板

- 显示节点类型、名称、绑定内容和错误状态。
- 支持受限拖放排序和层级调整。
- 非法放置在拖放预览阶段阻止。
- 选择树节点与选择画布对象双向同步，但选择本身不改变 document revision。

### 6.2 属性面板

按节点类型显示白名单属性：

- 容器：方向、宽高策略、权重、gap、padding、对齐、分布。
- 网格：列数、行策略、单元最小尺寸。
- 槽位：语义角色、内容绑定、图片适配和对齐。
- 对象：自动布局状态、锁定、层级；精确几何只在 `detached/overlay` 时可编辑。

页面和卡片默认使用白色、浅灰色体系；画布周围可保留沉浸式中性背景。

### 6.3 画布反馈

- 容器边界、gap 和 padding 使用非导出的辅助层显示。
- 溢出、未消费内容和硬冲突使用明确标记，不只依赖颜色。
- AI 修改以 ghost overlay 展示旧/新位置，确认前不写文档。
- 预览必须与相同布局编译结果驱动画布和导出，不能建立第二套 UI 几何。

## 7. 编译与命令边界

```text
LayoutTree draft
  → parse/validate
  → lower to geometry operations
  → content measurement
  → slot allocation
  → design/taste validation
  → DesignCompileReport
  → DocumentCommand[]
  → one transaction
```

- 编译是纯过程，不直接修改文档。
- 编译输入使用不可变页面和内容快照。
- 自动保存不记录 Workbench 临时草稿，也不污染撤销栈。
- 应用布局只增加 design/document revision；内容 hash、content revision 和审核状态保持不变。
- 如果布局操作需要拆页、删减或改写内容，返回建议并退出设计事务。

### 7.1 编译阶段

编译器分为可独立测试的阶段，并为每一阶段输出稳定诊断：

1. `normalize`：补齐注册表默认值，不修改显式输入。
2. `validate-tree`：检查类型、引用、父子关系、深度和数量。
3. `resolve-inheritance`：合成定义、绑定和页面覆盖。
4. `measure`：产生有版本的 `MeasurementSnapshot`。
5. `allocate`：按稳定顺序和整数余数规则分配矩形。
6. `bind`：验证内容类型、重复消费和未消费内容。
7. `audit`：执行边界、重叠、可读性和设计质量检查。
8. `emit`：产生槽位、EMU 几何、命令计划及报告。

任一阶段不得回写前一阶段输入。`normalize` 后的规范树和最终报告可用于调试，但日志不得包含完整用户正文。

### 7.2 缓存与性能

- 缓存键至少包含规范树摘要、内容测量输入、页面尺寸、主题令牌、字体解析和编译器版本。
- 只改变一个节点时可以增量重算受影响子树；提交前仍执行整页审计。
- 画布拖动预览以一帧内反馈为目标；昂贵文本测量允许异步更新，但必须显示“测量中”，不能展示为已经通过。
- AI 批量排版按页隔离编译，单页失败不污染其他草稿。

### 7.3 布局能力注册表验收

每个节点类型的注册必须同时提供类型、运行时 Schema、默认值、父子约束、属性编辑器描述、编译器、AI 权限和行为测试。缺少任一项时不能出现在 UI 组件库或 AI 工具清单中。

## 8. 分阶段实施

### 阶段 A：会话草稿和编译器

- 定义非持久化 `LayoutTreeDraft`、Schema 和限制。
- 实现 `row/column/grid/slot` 编译到现有几何函数。
- 实现槽位绑定、内容完整性和容量诊断。
- 为相同输入的确定性槽位和 EMU 建立测试。
- 建立布局能力注册表和版本号，避免 UI、AI Schema 与编译器能力漂移。
- 冻结整数余数分配规则和 `MeasurementSnapshot` 合同。

### 阶段 B：用户低代码编辑

- 增加布局树面板、属性面板和辅助层。
- 支持骨架创建、节点增删移动、比例拖动和脱离布局。
- 接入命令事务、revision、撤销/重做。
- 用左右图文、四卡片、指标网格和双栏对比完成组件测试。

### 阶段 C：AI 工具交互

- 在 Workbench 中增加节点级读写、编译、预览和计划工具。
- 实现提案差异、用户确认、取消和 revision 冲突。
- 增加工具调用轮数、体积、节点数、深度和日志脱敏限制。
- 测试错误调用不改变草稿，失败/取消不改变项目。
- 实现 `callId` 幂等、草稿 revision 冲突、重复错误终止和结构化质量差异。

### 阶段 D：持久化与模板复用

- 明确 `layoutSchemaVersion`，提供迁移和固定文档样例。
- 模板保存布局骨架，页面保存绑定及允许的覆盖。
- 建立模板升级预览，不静默重排已有页面。
- 更新保存、恢复、导出夹具和兼容报告。

### 阶段 E：批量排版与设计系统治理

- 增加 deck 级布局族和跨页一致性审计，不改变页面语义顺序。
- 支持逐页预览、失败页隔离和明确的整体/部分提交模式。
- 建立布局注册表、模板定义和编译器版本升级策略。

## 9. 验收场景

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| L01 | 创建 40/60 左文右图布局 | 编译结果稳定、无重叠，导出为原生文本和图片对象 |
| L02 | 四个指标绑定到两列网格 | 等宽等距，内容全部消费，画布与导出坐标一致 |
| L03 | 拖动列分隔线 | 只提交一个设计事务，撤销一次恢复原比例 |
| L04 | 将对象脱离自动布局 | 后续重编译不覆盖其几何，状态可撤销 |
| L05 | AI 检查后调整网格 | 每个工具调用可回放，用户确认前文档不变 |
| L06 | AI 尝试改正文或传入任意坐标 | 工具拒绝，返回稳定权限/Schema 错误 |
| L07 | AI 调整过程中页面被用户修改 | 提交返回 `REVISION_CONFLICT`，不部分应用 |
| L08 | 内容超出槽位容量 | 返回硬诊断；不删除内容、不缩到不可读、不静默截断 |
| L09 | 用户取消 AI 提案 | 文档、revision、撤销栈和自动保存状态不变 |
| L10 | 页面尺寸改变 | 从布局树重新编译，所有最终几何仍是整数 EMU |
| L11 | 重复发送同一 AI 写调用 | 返回首次结果，节点和 draft revision 不重复变化 |
| L12 | 字体缺失后重新测量 | 报告字体替代和测量快照变化，不无声漂移 |
| L13 | 模板定义升级 | 显示受影响页面和迁移预览，确认前实例不变 |
| L14 | 同一输入重复编译 100 次 | 规范树、槽位、EMU 和诊断顺序完全一致 |
| L15 | AI 提案质量变差 | 差异显示质量下降；硬错误阻止确认提交 |
| L16 | 批量排版中一页失败 | 失败页隔离，用户明确选择整体取消或排除失败页提交 |

## 10. 测试要求

- Schema：未知节点、循环、重复 ID、非法引用、过深树和超量节点。
- 几何：fraction 分配、余数分配、嵌套 padding/gap、边界与重叠。
- 内容：类型不匹配、重复消费、未消费、文本溢出和测量不可用。
- 命令：design revision 增加，content revision/hash 不变，撤销/重做正确。
- Workbench：工具白名单、失败原子性、轮数/体积限制、取消和 revision 冲突。
- Workbench：`callId` 幂等、旧 draft revision、重复错误终止和可重放摘要。
- UI：树与画布选择同步、拖动只形成一个事务、AI 差异确认。
- 导出：页数和顺序不变，普通对象原生可编辑，报告记录降级和未支持能力。
- 确定性：固定注册表和测量快照时，多次编译的槽位、EMU、命令和诊断排序一致。
- 性能：为单页典型树、上限树和十页批量建立基准，阈值由阶段 A 探针冻结。
- 生产构建、TypeScript、ESLint、相关 Rust 检查全部通过。
