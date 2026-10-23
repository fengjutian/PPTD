# TASK-EDIT-001：补齐“开始”功能区的文本格式闭环

| 项目     | 内容                                  |
| -------- | ------------------------------------- |
| 状态     | 已实现（待 PowerPoint 人工复核）      |
| 优先级   | P0                                    |
| 里程碑   | V0.2 专业编辑功能区                   |
| 预估     | 4–6 人日                              |
| 依赖     | 无                                    |
| 需求依据 | TRS 4.4.4“开始”功能区、4.4.1 交互能力 |

## 1. 背景与问题

TRS 4.4.4 要求“开始”承载高频编辑闭环，至少包含剪贴板、幻灯片、字体、段落、绘图和编辑。当前实现中，“开始”只有撤销/重做、页面新建/复制/删除、对象复制/删除（`src/app/App.tsx` 的 `home-tools` 组，L2862–L2921），没有任何字体与段落命令入口。

文字格式全部放在右侧属性面板，且只覆盖字体、字号、颜色、加粗和水平对齐（`src/features/editor/InspectorPanel.tsx` L567–L627）。由此产生四个实际问题：

1. 用户必须离开画布去右侧面板逐项改格式，与 PowerPoint 的高频操作习惯不一致。
2. 模型不支持斜体、删除线、垂直对齐、行距编辑、项目符号、编号和缩进；`lineHeight`、`letterSpacingPt` 有数据字段却没有 UI 入口。
3. 多选多个文本对象时无法一次批量套用格式。
4. 没有格式刷，重复排版只能逐项复制数值。

同时，`TextElementStyle` 是纯设计状态，非常适合作为“补齐功能区”的第一个独立切片：不改内容、不碰导入、不引入新依赖。

## 2. 目标

用户选中一个或多个文本对象后，可以直接在顶部“开始”功能区完成常用字符与段落格式；操作形成单个事务和单个撤销项；画布预览与 PPTX 导出结果一致；**内容版本与内容哈希不变**。

## 3. 范围

### 3.1 本任务包含

- 字体组：字体、字号、增大/减小字号、加粗、斜体、下划线、删除线、文字颜色、清除格式。
- 段落组：水平对齐、垂直对齐、行距、项目符号、编号、增加/减少缩进。
- 格式刷：单击单次应用，双击锁定连续应用，Esc 取消。
- 多选批量格式：一次命令修改所有选中的文本对象。
- 键盘快捷键：加粗/斜体/下划线、字号增减、复制/应用格式。
- 画布渲染与 PPTX 导出的对应属性。

### 3.2 本任务不包含（另立任务）

| 缺口                       | 建议任务        |
| -------------------------- | --------------- |
| 剪切/粘贴按钮、格式刷之外  | TASK-EDIT-002   |
| 查找/替换/全选             | TASK-EDIT-003   |
| 插入表格/图表              | TASK-INSERT-001 |
| 组合/取消组合              | TASK-EDIT-004   |
| 字体库（搜索、许可、替代） | TASK-FONT-001   |
| PPTX 内容导入              | TASK-IMPORT-001 |
| 3D 场景                    | TASK-3D-001     |

## 4. 功能需求

| ID    | 需求                                                                                       | 验收       |
| ----- | ------------------------------------------------------------------------------------------ | ---------- |
| FR-1  | 字体、字号、颜色可从功能区修改，修改立即反映到画布和右侧面板                               | AC-1、AC-2 |
| FR-2  | 字号增大/减小按固定阶梯跳档，不产生 13.7pt 这类无意义值                                    | AC-3       |
| FR-3  | 加粗、斜体、下划线、删除线四个开关可独立组合，并显示按下状态                               | AC-2、AC-3 |
| FR-4  | 水平对齐三个选项、垂直对齐三个选项                                                         | AC-2       |
| FR-5  | 行距可在 0.8–3.0 倍之间调整                                                                | AC-2       |
| FR-6  | 项目符号/编号/无 三态切换；编号按行递增                                                    | AC-4       |
| FR-7  | 缩进 0–8 级，标记与正文一起移动                                                            | AC-4       |
| FR-8  | 清除格式恢复为主题正文令牌（字体、字号、颜色、加粗、行距、对齐、缩进、项目符号、垂直对齐） | AC-5       |
| FR-9  | 多选时批量应用，一次撤销即可整体回退                                                       | AC-6       |
| FR-10 | 格式刷复制完整文本格式（字符 + 段落），可跨页面使用                                        | AC-7       |
| FR-11 | 锁定对象不被修改；全部锁定时相关控件禁用                                                   | AC-8       |
| FR-12 | 导出 PPTX 保留斜体、删除线、垂直对齐、行距、项目符号和缩进层级                             | AC-9       |
| FR-13 | 修改格式不改变内容版本、内容哈希和审核状态                                                 | AC-10      |
| FR-14 | 所有命令具备可访问名称、工具提示和键盘路径                                                 | AC-11      |

