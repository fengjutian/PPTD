# PPTD 实现状态盘点（2026-10-27）

> 本文回答两个问题：**哪些能力已经开发完、哪些还没开发**。判断依据是生产代码（`src/`、`src-tauri/src/`）、测试与固定样例、任务书和 ADR，而不是文档里的计划口径。
>
> 需求事实仍以 [PPTD-TRS-v1.0](../requirements/PPTD-TRS-v1.0.md) 为准；本文只盘点现状，不修改需求。

## 1. 结论速览

| 里程碑                          | 状态          | 一句话结论                                                                                         |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| V0.1 桌面基础与文档模型         | ✅ 已完成     | Tauri 2 + React + 严格 TypeScript 基线、文档模型、2D 编辑、保存恢复、标准 PPTX 导出均已闭环        |
| V0.2 专业编辑功能区与多格式导入 | 🟡 主体完成   | 编辑器、动画、表格/图表/形状、PPTX Level A 导入、模板库已可用；功能区第二阶段和导入 B/C 仍有缺口   |
| V0.3 主题与字体系统             | 🟡 部分完成   | Design Tokens、内置主题、全局主题与模板主题可用；**字体库整体未开发**，仅有系统字体存在性检测      |
| V0.4 AI 内容与设计              | ✅ 主路径完成 | 内容生成 → 审核 → 设计生成 → 视觉质检 → 写入编辑器的链路已跑通；设计质量回路仍处 Phase 0/1         |
| V0.5 3D 编辑与混合导出          | ⬜ 未开始     | 无 Three.js、无 3D 图层、无 3D 场景模型；TRS 中的 3D 范围仍是设计稿                                |
| V1.0 模板保留与产品稳定性       | 🟡 部分完成   | 导出校验、回读、崩溃恢复、诊断日志已有；模板保留导出、完整 OOXML、字体库、完整版本历史仍未完成     |
| Web 端与云协作                  | ⬜ 未开始     | 只有 [Web TRS](../requirements/PPTD-Web-TRS-v0.1.md)；当前是桌面端，不含浏览器端、服务端或协作协议 |

**一句话总结**：桌面端“生成内容 → 审核 → 设计 → 编辑 → 导出 PPTX”的主链路已经开发完；剩余工作集中在 **字体库、模板/母版保真、PPTX 导入 B/C、低代码布局编辑器、导出模式、3D、Web/云协作**，以及若干专业编辑功能区的收尾。

## 2. 已经开发完的能力

### 2.1 工程与文档核心

- Tauri 2、React 19、TypeScript 严格模式、Vite 6、Vitest、ESLint/Prettier 与 CI 已落地；`npm run tauri build` 已能产出 MSI/NSIS 安装包。
- 强类型 `PresentationDocument`、运行时 Schema、默认文档工厂与迁移链已建立。当前 `CURRENT_SCHEMA_VERSION = 30`，覆盖文档、页面、文本/图片/形状/线条/表格/图表/组合/图标、动画、切换、演讲备注、版式能力和内容版本。
- 领域命令、事务、Immer patch、撤销/重做、revision 与内容哈希隔离已实现；设计命令不能改写已审核内容。
- 证据：[`schema.ts`](../../src/core/document-model/schema.ts)、[`src/core/commands`](../../src/core/commands)、[`domain-model.md`](../architecture/domain-model.md)。

### 2.2 项目持久化与恢复

- 新建、打开、保存、另存为、最近项目、手动保存、防抖自动保存、脏状态和错误提示已实现。
- 临时文件 → 刷盘 → 原子替换；保存中断保留上一有效版本；异常关闭标记与恢复入口已实现。
- SQLite 保存应用设置、AI 草稿历史、项目索引和设计记忆；项目正文仍以 `.pptd` JSON 与资源目录为真源。
- 证据：[`project-files.ts`](../../src/services/project-files.ts)、[`useAppRuntime.ts`](../../src/app/useAppRuntime.ts)、[`project_file.rs`](../../src-tauri/src/commands/project_file.rs)、[`storage/mod.rs`](../../src-tauri/src/storage/mod.rs)。

### 2.3 2D 编辑器

