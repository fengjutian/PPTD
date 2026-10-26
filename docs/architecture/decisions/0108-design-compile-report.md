# 0108 设计计划编译必须返回结构化诊断

## 状态

已接受（2026-10-26）。

## 背景

设计计划编译器此前成功时只返回页面元素，失败时只返回一条 `IntentConflict`。调用方无法区分“完全按计划实现”和“设计方向替换了模型指定的配方”，也无法用稳定错误码驱动界面说明、日志或后续 AI 重试。

## 决策

`compileDesignPlan` 保留既有的 `elements` / `conflict` 判别结构，并在所有结果上增加 `compileReport`：

- `outcome` 为 `accepted`、`accepted-with-adjustments` 或 `rejected`；
- 记录请求配方和最终选择配方；
- 每条诊断包含稳定 `code`、严重度、设计意图路径和用户可读消息；
- 方向拥有的配方替换必须报告为 adjustment，不再静默发生；
- 容量不足、未知配方和配方内部拒绝分别使用不同错误码；
- 模板正文接管作为已接受的编译决策进入报告。

报告属于本次纯编译结果，不进入 `PresentationDocument`，不改变 revision、内容哈希或撤销栈。后续 UI、诊断日志和 AI 修复循环可以逐步消费它，不能通过解析中文消息判断错误类型。

## 后果

现有调用方仍可用 `"elements" in result` 判断成功，不需要一次性迁移。编译路径第一次能够解释设计计划如何落地，并为能力协商和自动重试提供稳定协议。

当前报告覆盖设计计划编译器自身；素材获取、字体替代和 PPTX 导出降级仍由各自报告负责，后续再汇总为跨阶段报告。

## 验证

- 角色自动选配方返回 `accepted` 和 `RECIPE_SELECTED`；
- 方向替换显式配方返回 `accepted-with-adjustments`；
- 容量不足返回 `rejected` 和 `RECIPE_CAPACITY_EXCEEDED`；
- 模板正文接管留下 `TEMPLATE_BODY_TAKEN_OVER` 记录。