## 5. 技术设计

### 5.1 领域模型

扩展 `TextElementStyle`（`src/core/document-model/types.ts` L58–L68），全部为可选字段，保证旧文档可直接解析：

```ts
export type TextVerticalAlign = "top" | "middle" | "bottom";
export type TextBullet = "none" | "dot" | "number";

export interface TextElementStyle {
  // 现有字段不变
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  align: TextAlign;
  letterSpacingPt?: number;
  lineHeight?: number;

  // 新增
  italic?: boolean; // 默认 false
  strikethrough?: boolean; // 默认 false
  verticalAlign?: TextVerticalAlign; // 默认 top
  bullet?: TextBullet; // 默认 none
  indentLevel?: number; // 0–8，默认 0
}
```

约束：

- 项目符号与编号在 V1 作用于**整个文本框的所有段落**，不做逐段混合。逐段模型属于内容结构变更，另立任务。
- 缩进只影响版式，不改变文本内容。
- 字体大小阶梯统一定义在核心层（例如 `src/core/document-model/text-style.ts`），UI 与命令共用：

```ts
export const TEXT_SIZE_LADDER = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 120,
] as const;
```

### 5.2 Schema 与迁移

- `CURRENT_SCHEMA_VERSION` 从 14 升到 15（`src/core/document-model/schema.ts` L5）。
- 新增 `versionFourteenDocumentSchema`（literal 14），保留迁移链完整。
- 新增迁移 `14 → 15`：用 v14 Schema 解析后只改 `schemaVersion`；新增字段可选，不补默认值，读取端用 `??` 兜底。
- 新增 `v14-document.json` 固定样例和 v15 样例；测试覆盖“旧项目打开、保存、再打开”不丢对象。
- `textStyleSchema` 增加新字段与取值校验：

```ts
italic: z.boolean().optional(),
strikethrough: z.boolean().optional(),
verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
bullet: z.enum(["none", "dot", "number"]).optional(),
indentLevel: z.number().int().min(0).max(8).optional(),
```

- 持久化格式变化必须在同一提交内更新迁移、固定样例和 Schema 测试。

### 5.3 命令层

沿用现有 `set-text-style` 的单对象路径，新增两个批量命令，保证“一次用户意图 = 一个事务 = 一个撤销项”：

```ts
| {
    type: "set-text-style-elements";
    slideId: SlideId;
    elementIds: ElementId[];
    style: Partial<TextElementStyle>;
  }
| {
    type: "clear-text-format";
    slideId: SlideId;
    elementIds: ElementId[];
  }
```

规则：

1. 只处理 `type === "text"` 且未锁定（`!element.locked`）的对象；非文本对象忽略。
2. 过滤后为空则抛 `ELEMENT_NOT_TEXT`，不产生空事务。
3. `clear-text-format` 的默认值来自 `document.theme?.textStyles?.body` 与 `document.theme?.minorFont`，缺失时回退到工厂默认值；对齐恢复为 `left`，缩进/项目符号/斜体/删除线/垂直对齐恢复默认。
4. `commandDomain` 返回 `design`；`content.version` 与内容哈希必须保持不变。
5. `assertTextStyle` 增加新字段校验：布尔类型、枚举、`indentLevel` 整数 0–8。
6. 撤销/重做使用现有事务机制，不新增旁路。