- 多页画布、缩略图、图层面板、选择/多选、移动/缩放/旋转/层级/锁定、复制粘贴、撤销重做。
- 文本、图片、线条、图标和 11 种预设形状；表格与图表可在属性面板直接编辑数据。
- 对齐、分布、批量格式修改、组合/取消组合；组合导出为原生 `<p:grpSp>`，不可组合成员会回退并报告。
- 页面尺寸、页面背景、页面切换、9 种对象动画、动画预览、格式刷、查找替换、应用内剪贴板。
- 图层可见性、重命名、搜索、右键菜单、拖放排序和键盘层级操作。
- 证据：[`src/features/editor`](../../src/features/editor)、[`EditorRibbon.tsx`](../../src/app/EditorRibbon.tsx)、[`arrange` 相关测试](../../src/features/editor/ArrangeToolbar.test.tsx)。

### 2.4 AI 内容生成与审核

- MiniMax Provider 适配、流式生成、分批草稿、超时/取消、令牌用量持久化。
- 按主题/听众/重点生成结构化内容；大纲与正文分批产出；可查看逐页计划和可编辑内容块。
- 内容审核、逐页确认、退回审核、内容版本快照、逐页差异、只恢复内容或同时恢复版式。
- 审核阶段 AI 辅助：整页重写、单页操作、整册审稿、事实核实标记、来源事实与逐页引用、配图意图审核。
- 证据：[`ai-service.ts`](../../src/services/ai-service.ts)、[`design-quality-stage.ts`](../../src/services/design-quality-stage.ts)、[`src/features/ai`](../../src/features/ai)、[`content-version.ts`](../../src/core/document-model/content-version.ts)。

### 2.5 模板、主题与设计生成

- PPTX/PPT 模板上传、母版/主题/版式提取、背景与占位符样式继承、版式能力摘要、模板删除/重命名。
- 主题令牌、语义色阶、17 套内置主题预设、全局主题修改、主题样本与封面预览。
- 无模板生成时的四个设计方向、真实预览、方向选择记录、设计记忆与本机偏好。
- 整册设计概念、15 个可渲染页面配方、设计计划编译器、模板内容区接管、页面级设计隔离。
- 批量设计版本、AI 选模板、版本预览与提交门；单页“换一版”候选。
- 证据：[`design`](../../src/core/design)、[`recipes`](../../src/core/layout/recipes)、[`template-review-target.ts`](../../src/services/template-review-target.ts)、[`DesignCandidateDialog.tsx`](../../src/app/DesignCandidateDialog.tsx)。

### 2.6 视觉质量与确定性检查

- 视觉评审：真实 PPTX / 画布近似 / 仅确定性校验三级证据；概念分、总分封顶、逐页问题、修复循环。
- 确定性设计体检：字号、字阶、字体/色彩数量、标签、编号、emoji、连续同骨架、留白失衡、行长、跨页一致性。
- 导出前语义色对比度、模板符合度、设计审计与导出报告。
- “质检”工作区：概览、页面问题、模板能力、设计审计、样张基线。
- 证据：[`design-quality-stage.ts`](../../src/services/design-quality-stage.ts)、[`taste-lint`](../../src/core/design)、[`layout-audit.ts`](../../src/core/layout/layout-audit.ts)、[`deck-audit.ts`](../../src/core/layout/deck-audit.ts)、[`QualityWorkspaceView.tsx`](../../src/app/QualityWorkspaceView.tsx)。

### 2.7 PPTX 导入（Level A）

- 页面尺寸与顺序、文本、图片、基础形状与常见预设形状、基础表格、顶层/嵌套组合、单序列基础图表。
- 主题色/字体、页级主题覆盖、纯色/主题色背景、占位符基础文本样式、字符间距、段前/段后、文本框制表位、http/https/mailto 局部链接、四类页面切换、演讲备注。
- 旧版 `.ppt` 通过本机 PowerPoint 受控转换为临时 `.pptx` 后导入；转换失败不回退其他转换器。
- 逐项导入报告与 A/B/C 兼容等级。
- 证据：[`pptx-import.ts`](../../src/services/pptx-import.ts)、[`pptx_import.rs`](../../src-tauri/src/commands/pptx_import.rs)、[TASK-IMPORT-001](tasks/0010-pptx-import-level-a.md)、[TASK-IMPORT-002](tasks/0030-pptx-slide-theme-override.md)。

### 2.8 PPTX 导出与验证

