# TASK-GROUP-001：编辑期选择组（组合 / 取消组合）

| 项目     | 内容                                  |
| -------- | ------------------------------------- |
| 状态     | 已实现（原生分组导出见 TASK-GROUP-002） |
| 优先级   | P2                                    |
| 里程碑   | V0.2 专业编辑功能区                   |
| 预估     | 1–2 人日                              |
| 依赖     | 无                                    |
| 需求依据 | TRS 4.4.1 支持对象、4.4.4“排列”功能区 |

## 1. 背景

TRS 要求编辑器支持分组对象，并在“排列”功能区提供组合/取消组合。

此前没有分组：多选可以移动、对齐和删除，但点选其中一个对象就丢失整组选择；重复操作一组对象只能每次重新框选。真正的嵌套 `group` 元素会牵动递归 Schema、渲染、命中测试、导出和全部元素遍历，成本远高于本次目标。

## 2. 目标

用户可以把两个以上未锁定、未分组的对象组合成一个选择组；点击任一成员选中整组；移动、对齐、分布、锁定、删除都按整组工作；取消组合恢复独立选择。分组是设计数据，可撤销、可保存。

## 3. 范围

### 3.1 包含

- `Slide.groups` 元数据：`{ id, elementIds }`，成员仍是普通元素，保持原有 z-order。
- `group-elements` / `ungroup-elements` 命令，设计域、一次一个撤销项。
- 点击组内任一成员选中整组；Ctrl 点选、框选同样展开到整组。
- “排列”功能区新增组合/取消组合按钮，按选择状态禁用。
- 删除任一成员时自动丢弃整组（不留下半组）；重排版式与复制页不继承分组。
- 分组成员导出为原生 `<p:grpSp>` 组合；含表格等 PowerPoint 禁止组合的成员或缺少可导出成员时，整组回退为独立原生对象并报告（TASK-GROUP-002）。
- Schema 升到 v17，`16 → 17` 迁移与固定样例。

### 3.2 不包含

- PPTX 原生 `<p:grpSp>` 分组导出的实现细节见 TASK-GROUP-002；本次只交付编辑期选择组。
- 组整体缩放/旋转；控制柄仍作用于单个成员，组整体变换未实现。
- 嵌套组、组命名、组内进入/退出编辑。
- 复制/粘贴、复制页面时携带分组；这些路径会得到未分组副本。

## 4. 设计

### 4.1 页面元数据，不是嵌套元素

```ts
interface SlideGroup {
  id: string;
  elementIds: ElementId[];
}
```

元素继续平铺在 `slide.elements` 中，渲染、导出、内容同步、动画和命中测试都不需要递归。分组只是“这些 id 一起选”的声明。

优势是改动局部；代价是组没有自己的几何变换，缩放/旋转仍按成员处理。

### 4.2 选择展开

store 的三个入口统一展开：

- `selectElement(id)`：找到该元素所在组，选中全部成员。
- `toggleElement(id)`：全组已选则整组移除，否则整组加入。
- `selectElements(ids)`：每个 id 展开后去重。

移动、对齐、分布、锁定、删除因此不需要新的组命令，沿用既有多选命令。

### 4.3 命令与不变量

- `group-elements`：至少两个、全部存在、全部未锁定、均不属于现有组；否则分别返回 `GROUP_TOO_SMALL`、`ELEMENT_NOT_FOUND`、`ELEMENT_LOCKED`、`ELEMENT_ALREADY_GROUPED`。
- `ungroup-elements`：按组 id 删除，不存在返回 `GROUP_NOT_FOUND`。
- 删除元素后 `pruneGroups` 丢弃成员不完整的组；重排版式清空分组；复制页不复制分组。
- Schema 校验：组 id 全局唯一、成员存在、一个元素不能属于多个组、每组至少两个成员。

### 4.4 导出

PptxGenJS 没有分组 API。本任务先保证编辑期选择组可用；后续 TASK-GROUP-002 在导出末尾把成员包进原生 `<p:grpSp>`，含表格等禁止组合成员时回退为独立对象并报告。见 [0031 原生分组导出](0031-native-group-export.md)。

## 5. 验收

- **AC-1** 组合两个对象后点击任一成员，两个都被选中。
- **AC-2** 拖动组内任一成员，整组移动；一次撤销恢复。
- **AC-3** 组内成员参与对齐/分布/批量锁定，按多选语义工作。
- **AC-4** 取消组合后点击成员只选它自己。
- **AC-5** 删除组内一个成员，组自动消失，其他成员保留。
- **AC-6** 组合/取消组合各是一个撤销项，内容版本不变。
- **AC-7** 复制页得到未分组副本；重排版式后不保留旧组。
- **AC-8** 导出文件仍是有效 PPTX；TASK-GROUP-002 后，可组合成员写成原生 `<p:grpSp>`，不可组合成员回退并报告。

## 6. 测试

- `src/core/commands/group.test.ts`：组合、取消、非法输入、删除清理、复制页不继承。
- `src/store/group-selection.test.ts`：点选展开、Ctrl 切换、框选展开。
- `src/core/document-model/schema.test.ts`：v16 迁移、v17 样例、缺失成员/重复成员/重复组 id。
- `src/features/editor/ArrangeToolbar.test.tsx`：组合/取消按钮的启用状态。
- `src/features/pptx-export/export-pptx.test.ts`：`group-not-exported` 报告。

## 7. 已知边界

- 分组不会导出为 PowerPoint 原生分组；需要原生分组时另立 TASK-GROUP-002。
- 组整体缩放/旋转未实现：每个成员仍显示自己的控制柄，缩放单个成员会破坏组构图。
- 复制/粘贴与复制页面不携带分组，副本是散开的对象。
- 嵌套组未实现；一个元素只能属于一个组。

## 8. 实现记录（2026-10-23）

- 模型：`SlideGroup`、`Slide.groups`；Schema v17 与固定样例。
- 命令：`group-elements`、`ungroup-elements`、删除/重排/复制页的分组清理。
- UI：`ArrangeToolbar` 组合/取消组合按钮；store 选择展开。
- 导出：`group-not-exported` preflight 提示。
- 验证：`npm run typecheck`、`npm run lint`、`npm run build` 通过；新增测试 13 项（命令 4、store 3、Schema 3、排列组件 2、导出 1）；全量套件 121 个文件、939 项通过。
