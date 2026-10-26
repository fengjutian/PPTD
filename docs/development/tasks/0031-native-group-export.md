# TASK-GROUP-002：PPTX 原生分组导出

| 项目     | 内容                                            |
| -------- | ----------------------------------------------- |
| 状态     | 已实现                                          |
| 优先级   | P1                                              |
| 里程碑   | V0.2 专业编辑功能区                             |
| 依赖     | TASK-GROUP-001 编辑期选择组                     |
| 需求依据 | TRS 4.4.1 支持对象、4.4.4“排列”功能区、4.5 导出 |

## 1. 背景

编辑期已经有 `Slide.groups`，组合、取消组合、整组选中、移动、对齐和删除都可用。导出仍把成员写成独立对象，PowerPoint 中不再成组，preflight 用 `group-not-exported` 逐页提示。用户要求原生分组导出，使导出的 PPTX 里仍是可继续编辑的组合。

PptxGenJS 没有分组 API，因此需要包构建后的 OOXML 后处理。关键风险是坐标映射、Z 序和 PowerPoint 对不允许组合对象的限制。

## 2. 目标

把编辑期选择组写成 PowerPoint 原生 `<p:grpSp>`，保持组合前后画面一致，并在不能成组时明确回退和报告。

## 3. 范围

### 3.1 包含

- 文本、形状、图片、图标和图表等 `p:sp` / `p:pic` / `p:graphicFrame` 成员的原生组合。
- 组的 `a:off`/`a:ext` 与 `a:chOff`/`a:chExt` 使用同一外接框，成员变换不改写。
- 组的 Z 序放在最前成员的位置，成员在组内保持相对顺序。
- 旋转成员的外接框按四角计算。
- 表格（`noGrp="1"`）、嵌套组、缺失成员或不可导出成员整体回退为独立对象。
- 图表补 `objectName`，让 `graphicFrame` 可按稳定元素 id 定位。
- 导出报告新增 `nativeGroupCount`、`nativeGroupSkipped`，回退时写用户可读警告。
- 更新 README、领域模型和 v0.1 缺口表。

### 3.2 不包含

- 嵌套组、组内进入/退出编辑。
- 组整体缩放/旋转；控制柄仍作用于成员。
- 复制/粘贴、复制页面携带分组。
- 表格组合：PowerPoint 自身以 `noGrp` 禁止，不通过移除锁来伪造。
- 组合内对象动画的 PowerPoint 播放验证；本次只保证 XML 目标和结构不被分组破坏。

## 4. 设计

### 4.1 后处理顺序

`buildPptx` 在图片裁剪/形状补丁之后调用 `patchSlideGroups`，再 `zipSync`。主题色、渐变、切换、动画和图片补丁都依赖对象名或文档顺序；先分组会让它们找不到成员。

### 4.2 成员定位

`patchSlideGroups` 扫描 `<p:spTree>` 的顶层 drawable 块，按 `p:cNvPr/@name` 匹配元素 id。深度计数支持块内嵌套，但编辑期选择组不允许成员属于多个组，因此一次后处理不会生成嵌套组。

### 4.3 坐标与 Z 序

组框是成员旋转后外接框的并集；`chOff`/`chExt` 等于 `off`/`ext`，所以成员坐标保持页面坐标，映射为恒等变换。组插入到最前成员的旧位置；这是 PowerPoint 对非连续 Z 序对象执行组合时的落位规则。

### 4.4 回退

以下情况不写组，成员保持独立对象：

- 成员 XML 不存在（例如只在母版里的版式背景）；
- 成员是已存在的 `<p:grpSp>`；
- 成员带 `a:graphicFrameLocks noGrp="1"`（当前为表格）；
- 组少于两个可导出成员、成员重复或找不到 DOM 元素。

回退计入 `nativeGroupSkipped`，并生成一条报告警告。

### 4.5 图表

`addChart` 增加 `objectName: element.id`，使图表 `graphicFrame` 可被组合寻址。图表动画仍由 `patchSlideAnimations` 显式跳过，避免“有名字”被误当成“动画已验证”。

## 5. 验收

- **AC-1** 两个文本/形状对象组合后导出，PPTX 中存在一个 `<p:grpSp>`，两个成员在组内。
- **AC-2** 组框与 `chOff`/`chExt` 使用同一外接框，成员 `a:xfrm` 未被改写。
- **AC-3** 非连续 Z 序的组落在最前成员位置，成员在组内保持原相对顺序。
- **AC-4** 含表格的组不写 `<p:grpSp>`，`nativeGroupSkipped=1`，报告说明原因。
- **AC-5** 图表 + 文本组合导出为原生组，图表 `graphicFrame` 在组内且 `name` 为元素 id。
- **AC-6** 图表动画仍不写 timing，计入 `nativeAnimationSkipped`。
- **AC-7** 无组页面导出字节不受分组后处理影响。
- **AC-8** 真实 PowerPoint 打开组合页不触发修复，组对象可识别，组合页与未组页渲染一致。

## 6. 测试

- `src/features/pptx-export/group-xml.test.ts`：7 个单元用例，覆盖坐标、Z 序、表格回退、缺失成员、多组、旋转框和无组不变。
- `src/features/pptx-export/export-pptx.test.ts`：原生组、表格回退、图表组、图表动画跳过。
- 真实 PowerPoint COM：打开导出文件，检查组对象 `Type`/`GroupItems.Count`，并比对组页与未组页 PNG 的 SHA-256。
- `npm run typecheck`、`npm test`、`npm run lint`、`npm run build`。

## 7. 已知边界

- 原生分组不改变编辑期选择组模型；组整体缩放/旋转、嵌套组仍未实现。
- 表格组合按 PowerPoint 的 `noGrp` 限制回退。
- 非连续 Z 序的较低成员会随组上移，这是原生分组的固有限制。
- 组合内对象动画的播放行为尚未逐项验证；导出保留目标 id，但不在本文声称“已通过 PowerPoint 动画验证”。