- PptxGenJS 原生文本、图片、形状、表格、图表、组合、页面背景、页面切换、9 种对象动画。
- 导出前字体、坐标、溢出、模板符合度和语义色对比度预检；导出基于不可变快照，失败/取消不改变项目。
- 导出后独立回读包内文字、图片、表格、图表数量；结构化导出报告记录警告、字体替代、对象降级和不支持能力。
- 视觉回归：固定夹具导出后由 PowerPoint/LibreOffice 渲染并与参考图比对；没有工具链时显式跳过。
- 证据：[`export-pptx.ts`](../../src/features/pptx-export/export-pptx.ts)、[`verify-export.ts`](../../src/features/pptx-export/verify-export.ts)、[`native-animation.ts`](../../src/features/pptx-export/native-animation.ts)、[ADR 0017](../architecture/decisions/0017-export-visual-regression.md)、[ADR 0078](../architecture/decisions/0078-export-readback-parity.md)。

### 2.9 AI Workbench 与确定性布局

- `src/workbench` 作为 AI 与文档之间的受控中间层：AI 只能调用带命名空间的工具，不能持有可写文档。
- 布局工具覆盖语义区域、`inset/columns/rows/stack`、校验、文档/页面/对象检查、放置、对齐、分布、锁定、层级、文本样式和命令计划。
- 编辑工具只生成命令计划，提交前检查 revision；失败不改变工作台状态；多轮工具循环有轮数、体积和工具数量上限。
- 证据：[`ppt-workbench.ts`](../../src/workbench/ppt-workbench.ts)、[`layout-workbench.ts`](../../src/workbench/layout/layout-workbench.ts)、[`document-workbench.ts`](../../src/workbench/document/document-workbench.ts)、[ADR 0113](../architecture/decisions/0113-ai-ppt-workbench-boundary.md)。

### 2.10 安全、诊断与运维

- API Key 存操作系统凭据库，不进入源码、项目文件、前端状态和日志。
- 文件命令最小权限、路径/扩展名/大小校验、ZIP 解包限制、外部关系禁止、宏/脚本不执行。
- 结构化诊断日志（JSONL）、2 MB 轮转、日志面板、长任务取消与进度。
- 证据：[`app-log.ts`](../../src/services/app-log.ts)、[`app_log.rs`](../../src-tauri/src/commands/app_log.rs)、[`0006-file-boundary-hardening.md`](../architecture/decisions/0006-file-boundary-hardening.md)、[ADR 0088](../architecture/decisions/0088-diagnostic-log.md)。

## 3. 部分完成

