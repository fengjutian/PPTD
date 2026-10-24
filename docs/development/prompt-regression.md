# 提示词回归套件

## 目的

提示词改一行，模型行为可能完全变样；Schema 和归一化也会悄悄改变产品语义。这个套件用**录制好的模型输出**锁住合同，不调用真实模型、不依赖网络、不消耗 token。

它回答三个问题：

1. 这份输出在当前 Schema 下还能不能通过？
2. 归一化之后，评分、封顶、图表类型是否仍符合预期？
3. 提示词版本变了，录制样例是否同步更新？

## 运行

```bash
npm run test:prompts
# 或
npx vitest run src/services/prompt-regression.test.ts
```

套件随 `npm test` 一起跑，不需要 API Key。

## 样例位置

```text
src/services/__fixtures__/prompt-regression/
  direction.json       方向提案：两个方向、重复 preset、非法 imagery
  visual-review.json   视觉评审：低概念封顶、高概念不封顶、旧响应缺字段
  design.json          设计输出：带 relation 的图表页、缺字段的非法输出
  data-relation.json   数据关系：变化覆盖饼图、占比点数、旧行为
```

样例保存**模型原始形状**，不是归一化后的结果。测试负责调用当前 Schema/归一化，再断言行为。

## 新增样例

1. 记录一次真实模型输出（可以脱敏，但保留导致问题的结构）。
2. 在对应 JSON 的 `cases` 末尾追加一条，写清 `name` 与 `expect` / `expected`。
3. 运行 `npm run test:prompts`。
4. 如果样例暴露的是产品 bug，先修代码；如果是有意改变行为，在 PR/任务记录里说明，并同步需求或 ADR。

方向提示词或输出合同变化时：

- 必须递增 `DESIGN_DIRECTIONS_PROMPT_VERSION`（`src/services/ai-service.ts`）；
- 必须更新 `direction.json` 的 `promptVersion`；
- 测试会在两者不一致时失败。

## 覆盖边界

- **覆盖**：方向数量/preset 唯一/字段枚举；概念分封顶；设计输出必填字段；数据关系选择图型。
- **不覆盖**：真实模型的措辞质量、方向是否真的不同、概念分是否公允、图表数据是否正确。这些需要真实模型抽样与人工评审，不能由固定样例代替。
- **不覆盖**：Rust 提示词文本本身。版本号是人工同步的；以后可以把提示词文本哈希纳入样例，当前不做。

## 为什么不直接快照提示词

提示词在 Rust 侧，按字符串快照会把无关排版/措辞变化都变成失败；当前更重要的是**输出合同与归一化行为**。版本号 + 录制输出已经能捕获“Schema 改了但样例没改”和“归一化改了但预期没改”。
