# TASK-DESIGN-009：内容页排版层级

| 项目     | 内容                                   |
| -------- | -------------------------------------- |
| 状态     | 已实现（P0，2026-10-24）               |
| 优先级   | P0                                     |
| 里程碑   | V0.4 设计能力                          |
| 预估     | 1 人日                                 |
| 依赖     | ADR 0069、ADR 0063、ADR 0068           |
| 需求依据 | TRS 5.3 Design Model、6.3 Design Agent |

## 1. 背景

真实页面暴露了配方之外的问题：卡片正文 26pt、项目符号同样 26pt、四条要点同权、30 字以上标题仍用 display 字号、编辑器默认显示网格。结果是“内容排版正确，但阅读顺序像海报”。

## 2. 目标

1. 卡片正文封顶 20/22pt；
2. 项目符号降到 10–14pt；
3. 用 `TextRun` 加粗主语，形成主谓层级；
4. 长加粗标题封顶 34/30pt；
5. 画布网格默认关闭。

## 3. 实施

### 3.1 卡片正文

`commands.ts` 的 `columns` 分支：

```ts
const maximumSize = Math.min(sparseColumns ? 22 : 20, preferredSize + 4);
```

删除旧的 `Math.min(26, preferredSize + 8)`。

### 3.2 项目符号

```ts
const markerSize = Math.max(10, Math.min(14, Math.round(columnSize * 0.6)));
```

### 3.3 主谓加粗

```ts
const emphasisLead = (value: string): TextRun[] | undefined => {
  // 在“可能/将/仍/决定/是/释放/提升/降低……”或首个逗号前断开；
  // 断点至少 4 字，返回 [{ start: 0, end: split, bold: true }]。
};
```

- `text()` 增加可选 `runs`，只写字符范围，不复制文案；
- 卡片正文调用 `text(..., emphasisLead(item))`；
- 没有自然断点的要点不返回 runs。

### 3.4 长标题

```ts
const longBoldCap = bold ? (value.length > 36 ? 30 : value.length > 24 ? 34 : undefined) : undefined;
const fitted = Math.min(fittedFontSize(...), longBoldCap ?? Infinity);
```

### 3.5 网格

`canvas-guides-store.ts` 的 `gridEnabled` 默认从 `true` 改为 `false`。

## 4. 测试

| 文件                                         | 覆盖                                               |
| -------------------------------------------- | -------------------------------------------------- |
| `src/core/commands/commands.test.ts`         | 正文 ≤20、标记 ≤14、长标题 ≤30、runs 覆盖前导主语  |
| `src/features/editor/CanvasOverlay.test.tsx` | 默认网格关闭                                       |
| 导出测试                                     | `runs` 仍导出为原生文本片段（既有 text-runs 测试） |

## 5. 验收

- **AC-1**：5 条长要点的两栏页，正文最大 20pt。
- **AC-2**：项目符号 10–14pt。
- **AC-3**：至少一条要点带 `runs[0].start=0`、`end < text.length`、`bold=true`。
- **AC-4**：30 字以上加粗标题 ≤30pt；24–36 字 ≤34pt。
- **AC-5**：网格默认关闭。
- **AC-6**：内容文本逐字不变，`TextRun` 只覆盖已有字符。
- **AC-7**：导出仍是原生文本，不降级为图片。

## 6. 实施记录（2026-10-24）

- 卡片正文 26→20/22；标记 26→10–14；内边距 0.035→0.045in。
- 两栏卡片加入主谓加粗 `runs`；无自然断点的要点保持统一字重。
- 长加粗标题加 34/30pt 封顶。
- 画布网格默认关闭。
- 样张：`.tmp/render15/p1.png`；与修改前 `.tmp/render13/p1.png` 对比，正文和标记明显退后，主语成为第一眼入口。

验证：

- `npx vitest run src/core/commands/commands.test.ts`：135 项通过。
- `npx vitest run src/features/editor/CanvasOverlay.test.tsx`：通过。
- 全量：136 个测试文件、1080 项通过，1 项视觉回归按环境跳过；类型检查、Lint、生产构建通过。

## 7. 未完成

- 模板卡片是固定 artwork 时，下半页仍由模板几何决定。
- 英文长句的主谓断点。
- 对比页/指标页垂直填充。
- 真实模型样张校准字号阈值。