| 能力                          | 已经落地                                                                                                                                                                | 还没完成                                                                                                                                                                         | 依据                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PPTX 导入 Level A / B / C     | Level A 主体、页级主题覆盖、嵌套组合、单序列图表、`.ppt` 转换、A/B/C 报告                                                                                               | Level B/C、母版/版式完整视觉重建、多序列图表、SmartArt/媒体/对象动画、内部跳页/文件链接、渐变/图片背景、母版装饰、逐段独立样式、跨表头/表体合并、超过 12×50 的表格、模板保留模式 | [TASK-IMPORT-001](tasks/0010-pptx-import-level-a.md)、[ADR 0052](../architecture/decisions/0052-pptx-level-a-import.md)                                                                     |
| 模板与母版保真                | 模板分析、主题/背景/占位符样式、版式能力、幻灯片母版导出                                                                                                                | 完整母版/版式画面重建、模板保留导出、版式变体、模板分类/收藏                                                                                                                     | [TASK-TEMPLATE-001](tasks/0011-template-management.md)、[ADR 0008](../architecture/decisions/0008-template-master-and-theme-export.md)                                                      |
| 视觉词汇与设计质量（0026）    | 语义色阶、阴影、圆角/椭圆画框、深色页双色调、图表配色、字阶带、行长诊断、精确行距、角色级对比度                                                                         | 样张 contact sheet 基线、真实视觉快照回归执行器、模板变体选择闸门的剩余部分                                                                                                      | [TASK-DESIGN-026](tasks/0026-visual-vocabulary.md)、[ADR 0102](../architecture/decisions/0102-element-effects-ooxml.md)、[ADR 0106](../architecture/decisions/0106-dark-page-image-tone.md) |
| 设计基础数据与质检工作区      | 配方目录、语义组件角色、模板能力进提示词、模板版式选择闸门、64 项样张矩阵、导出设计审计、质检工作区                                                                     | 配方 ID 持久化（审计覆盖率为 0）、真实样张快照与可编辑性回归执行器                                                                                                               | [TASK-DESIGN-034](tasks/0034-design-foundation-data.md)                                                                                                                                     |
| AI 语义坐标与布局 API（0035） | `normalized-1000` 逻辑坐标、EMU 转换、间距令牌、区域/行列/堆叠、边界/重叠/轴线校验、Workbench 工具循环、`comparison` 配方迁移、`AiLayoutProgram` 进设计请求与编译 trace | 阶段 B 剩余配方迁移；阶段 C（模板区域覆盖、障碍物规避、有界重编译、视觉回归）                                                                                                    | [TASK-DESIGN-035](tasks/0035-ai-coordinate-layout-system.md)                                                                                                                                |
| 低代码布局编辑器（0036）      | `LayoutTree` Schema、节点注册表、编译器、槽位分配与确定性测试                                                                                                           | 阶段 B（树面板/属性面板/辅助层/拖动）、阶段 C（AI 节点级工具与提案差异）、阶段 D（持久化/模板复用）、阶段 E（批量排版/治理）                                                     | [TASK-DESIGN-036](tasks/0036-low-code-layout-editor.md)、[ADR 0114](../architecture/decisions/0114-declarative-low-code-layout-system.md)                                                   |
| “开始”功能区第二阶段          | 分组、剪贴板、字体、段落、绘图、编辑、字符间距、版式选择、格式刷、查找替换                                                                                              | 分节、文本突出显示、分栏、SmartArt、文字方向、形状透明度、快速样式、阴影效果面板；这些按钮当前不显示                                                                             | [TASK-EDIT-009](tasks/0033-home-ribbon-powerpoint-alignment.md)                                                                                                                             |
| 设计质量回路（ADR 0117）      | Phase 0 度量、Phase 1 候选与“换一版”、Phase 4 页级设计隔离                                                                                                              | Phase 2 合同收敛、Phase 3 覆盖补齐（`table-story`、`anchor-split`）、候选的跨会话持久化与模型选择                                                                                | [ADR 0117](../architecture/decisions/0117-design-quality-loop.md)                                                                                                                           |
| 内容版本历史                  | 确认时刻的内容与设计快照、逐页差异、只恢复内容或同时恢复版式                                                                                                            | 页面集合/块结构变化后的恢复、完整分支式版本历史、视觉评审图片与原始响应的长期保存                                                                                                | [ADR 0043](../architecture/decisions/0043-content-version-history.md)、[ADR 0060](../architecture/decisions/0060-design-snapshot-and-review-trace.md)                                       |
| 导出回读校验                  | 包内文字、图片、表格、图表数量与页数/顺序                                                                                                                               | 图表标签（chart part）、演讲备注（notes part）、视觉布局；回读通过不等于视觉保真                                                                                                 | [ADR 0078](../architecture/decisions/0078-export-readback-parity.md)                                                                                                                        |
| 图片资产来源                  | URL、许可说明、核验状态、按图片字节计算指纹、导出统计                                                                                                                   | 自动采集来源、密码学签名/版权凭证；导入图片与未标注 AI 图仍显示“未标注”                                                                                                          | [ADR 0080](../architecture/decisions/0080-image-asset-provenance.md)                                                                                                                        |
| 视觉评审证据                  | 真实 PowerPoint、画布近似、仅确定性校验三级证据；降级不冒充最终画面                                                                                                     | macOS/Linux 的 LibreOffice 真实渲染；多页 LibreOffice 栅格化                                                                                                                     | [ADR 0081](../architecture/decisions/0081-review-evidence-level.md)、[ADR 0022](../architecture/decisions/0022-visual-review-on-real-pptx.md)                                               |

## 4. 还没开发

