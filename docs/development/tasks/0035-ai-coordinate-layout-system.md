# TASK-DESIGN-035：AI 语义坐标系统与确定性布局 API

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

- 在独立目录 `src/core/layout/workbench/` 实现 `coordinate-system.ts`、`layout-functions.ts`、`layout-program.ts` 和 `layout-validator.ts`。
- 提供 `PageChrome → PageCoordinateSystem` 转换及 EMU 转换。
- 为未知输入提供运行时解析和稳定错误码。
- 将 `instrument-columns` 的列计算迁移到统一 `columns` 函数。
- 用导轨、标题、四列面板和非法程序建立固定测试。

进度（2026-10-26）：已完成逻辑坐标、语义区域、EMU 转换、间距令牌、`inset/columns/rows/stack`、未知输入解析、程序编译及边界/重叠/轴线校验。`instrument-columns` 已改用统一四列函数。新增 `workbench.ts`，向 AI 暴露 `regions/inspect/inset/columns/rows/stack/validate` 七个受控工具；工具调用按不可变工作台状态连续执行，失败保留上一次有效状态。当前阶段尚未扩展 AI 页面输出协议，避免模型生成了布局程序但其他配方没有消费便宣称已支持。

## 7.1 AI 工作台调用模型

调用方先用 `createLayoutWorkbench(PageCoordinateSystem)` 创建只包含页面语义区域的工作台，再把 `LAYOUT_WORKBENCH_TOOLS` 作为工具定义交给模型。每次模型工具调用由 `callLayoutWorkbench` 校验和执行，成功时返回新工作台及新建槽位，失败时返回稳定问题和原工作台。AI 不能持有可写文档对象，也不能通过工具传入正文、EMU、像素、颜色或任意坐标。

```ts
const created = createLayoutWorkbench(system);
const columns = callLayoutWorkbench(created.workbench, "columns", {
  id: "metrics",
  source: "content",
  count: 4,
  gap: "md",
});
const inspected = callLayoutWorkbench(columns.workbench, "inspect", {
  source: "metrics[2]",
});
```

### 阶段 B

- 迁移 comparison、process、timeline、image 和卡片网格配方。
- 把 `AiLayoutProgram` 加入设计请求与 Rust 端大小限制。
- 在 `DesignCompileReport` 中记录操作、槽位和降级原因。

### 阶段 C

- 增加模板区域覆盖、障碍物规避、内容测量反馈和有界重编译。
- 建立视觉回归样张及 PPTX 原生对象可编辑性检查。

## 8. 验收

- 相同输入在不同机器上产生相同逻辑槽位和 EMU。
- 数据仪表页面的标题、导轨和内容列满足共同轴线不变量。
- 四列布局宽度一致、间距一致、无重叠且包含于内容区域。
- 非法坐标、非法引用、过多列和容量不足以稳定错误返回。
- 类型检查、ESLint、单元测试和生产构建通过。