### 5.4 功能区 UI

- 新建 `src/features/editor/TextFormatToolbar.tsx`，功能区与属性面板共用，避免两套格式逻辑。
- “开始”标签下排列为三组：`字体` / `段落` / `剪贴板（格式刷）`。
- 字体组：字体下拉、字号输入、字号增减、B/I/U/S、颜色、清除格式。
- 段落组：左/中/右对齐、上/中/下对齐、行距下拉（1.0/1.15/1.5/2.0）、项目符号、编号、缩进增减。
- 窄窗口（<1440px）允许“段落”组折叠进“更多”菜单，但字体、字号、加粗、撤销/重做始终可见。
- 状态取“最后选中的文本对象”为主对象；多选值不一致时控件显示混合态（`data-mixed="true"` + 提示“多值”），点击后统一为新值。
- 没有文本选中或选中对象全部锁定时，控件禁用并给出 `title` 说明。
- 所有按钮使用 `aria-pressed`，图标按钮必须有 `aria-label`。

### 5.5 画布渲染

修改 `src/features/editor/RichText.tsx`：

- `fontStyle: italic ? "italic" : "normal"`。
- `textDecoration` 同时支持 `underline` 与 `line-through`，按需拼接。
- `lineHeight` 已有字段，补充 UI 后直接生效。
- 垂直对齐用 flex 纵向布局（`justify-content: flex-start | center | flex-end`），文本容器高度不变。
- 项目符号/编号：按行拆分渲染，标记宽度与 `indentLevel` 缩进计入左侧内边距；不把标记写进 `element.text`，避免污染内容和哈希。
- 文本测量（`src/services/text-metrics-canvas.ts`、`scene-metrics`）扣减缩进和标记宽度，保证自动适配字号与溢出判定不被项目符号误导。

### 5.6 PPTX 导出

修改 `src/features/pptx-export/export-pptx.ts` 的 `textOptions`：

```ts
italic: element.style.italic ?? false,
strike: element.style.strikethrough ? "sngStrike" : undefined,
valign: element.style.verticalAlign ?? "top", // 去掉当前硬编码 top
...(element.style.bullet && element.style.bullet !== "none"
  ? { bullet: element.style.bullet === "number" ? { type: "number" } : true }
  : {}),
...(element.style.indentLevel ? { indentLevel: element.style.indentLevel } : {}),
```

注意：

- 带 runs 的文本仍然走 `addText(fragments, textOptions)`；新属性放在文本框级，runs 未声明的属性自然继承。
- `resolveFragmentStyle` 需要让新字段继续以元素样式为兜底，避免 runs 覆盖后斜体/删除线丢失。
- 导出的文本框仍是原生文本，不得栅格化。

### 5.7 快捷键与无障碍

| 快捷键       | 行为                   |
| ------------ | ---------------------- |
| Ctrl+B       | 切换加粗               |
| Ctrl+I       | 切换斜体               |
| Ctrl+U       | 切换下划线             |
| Ctrl+Shift+> | 字号升一档             |
| Ctrl+Shift+< | 字号降一档             |
| Ctrl+Shift+C | 复制所选文本格式       |
| Ctrl+Shift+V | 应用格式到当前选中文本 |
| Esc          | 退出格式刷             |

- 输入框、文本编辑态下不拦截快捷键。
- 与现有 `keyboard-shortcuts.ts` 的 Ctrl+C/V 逻辑共存，不冲突。
- 每个控件有可读名称；格式刷按钮报告“已复制格式，点击目标应用”。

## 6. 状态与边界

| 场景                      | 行为                                                    |
| ------------------------- | ------------------------------------------------------- |
| 未选中对象                | 字体/段落组全部禁用                                     |
| 选中非文本对象            | 字体/段落组全部禁用                                     |
| 多选包含文本与形状        | 只作用于文本；形状不动                                  |
| 选中对象全部锁定          | 控件禁用，提示“对象已锁定”                              |
| 部分文本锁定              | 跳过锁定对象，其余生效，状态栏提示“已跳过 N 个锁定对象” |
| 多选值不一致              | 显示混合态；点击后统一                                  |
| 无主题令牌                | 清除格式回退到工厂默认值                                |
| 命令后没有可改对象        | 抛错且不写事务                                          |
| 格式刷过程中切换页面      | 保持复制状态，可跨页应用                                |
| 格式刷过程中按 Esc/点空白 | 退出，不修改文档                                        |