| 能力                                      | 现状                                                                                                      | 对应需求/文档                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 字体库                                    | 只有系统字体存在性检测与导出预检；没有字体搜索、预览、中英文混排、收藏、来源/许可、用户字体管理、嵌入策略 | TRS 4.7；TASK-FONT-001（任务书未写）                |
| 3D 图层与 3D 场景                         | 无 Three.js 依赖、无场景模型、无相机/灯光/材质/投影、无 3D 导出                                           | TRS 4.8、5.4；TASK-3D-001（任务书未写）             |
| 模板保留导出 / 完整 OOXML 适配层          | 没有保留原 PPTX 包结构的导出模式；当前始终由 PptxGenJS 重新生成                                           | TRS 4.5.5、4.9、V1.0；TASK-EXPORT-001（任务书未写） |
| PDF / 图片预览导出                        | 应用内没有导出为 PDF 或图片的命令；LibreOffice/PowerPoint 只用于测试渲染                                  | TRS 4.9 导出模式；TASK-EXPORT-001                   |
| 模板分类与收藏                            | 只有模板列表、预览、重命名、删除                                                                          | TRS 4.6；TASK-TEMPLATE-002（任务书未写）            |
| 幻灯片浏览 / 放映 / 演讲者视图            | 无 Slide Sorter、无全屏放映、无演讲者视图                                                                 | TRS 7.1；README 已知限制                            |
| 视频/音频/SmartArt/3D 模型/屏幕录制       | 导入时跳过并报告；没有编辑或导出实现                                                                      | TRS 4.4、4.5；当前不显示为可用命令                  |
| 系统剪贴板互通                            | 只有应用内剪贴板，切换项目会清空                                                                          | TRS 4.4.4；ADR 0045                                 |
| 形状级超链接 / 内部幻灯片跳转             | 只有文本框整体和局部文字范围的 http/https/mailto 链接                                                     | TRS 4.4.4；TASK-TEXT-003                            |
| 图表动画原生导出                          | 对象动画已支持 9 种；图表动画默认跳过并报告                                                               | ADR 0057；README 已知限制                           |
| 嵌套组合、组合整体缩放/旋转、组随复制粘贴 | 编辑期选择组与一层原生分组可用；更深组合仍不完整                                                          | ADR 0051、ADR 0109                                  |
| 表格增删行列 / 手工合并拆分               | 插入后不能增删行列或图表序列；导入的合并单元格只能编辑左上角                                              | TASK-INSERT-001、ADR 0059                           |
| 完整版本历史 / 跨册设计指标               | 只有内容版本快照；设计度量不跨册持久化；“换一版”计数只在 localStorage                                     | ADR 0043、ADR 0117                                  |
| 浏览器端与云协作                          | 无服务端、无协作协议、无评论/分享/权限；浏览器预览模式只是无数据库降级                                    | [Web TRS](../requirements/PPTD-Web-TRS-v0.1.md)     |

## 5. 任务书状态

### 5.1 已完成（30 个任务；下表 31 行，两个任务共用 `0019`）

