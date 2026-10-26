# TASK-DESIGN-036：低代码布局编辑器与 AI 布局协作

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

## 8. 分阶段实施

### 阶段 A：会话草稿和编译器

- 定义非持久化 `LayoutTreeDraft`、Schema 和限制。
- 实现 `row/column/grid/slot` 编译到现有几何函数。
- 实现槽位绑定、内容完整性和容量诊断。
- 为相同输入的确定性槽位和 EMU 建立测试。

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

### 阶段 D：持久化与模板复用

- 明确 `layoutSchemaVersion`，提供迁移和固定文档样例。
- 模板保存布局骨架，页面保存绑定及允许的覆盖。
- 建立模板升级预览，不静默重排已有页面。
- 更新保存、恢复、导出夹具和兼容报告。

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

## 10. 测试要求

- Schema：未知节点、循环、重复 ID、非法引用、过深树和超量节点。
- 几何：fraction 分配、余数分配、嵌套 padding/gap、边界与重叠。
- 内容：类型不匹配、重复消费、未消费、文本溢出和测量不可用。
- 命令：design revision 增加，content revision/hash 不变，撤销/重做正确。
- Workbench：工具白名单、失败原子性、轮数/体积限制、取消和 revision 冲突。
- UI：树与画布选择同步、拖动只形成一个事务、AI 差异确认。
- 导出：页数和顺序不变，普通对象原生可编辑，报告记录降级和未支持能力。
- 生产构建、TypeScript、ESLint、相关 Rust 检查全部通过。