## 7. 验收标准

- **AC-1** 选中文本后，在“开始”功能区改字体、字号、颜色，画布与右侧属性面板同步更新，一次撤销回到修改前。
- **AC-2** 斜体、下划线、删除线可两两组合，画布显示正确，属性面板状态一致。
- **AC-3** 字号从 16pt 点“增大”依次得到 18、20；从 8pt 点“减小”不越界；加粗/斜体/下划线按钮有 `aria-pressed`。
- **AC-4** 开启项目符号后每行左侧出现标记；切换编号后标记为递增数字；缩进 3 级后正文整体右移；导出后 PowerPoint 中标记仍可编辑。
- **AC-5** 对斜体 + 红色 + 24pt + 居中 + 项目符号的文本执行“清除格式”，恢复为当前主题正文样式，且文本内容一字不变。
- **AC-6** 多选 3 个文本对象执行加粗，只产生 1 个撤销项；撤销一次三者全部恢复。
- **AC-7** 单击格式刷后点击另一个文本对象，格式套用且格式刷退出；双击格式刷可连续套用 3 个对象，Esc 退出。
- **AC-8** 锁定对象不因任何格式操作改变；全部锁定时控件禁用。
- **AC-9** 导出夹具包含斜体、删除线、垂直居中、1.5 倍行距、项目符号、2 级缩进；解包检查 XML 含 `i="1"`、`strike="sngStrike"`、`anchor="ctr"`、`lnSpc`、`buChar`/`buAutoNum`、`lvl="2"`，并用 PowerPoint 打开确认。
- **AC-10** 格式操作前后 `revisions.content`、`contentHash`、`slide.content.status` 不变；`revisions.design` 与 `revisions.document` 各增加一次。
- **AC-11** 全键盘可达；Tab 焦点顺序合理；屏幕阅读器能读出按钮名称与按下状态。

## 8. 测试计划

| 层级     | 覆盖                                                                 |
| -------- | -------------------------------------------------------------------- |
| 核心单测 | 单对象/批量样式、锁定跳过、非文本拒绝、清格式默认值、字号阶梯、撤销  |
| Schema   | v14 样例迁移到 v15、v15 往返、非法枚举/缩进拒绝、旧项目保存再打开    |
| 组件测试 | 工具栏禁用态、混合态、aria 状态、格式刷锁定与取消、快捷键拦截        |
| 导出     | 新增夹具 + XML 断言 + 页数/对象数/可编辑性；视觉回归基线按需更新     |
| 手工     | PowerPoint 与 LibreOffice 打开导出文件，检查项目符号、缩进、垂直对齐 |