| 任务                                                                           | 状态说明                           |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| [TASK-EDIT-001 文本格式](tasks/0001-home-text-formatting.md)                   | 已实现；待 PowerPoint 人工复核     |
| [TASK-EDIT-002 剪贴板](tasks/0002-clipboard.md)                                | 已实现（应用内）                   |
| [TASK-DESIGN-001 概念与配方](tasks/0003-deck-concept-and-recipes.md)           | 已实现；待 10 页真实 AI 端到端复核 |
| [TASK-EDIT-003 查找替换](tasks/0004-find-replace.md)                           | 已实现                             |
| [TASK-EDIT-005 页面尺寸](tasks/0005-page-size.md)                              | 已实现                             |
| [TASK-EDIT-004 排列](tasks/0006-arrange-toolbar.md)                            | 已实现；组合另见 TASK-GROUP-001    |
| [TASK-INSERT-001 表格图表](tasks/0007-insert-table-chart.md)                   | 已实现                             |
| [TASK-ANIM-001 动画](tasks/0008-animation-effects.md)                          | 已实现；图表动画跳过               |
| [TASK-GROUP-001 组合](tasks/0009-grouping.md)                                  | 已实现；原生导出见 TASK-GROUP-002  |
| [TASK-TEMPLATE-001 模板管理](tasks/0011-template-management.md)                | 已实现（删除/重命名切片）          |
| [TASK-DESIGN-002 页面骨架](tasks/0012-page-chrome-and-measured-composition.md) | 已实现                             |
| [TASK-DESIGN-003 模板配方](tasks/0013-template-recipes.md)                     | 已实现                             |
| [TASK-DESIGN-004 流程/对比](tasks/0014-process-and-comparison-recipes.md)      | 已实现                             |
| [TASK-DESIGN-005 评审换配方](tasks/0015-visual-review-recipe-change.md)        | 已实现                             |
| [TASK-DESIGN-006 时间线/引文](tasks/0016-timeline-and-quote-recipes.md)        | 已实现                             |
| [TASK-DESIGN-007 章节/模板图](tasks/0017-section-and-template-image.md)        | 已实现                             |
| [TASK-DESIGN-008 10 页夹具](tasks/0018-ten-page-design-preview.md)             | 已实现                             |
| [TASK-DESIGN-009 批量设计版本](tasks/0019-ai-variant-batch.md)                 | 已实现                             |
| [TASK-DESIGN-009 内容页排版](tasks/0019-content-page-typography.md)            | 已实现（编号与上一项冲突）         |
| [TASK-DESIGN-010 设计计划编译器](tasks/0020-design-plan-compiler.md)           | 已实现                             |
| [TASK-DESIGN-011 编辑化排版](tasks/0021-editorial-comparison.md)               | 已实现                             |
| [TASK-DESIGN-012 VisualBrief](tasks/0022-visual-brief-and-weighted-split.md)   | 已实现                             |
| [TASK-DESIGN-013 原生图表](tasks/0023-native-chart-data-story.md)              | 已实现                             |
| [TASK-DESIGN-014 chart 内容块](tasks/0024-chart-content-block.md)              | 已实现                             |
| [TASK-DESIGN-025 方向与品味门](tasks/0025-design-direction-and-taste-gates.md) | 已实现；UI/真实模型待目视          |
| [TASK-EDIT-006 图层面板](tasks/0027-layers-panel.md)                           | 已实现                             |
| [TASK-EDIT-007 图层搜索/菜单](tasks/0028-layers-search-and-context-menu.md)    | 已实现                             |
| [TASK-EDIT-008 可见性/重命名](tasks/0029-layer-visibility-and-rename.md)       | 已实现                             |
| [TASK-IMPORT-002 页级主题](tasks/0030-pptx-slide-theme-override.md)            | 已实现                             |
| [TASK-GROUP-002 原生分组导出](tasks/0031-native-group-export.md)               | 已实现                             |
| [TASK-TEXT-003 局部超链接](tasks/0032-partial-text-hyperlink.md)               | 已实现                             |

> 注：上表实际为 31 行，因为两个任务共用 `0019` 文件编号；按唯一任务数算是 30 项。

### 5.2 部分完成 / 进行中（6 项）

| 任务                                                                        | 状态                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [TASK-IMPORT-001 PPTX 导入](tasks/0010-pptx-import-level-a.md)              | Level A + 顶层/嵌套组合 + 单序列图表可用；B/C、母版保真与保留模式未完成 |
| [TASK-DESIGN-026 视觉词汇](tasks/0026-visual-vocabulary.md)                 | WP0–WP2 主体、WP3 部分、WP4 收尾；样张基线/视觉快照执行器未完成         |
| [TASK-EDIT-009 功能区对标](tasks/0033-home-ribbon-powerpoint-alignment.md)  | 第一阶段完成；第二阶段部分命令（分节、快速样式、形状效果等）未实现      |
| [TASK-DESIGN-034 设计基础数据](tasks/0034-design-foundation-data.md)        | 阶段 A–C 完成，阶段 D 首片完成；配方 ID 持久化与真实样张回归未完成      |
| [TASK-DESIGN-035 坐标与布局 API](tasks/0035-ai-coordinate-layout-system.md) | 阶段 A 完成，阶段 B 部分完成；阶段 C 未开始                             |
| [TASK-DESIGN-036 低代码布局](tasks/0036-low-code-layout-editor.md)          | 阶段 A（LayoutTree Schema/编译器）完成；B–E 未开始                      |

## 6. 文档与实现不一致

本次整理发现以下文档问题；它们不影响代码，但会让“完成度”被误读。

