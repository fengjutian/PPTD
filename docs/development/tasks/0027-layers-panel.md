# TASK-EDIT-006：图层面板交互增强

| 项目     | 内容                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 状态     | 已实现（可见性/重命名另立任务）                                                     |
| 优先级   | P1                                                                                  |
| 里程碑   | V0.1 专业编辑功能                                                                   |
| 预估     | 1–2 人日                                                                            |
| 依赖     | 无                                                                                  |
| 需求依据 | TRS 4.4.1 图层前移/后移、4.4.4 排列功能区、7.1 左侧面板图层树；技术选型中的拖拽排序 |

## 1. 背景

图层视图此前只是“能看”：`LayerList.tsx` 渲染类型图标、文本前 14 个字和一个锁图标，点击选中、Ctrl 增减选。调顺序要去右侧属性面板点“上移/下移/置顶/置底”，锁定要去右侧面板切换；选择组（`slide.groups`，ADR 0051）已经存在，但列表里平铺显示，点组员会整组选中却看不出原因。列表也没有缩略图、动画/组合角标、选中计数、Shift 连选、键盘导航和空状态新增。

结果是：页面上对象一多，图层视图无法承担“找到它、选中它、调层级、锁住它”的日常工作，用户仍要回到画布和右侧面板来回切换。

## 2. 目标

- 一次拖放对应一条命令、一个撤销项；多选或整组作为一个块移动，块内相对 Z 序不变。
- 分组在列表里可见，但不伪造不存在的层级关系（选择组不是嵌套的 group 元素，成员 Z 序可以不相邻）。
- 行内完成锁定/解锁、复制、删除；Shift 连选；方向键/Home/End 导航；Delete 删除；选中项自动滚入视野。
- 行内显示缩略图、完整名称 tooltip、组/动画/锁定角标；空页可以直接新增文本或矩形。

## 3. 范围

### 3.1 包含

- 新命令 `reorder-elements`（设计域）：`{ slideId, elementIds, toIndex }`。`toIndex` 是**移除块之后**数组中的插入下标（`0` 为底层，`remaining.length` 为顶层）；块内保持原相对顺序；未知 id、锁定成员、越界下标分别返回稳定错误；一次命令只产生一个撤销项。
- `src/features/editor/layer-order.ts`：面板顺序、拖动块、范围选择、落点计算、显示下标与数组下标换算的纯函数。
- `LayerList` 重写：缩略图（复用 `ElementPreview`）、组/动画/锁定角标、行内操作、Shift 连选、工具条计数/全选/取消、键盘导航、空状态、指针拖放。
- 样式：`05-canvas.css`、`06-settings.css`（浅色主题）、`04-editor.css`（左栏改为 flex 列，列表独立滚动）。
- 接入：`EditorWorkspaceView` 传入 `onSelectMany`/`onCommand`；`useAppRuntime` 暴露已有的 `selectElements`。
- 文档：本任务，以及 `v0.1-plan.md` 的任务行。

### 3.2 不包含

- 可见性（眼睛）与图层重命名。`ElementBase` 只有 `locked`，没有 `hidden`/`name`；需要 Schema v23、迁移与固定样例、命令、画布/缩略图/导出一致性（PPTX 隐藏形状）与报告，另立任务。
- 嵌套组/组树。选择组是页面元数据，成员在 `slide.elements` 中平铺且 Z 序可以不相邻；缩进树会暗示不存在的连续层级和整体变换。
- 键盘拖放、跨页拖动、拖动时自动展开/折叠。
- 重命名、组命名、隐藏对象。

## 4. 设计

### 4.1 列表顺序与数组下标

`slide.elements` 底层在前，而面板顶层在前，`layerRows` 负责反转。拖动落点 `displayInsert` 是“去掉被拖块后剩余行”的自上而下插入位；命令需要的是自下而上的数组下标，因此 `arrayInsertionIndex(remaining, displayInsert) = remaining - displayInsert`。落点没有改变顺序时（`blockMoved === false`）不发命令，避免留下一个没有效果的撤销项。

### 4.2 拖动块

- 拖动已选中的行 → 整个选择；拖动未选中的行 → 该行；该行属于组 → 整组（与点选展开一致）。
- 指针移动超过 4px 才进入拖动；按下时先选中（只改选择，不写文档），松开时才发命令。拖动结束后的 click 被抑制，不会把多选收成单选。
- 落点按行中线判断，在目标行上方/下方画插入线；指针靠近列表上下边缘时自动滚动。
- 含锁定成员的块不能拖动；锁定行上的行内删除按钮禁用。

