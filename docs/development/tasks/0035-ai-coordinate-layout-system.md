# TASK-DESIGN-035：AI 语义坐标系统与确定性布局 API

> **状态（2026-10-27）：** 部分实现。阶段 A 已完成（逻辑坐标、几何函数、Workbench 工具域与多轮工具循环）；阶段 B 部分完成（`comparison` 配方迁移、`AiLayoutProgram` 进入设计请求、编译报告记录操作/槽位/降级）；阶段 C（模板区域覆盖、障碍物规避、有界重编译、视觉回归）未开始。完整盘点见 [实现状态](../implementation-status.md)。

## 1. 目标

为 Design Agent 提供稳定、可校验的布局坐标协议。AI 只选择语义区域和布局操作，核心层负责计算精确几何、转换 EMU、绑定已审核内容并执行质量门。该系统不得允许 AI 直接修改正文、业务数字、引用、备注或页面顺序。

## 2. 坐标契约

- AI 坐标空间固定为 `normalized-1000`，左上角为 `(0, 0)`，右下角为 `(1000, 1000)`。
- 坐标、尺寸和间距必须是整数；矩形必须具有正宽高且完整位于页面内。
- `PresentationDocument` 仍只保存整数 EMU；逻辑坐标只存在于设计计划和编译过程。
- 页面尺寸变化时按页面宽高分别换算，不把像素、英寸或 EMU 暴露给 AI。

## 3. 语义区域

每页由确定性代码提供以下区域：

- `page`：整页。
- `safe`：所有可编辑主要内容的安全区。
- `title`：标题轴。
- `content`：正文区域。
- `footer`：页脚区域。
- `rail`：可选导轨区域。
- `image`：可选模板或配图区域。

预设页面从 `SurfaceProfile + PageChrome` 生成区域；模板页面以经过校验的模板占位符覆盖对应区域。标题、导轨、正文和页脚必须共享同一个坐标事实源。

## 4. AI 可调用布局操作

首版只开放有限、可组合的操作：

- `inset(source, padding)`：在区域内缩。
- `columns(source, count, gap)`：生成等宽列。
- `rows(source, count, gap)`：生成等高行。
- `stack(source, count, gap, distribution)`：按起始、居中或两端分布堆叠。

间距只能使用 `xs/sm/md/lg/xl` 令牌。后续操作可以通过稳定 ID 引用之前结果，例如 `main[0]`；不存在、循环或越界引用必须返回稳定错误，不得猜测。

## 5. 编译流程

1. 以 `unknown` 接收 AI 布局程序并执行运行时校验。
2. 解析页面语义区域和操作引用。
3. 依次执行布局函数，生成只读槽位表。
4. 校验页面边界、父区域包含关系、同组重叠和关键轴线。
5. 将槽位转换为 EMU，由配方绑定已有 `contentRef`。
6. 将编译问题写入设计编译报告和统一设计审计。

## 6. 不变量与错误

- `rail.right <= title.left` 且 `rail.right <= content.left`。
- `title.bottom <= content.top`。
- `content.bottom <= footer.top`。
- 列、行和堆叠产生的兄弟槽位不得相互重叠。
- 所有槽位必须包含在来源区域和页面内。
- 容量不足时返回 `INSUFFICIENT_CAPACITY`；引用非法返回 `INVALID_REFERENCE`；几何非法返回 `INVALID_GEOMETRY`；越界和重叠分别返回 `OUT_OF_BOUNDS`、`OVERLAP`。
- 编译失败不得静默缩小到不可读，也不得回写内容。

## 7. 实施阶段

### 阶段 A（已完成）

- 在 `src/core/layout/geometry/` 实现与 AI 无关的纯坐标、布局函数和校验能力。
- 在独立顶层模块 `src/workbench/` 实现 AI 操作 PPT 的受控中间层；布局是 `workbench/layout` 下的第一个工具域。
- 提供 `PageChrome → PageCoordinateSystem` 转换及 EMU 转换。
- 为未知输入提供运行时解析和稳定错误码。
- 将 `instrument-columns` 的列计算迁移到统一 `columns` 函数。
- 用导轨、标题、四列面板和非法程序建立固定测试。