| 问题                       | 具体表现                                                                                                                                                                                                                                                                                                          | 建议                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 开发计划曾停在 2026-10-23  | 本次整理前 [v0.1-plan](v0.1-plan.md) 未记录 10-24 之后的设计、导入、图层、组合、低代码布局等交付；§7 把“视觉词汇”标为“计划”                                                                                                                                                                                       | 以本文为准，计划表已同步更新到 2026-10-27                           |
| 任务书状态缺失/过期        | 本次整理前 0034、0035、0036 没有状态字段；0026 的状态停在 2026-10-25                                                                                                                                                                                                                                              | 已在对应任务书补状态行；后续以状态行 + 进度小节双重维护             |
| ADR 编号冲突               | 134 个 ADR 文件只有 120 个唯一编号；`0029/0031/0033/0034/0035/0036/0037/0038/0052/0104/0105/0106` 各有多篇                                                                                                                                                                                                        | 不直接重命名（会破坏引用）；先建索引/保留别名，后续单独做重编号迁移 |
| 任务编号与任务 ID 冲突     | 两个文件共用 `0019`，且都声明 `TASK-DESIGN-009`                                                                                                                                                                                                                                                                   | 后续把“内容页排版”改为独立编号（例如 `TASK-DESIGN-015`）            |
| ADR 文件号与标题不一致     | `0014-persistence-testability-and-write-conflicts.md` 标题是 `0010`；`0015-visual-qa...` 标题是 `0011`                                                                                                                                                                                                            | 修正标题，保留文件名                                                |
| 大多数 ADR 没有状态字段    | 134 篇中只有 6 篇含显式“状态：”                                                                                                                                                                                                                                                                                   | 统一补 `状态/日期` 元数据，区分“提议/接受/已实施/废弃”              |
| 0114、0117 仍是“提议”      | 代码已有实现（0114 阶段 A、0117 Phase 0/1/4）                                                                                                                                                                                                                                                                     | 改为“接受（部分实施）”，避免把已实施决策读成未开工                  |
| 架构文档模块名与仓库不一致 | [system-architecture](../architecture/system-architecture.md) 写 `features/project`、`features/template-import`、`features/ai-content`、`features/ai-design`、`features/scene3d`、`components/`、`types/`；实际是 `src/app`、`src/features/ai`、`src/features/editor`、`src/features/pptx-export`、`src/services` | 按实际目录重画模块表，或把未落地模块标注为“目标结构”                |
| v0.1 计划 §5 已过时        | 仍写 AI、PPTX 导入、动画等“进入 V0.2 以后”，但这些已经实现                                                                                                                                                                                                                                                        | 把 §5 改成“历史范围”，避免与当前实现冲突                            |
| Schema v30 固定样例        | 当前 Schema 为 30，但 `__fixtures__` 最新只有 `v29-document.json`                                                                                                                                                                                                                                                 | 补 `v30-document.json` 与迁移断言，满足工程指南的 Schema 变更要求   |

## 7. 建议的下一步

按“先收口已完成范围，再开新能力”的顺序：

1. **P0：收口 V0.2 与导入 Level A 的验收**。完成 TASK-EDIT-009 剩余命令或明确不做；补一次真实 PowerPoint 人工复核；把导入报告中的降级项固化成回归样例。
2. **P0：补文档状态**。完成 ADR 状态字段、编号索引和任务状态；把本文作为唯一“完成度”入口。
3. **P1：字体库（V0.3）**。先做缺失字体检测、替代建议和许可证字段，再做搜索/收藏；不要在没有许可证结论时自动嵌入字体。
4. **P1：低代码布局阶段 B/D**。把 `LayoutTree` 编译器接到树面板、属性面板和持久化；AI 工具与提案差异放在阶段 C。
5. **P1：模板保留导出 / 导出模式**。这是 V1.0 的核心缺口，涉及 OOXML 适配层，不能靠 PptxGenJS 补。
6. **P2：PPTX 导入 B/C 与母版保真**。按真实样例逐项扩充兼容范围，并继续逐项报告降级。
7. **P2：3D 与 Web/云协作**。需求已基线化，但没有生产代码；开工前先补任务书、Schema 和验收样例。

## 8. 盘点方法与验证

- 对照 [TRS V1.0](../requirements/PPTD-TRS-v1.0.md) 的功能域、[v0.1-plan](v0.1-plan.md) 的里程碑和 36 份任务书，逐项检查 `src/`、`src-tauri/src/` 是否有生产实现。
- 对“已完成”的能力，至少确认存在对应模块、命令/端口和测试或固定夹具；对只有文档/ADR 的能力，标为“未开发”。
- 2026-10-27 执行 `npx tsc -p tsconfig.app.json --tsBuildInfoFile .tmp/tsconfig.app.tsbuildinfo` 通过；`npm test -- --reporter=dot` 通过（220 个测试文件、1662 条测试）。本次未执行 `npm run lint`、`npm run build` 与 Rust `fmt/clippy/test`，发布前仍需在干净环境跑完整门禁。