### 4.3 组的表现

组只显示角标（成员数）和同组高亮，不做缩进或折叠。点选、框选、Shift 连选仍由 store 展开到整组（ADR 0051）。删除组内成员会让整组按既有 `pruneGroups` 规则消失，这是组模型本来的语义。

### 4.4 键盘与可访问性

列表是 `role="listbox"`，行是 `role="option"`，带 `aria-selected` 和 roving `tabIndex`。↑/↓/Home/End 移动选择，Shift + 方向键扩展范围，Space 切换，Enter 单选，Delete 删除可删项，Ctrl/Cmd+A 全选，Esc 清空。这些按键在行内 `stopPropagation`，避免同时触发画布的微移或删除。

### 4.5 缩略图

复用 `ElementPreview`，每行 36×24。它与画布共用 `SlideScene` 的渲染代码，所以图片裁剪、图表/表格、文字颜色与画布一致，而不是另画一套近似图标。当前没有做可视区虚拟化，见已知边界。

## 5. 验收

- **AC-1** 拖动单行到另一行的上下半区，Z 序变化，只产生一个撤销项；拖动多选或整组时整块移动，块内相对顺序不变，一次撤销恢复。
- **AC-2** 拖回原位或落在块自身范围内，不产生命令和撤销项。
- **AC-3** 锁定行不能拖动；行内锁定/解锁与右侧面板结果一致；行内删除跳过锁定对象。
- **AC-4** 点击组内任一成员，同组行同时高亮并显示组角标；列表不出现缩进层级。
- **AC-5** Shift 点选得到连续范围；方向键在行间移动并把选中项滚入视野；Delete 删除选中项且跳过锁定对象。
- **AC-6** 工具条显示“已选 n / m”，全选与取消选择生效。
- **AC-7** 空页显示空状态，可直接新增文本或矩形。
- **AC-8** 浅色主题下工具条、角标、行内按钮与选中态可读；对象较多时左栏内部滚动，不撑破面板。

## 6. 测试

- `src/features/editor/layer-order.test.ts`：面板顺序、拖动块、范围选择、落点、下标换算、空操作判断。
- `src/core/commands/reorder-elements.test.ts`：块移动与相对顺序、底层/顶层边界、未知/锁定/越界、设计域。
- `src/store/layer-order.test.ts`：一次拖动产生一个撤销项，撤销与重做恢复整块顺序。
- `src/features/editor/LayerList.test.tsx`：顺序、选中与锁定、组角标与同组高亮、动画角标、计数、行内操作、空状态。
- 浏览器预览验证（headless Edge + CDP）：拖放单行/整组、锁定行不拖、空操作不发命令、Shift 连选、方向键移动焦点、Delete 命令，以及深色/浅色/空状态的截图。

## 7. 已知边界

- 没有可见性与重命名，见 3.2。
- 拖放只支持指针；键盘用户仍可用右侧属性面板的四个层级按钮排序。
- 每行都渲染 `ElementPreview`；单页对象很多（约 40 个以上）时可能有明显开销，后续可按可视区裁剪或只给选中/悬停行画缩略图。
- 拖动期间页面被其他命令改写（例如 AI 设计完成）时，落点按拖动开始时的行集合计算；提交前仍由命令校验下标与成员存在性。
- 组内成员原来可以 Z 序不相邻；整组拖动后会被压成连续块。这是本任务接受的副作用（PowerPoint 的组本身也是连续的）。

## 8. 实现记录（2026-10-26）

- 命令：`reorder-elements`（`src/core/commands/command-types.ts`、`src/core/commands/commands.ts`），单元素 `reorder-element` 保留。
- 纯逻辑：`src/features/editor/layer-order.ts`；界面：`src/features/editor/LayerList.tsx`。
- 样式：`src/styles/05-canvas.css`、`src/styles/06-settings.css`、`src/styles/04-editor.css`。
- 接入：`src/app/EditorWorkspaceView.tsx`、`src/app/useAppRuntime.ts`、`docs/development/v0.1-plan.md`。
- 验证：`tsc -p tsconfig.app.json --noEmit`、`tsc -p tsconfig.node.json --noEmit`、ESLint、Prettier、`npm run build` 通过；全量 `vitest run` 171 个文件 / 1342 个用例通过；headless Edge 截屏检查深色、浅色与空状态，并通过 CDP 验证拖放/锁定行/空操作/Shift 连选/方向键/Delete 的交互结果。