进度（2026-10-26）：已完成逻辑坐标、语义区域、EMU 转换、间距令牌、`inset/columns/rows/stack`、未知输入解析、程序编译及边界/重叠/轴线校验。`instrument-columns` 已改用统一四列函数。独立 `src/workbench/` 模块统一向 AI 暴露带命名空间的布局工具，并补充文档/页面/对象检查、对象放置、对齐、分布、锁定、层级、文本样式和命令计划工具。所有编辑工具只生成设计命令计划，不直接修改文档；提交前必须通过 revision 冲突检查。现有 `generate_presentation_design` 已接入完整的多轮工具调用循环：Rust 每轮返回一个 `tool-call` 或 `final`，前端执行白名单工具并回传结果，最终设计仍通过既有 Schema、模板约束与确定性排版。

设计生成阶段没有可写文档快照，因此只暴露 `layout.*` 工具；编辑阶段建立文档工作台后才可暴露文档设计工具。循环最多 12 轮，Rust 请求最多接收 32 个工具和 24 条调用记录，并限制序列化体积。未注册工具返回 `UNSUPPORTED_TOOL`，失败不改变工作台状态。

## 7.1 AI 工作台调用模型

应用层先用 `createPptWorkbench(PageCoordinateSystem)` 创建 PPT 工作台，再把 `PPT_WORKBENCH_TOOLS` 作为唯一工具清单交给模型。模型调用由 `callPptWorkbench` 路由到对应工具域；布局域内部继续用 `createLayoutWorkbench/callLayoutWorkbench` 校验和执行。成功时返回新工作台及新建槽位，失败时返回稳定问题和原工作台。AI 不能持有可写文档对象，也不能通过工具传入正文、EMU、像素、颜色或任意坐标。

```ts
const created = createPptWorkbench(system);
const columns = callPptWorkbench(created.workbench, "layout.columns", {
  id: "metrics",
  source: "content",
  count: 4,
  gap: "md",
});
const inspected = callPptWorkbench(columns.workbench, "layout.inspect", {
  source: "metrics[2]",
});
```

### 阶段 B

- 迁移 comparison、process、timeline、image 和卡片网格配方。（2026-10-27：comparison 已迁移；其余待完成。）
- 把 `AiLayoutProgram` 加入设计请求与 Rust 端大小限制。（2026-10-27 已完成：每轮传递当前强类型程序；Rust 限制 32 KB、64 个操作并校验坐标空间。）
- 在 `DesignCompileReport` 中记录操作、槽位和降级原因。（2026-10-27 已完成：最终 Workbench 程序、只读槽位和失败工具诊断作为会话内 trace 进入逐页编译报告，不写入持久化文档。）

阶段 B 迁移记录（2026-10-27）：`comparison` 先将动态正文面板量化为 normalized-1000 矩形，再通过统一 `columns(..., "xl")` 产生两个等宽槽位，并使用 `inset(..., "sm")` 生成栏内文字区。标题带、下沉面、要点和中线均从同一槽位表转换为 EMU；800 单位内容区稳定得到 `368 + 64 + 368`，不再维护配方私有的浮点列宽与间距公式。

### 阶段 C

- 增加模板区域覆盖、障碍物规避、内容测量反馈和有界重编译。
- 建立视觉回归样张及 PPTX 原生对象可编辑性检查。

## 8. 验收

- 相同输入在不同机器上产生相同逻辑槽位和 EMU。
- 数据仪表页面的标题、导轨和内容列满足共同轴线不变量。
- 四列布局宽度一致、间距一致、无重叠且包含于内容区域。
- 非法坐标、非法引用、过多列和容量不足以稳定错误返回。
- 类型检查、ESLint、单元测试和生产构建通过。

## 9. 与低代码布局系统的关系

本任务提供逻辑坐标、几何操作和 AI Workbench 基础，不把增量 `AiLayoutProgram` 定义为最终可视化编辑模型。后续 [TASK-DESIGN-036](0036-low-code-layout-editor.md) 按 [ADR 0114](../../architecture/decisions/0114-declarative-low-code-layout-system.md) 增加可持久化方向的 `LayoutTree`：布局树是声明式意图，布局程序是会话内的受控增量操作，二者不得成为并行事实来源。
