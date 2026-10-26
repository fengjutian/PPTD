# ADR 0113：AI PPT Workbench 中间层

- 状态：接受
- 日期：2026-10-26

## 背景

AI 需要通过函数方法完成页面布局，并会逐步扩展到选择页面、放置元素、应用样式、检查冲突和提交设计变更。如果模型直接持有 `PresentationDocument`，或者直接构造领域对象，会绕过 Schema、内容与设计隔离、事务、revision 和撤销重做约束。

布局坐标能力最初位于 `src/core/layout/workbench`，这会把“纯领域几何能力”和“AI 操作协议”混在同一模块中，也不利于后续增加非布局工具域。

## 决定

建立独立顶层模块 `src/workbench`，作为 AI 操作 PPT 的唯一中间层。

- `src/core/layout/geometry` 保存与 AI 无关的坐标、布局函数和校验器，保持纯领域依赖。
- `src/workbench/layout` 保存布局程序、AI 输入解析和布局工作台状态。
- `src/workbench/ppt-workbench.ts` 提供统一会话、工具清单和调用路由。
- 给模型暴露的工具必须使用能力域命名空间，例如 `layout.columns`。
- Workbench 不向模型暴露可写的 `PresentationDocument`，也不允许工具直接修改内容模型。
- 会改变 PPT 的工具必须先生成强类型领域命令或设计变更计划，由应用层以单个事务提交；失败调用不能改变已有工作台或文档状态。
- 模型输出一律按 `unknown` 处理，经过工具 Schema 和领域不变量校验后才能执行。

## 依赖方向

```text
AI Provider Adapter
        |
        v
src/workbench  --->  src/core commands / layout / validation
        |
        v
Application transaction boundary
```

`src/core` 不得依赖 `src/workbench`。UI、具体 AI SDK、Tauri 和 PPTX 导出器也不能进入 Workbench 内核。

## 当前范围

当前实现两个工具域：

- 布局域：区域读取、检查、内缩、分列、分行、堆叠和校验。
- 文档设计域：文档/页面/对象检查，对象放置、对齐、分布、锁定、层级、文本样式，以及命令计划检查和清空。

文档设计工具只累积现有 `DocumentCommand` 的设计子集，不直接修改 `PresentationDocument`。`preparePptWorkbenchCommit` 会比较工作台创建时的 document/content/design revision 与当前 revision；任何一项变化都会返回 `REVISION_CONFLICT`。它提供可供 AI Adapter 接入的工具契约，但尚未把现有 AI 请求流程改造成完整的多轮工具调用循环。

## 后果

- 后续能力可按 `slide.*`、`element.*`、`style.*`、`review.*` 等独立域扩展，而不污染领域核心。
- 每个工具域可以独立测试权限、输入 Schema、事务和回退行为。
- 在真正提交设计命令前需要额外的应用层编排，这是有意保留的安全边界。