命令：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`；导出变更另跑 `npm run test:visual`（无 Office/LibreOffice 时按 0017 约定显式跳过）。

## 9. 实施切片

1. 模型、Schema v15、迁移、固定样例和测试（约 0.5 人日）。
2. 命令层：批量样式、清格式、字号阶梯、校验和 revision 测试（约 1 人日）。
3. 画布：斜体、删除线、行距、垂直对齐、项目符号/编号与缩进渲染（约 1 人日）。
4. 功能区 `TextFormatToolbar` 与属性面板复用、响应式折叠（约 1 人日）。
5. 格式刷、快捷键、无障碍（约 0.5 人日）。
6. 导出映射、导出夹具、XML 断言、视觉基线（约 1 人日）。

每个切片独立可验证，前四个切片完成即可内部试用；导出切片完成才满足“可交付”。

## 10. 风险与对策

| 风险                                      | 对策                                                |
| ----------------------------------------- | --------------------------------------------------- |
| PptxGenJS 的项目符号/缩进层级与画布不一致 | 固定夹具 + 解包 XML 断言；画布标记宽度按导出值反推  |
| 垂直对齐与 `fit: shrink`、溢出质检冲突    | 导出前预检增加“垂直对齐 + 溢出”组合用例；跑质检回归 |
| Schema 升级破坏旧项目                     | 全量固定样例迁移测试；新字段全部可选；读取端兜底    |
| runs 覆盖元素级格式                       | 扩展 `resolveFragmentStyle` 的兜底链并补单测        |
| 文本测量未计入项目符号缩进，导致溢出误判  | 测量入口统一扣减缩进/标记宽度，补测量单测           |
| 功能区在 1280px 宽度溢出                  | 段落组折叠到“更多”；字体与撤销/重做常驻             |
| 多选批量修改不是单个撤销项                | 使用一个批量命令，而不是循环调用 `set-text-style`   |

## 11. 完成定义

- [x] 类型检查、Lint、单元测试、构建通过。
- [x] v14 项目可打开、编辑并保存为 v15，迁移有固定样例与测试。
- [ ] 导出夹具通过 XML 断言（已完成），PowerPoint 人工检查待做。
- [x] 内容哈希与审核状态不变，设计 revision 规则有测试。
- [x] 功能区、属性面板、快捷键三条路径行为一致。
- [x] 文档更新：新增 ADR 0044、领域模型第 19 节、V0.1 计划第 7 节、README 编辑器说明。

## 12. 待定问题

1. 项目符号 V1 是否接受“整框统一”，还是必须先支持逐段？建议先统一，逐段另立任务。
2. 字号阶梯采用 Office 档位还是简单 ±2pt？建议 Office 档位，便于和 PowerPoint 对齐。
3. `Ctrl+Shift+V` 当前没有绑定，是否与未来的“粘贴为纯文本”冲突？若冲突改为 `Ctrl+Alt+V`。
4. 格式刷是否应支持形状、表格和图表？本任务只做文本，其他对象另评。
5. 垂直对齐是否会影响现有版式计算和质检阈值？实施前先用 3 个生成样例回归。

## 13. 实现记录（2026-10-23）

已落地：

- 模型：`TextElementStyle` 增加 `italic`、`underline`、`strikethrough`、`verticalAlign`、`bullet`、`indentLevel`；字号阶梯、格式刷归一化和清除格式默认值在 `src/core/document-model/text-style.ts`。
- Schema：升到 v15，补 `14 → 15` 迁移、`v14`/`v15` 固定样例和 Schema 测试。
- 命令：`set-text-style-elements`（可带 `clearRuns`）、`clear-text-format`；锁定对象跳过，空目标抛 `ELEMENT_NOT_TEXT`，批量只产生一个撤销项。
- 画布：`RichText` 支持斜体、下划线、删除线、行距、垂直对齐、项目符号/编号与缩进；标记不写入正文；带格式片段的文本仍是一个段落。
- 功能区：`TextFormatToolbar` 提供两行紧凑的字体组和段落组，含混合态、禁用态、格式刷；属性面板复用同一命令并新增“段落”区。
- 快捷键：Ctrl+B/I/U、Ctrl+Shift+> / <、Ctrl+Shift+C/V、Esc 退出格式刷。
- 导出：斜体、下划线、删除线、垂直对齐、行距、项目符号、缩进写为原生文本属性；导出测试断言 `i`、`u`、`strike`、`anchor`、`buAutoNum`、`lvl`、`lnSpc`。

验证：

- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- 新增测试：`text-format.test.ts`、`text-format` store 测试、`TextFormatToolbar.test.tsx`、`RichText` 渲染测试、导出 XML 测试、快捷键与 `text-style` helper 测试。
- `npx vitest run --exclude ".tmp/**" --exclude "tools/visual-regression/**"`：94 个测试文件、812 项全部通过。
- 本地全量 `npm test` 另有两类非本任务失败：`.tmp` 恢复脚本缺文件（gitignored 的调试脚本）、视觉回归缺少 PowerPoint COM（仓库约定的显式跳过项）。

剩余人工项：用 PowerPoint 打开导出夹具，确认项目符号、缩进、垂直对齐和行距的真实观感；如与画布差异明显，再补视觉基线。
