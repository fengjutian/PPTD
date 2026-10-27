# PPTD 文档导航

> 最后整理：2026-10-27。**“哪些开发完、哪些没开发”以 [实现状态盘点](development/implementation-status.md) 为准**；本文只负责文档地图、状态口径和维护规则。

## 1. 阅读顺序

新成员或新任务按以下顺序读，避免把“计划”当成“已实现”：

1. [PPTD-TRS-v1.0](requirements/PPTD-TRS-v1.0.md)：需求事实来源。
2. 专项需求：[设计方向](requirements/PPTD-Design-Direction-TRS-v0.1.md)、[视觉质量](requirements/PPTD-Visual-Quality-TRS-v0.1.md)、[Web](requirements/PPTD-Web-TRS-v0.1.md)。
3. [系统架构](architecture/system-architecture.md)：模块、依赖方向和运行时边界。
4. [领域模型](architecture/domain-model.md)：聚合、命令、版本与不变量。
5. [V0.1 开发计划](development/v0.1-plan.md)：阶段范围、顺序和验收。
6. [工程约定与质量门禁](development/engineering-guide.md)：目录、编码和测试规则。
7. [实现状态盘点](development/implementation-status.md)：当前完成度、缺口和文档债。
8. 具体实现前，再查对应的 [任务书](development/tasks/) 和 [ADR](architecture/decisions/)。

## 2. 文档地图

| 目录/文档                                                                                | 内容                                            | 当前状态                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| [`requirements/`](requirements/)                                                         | 4 份需求基线：TRS V1.0、设计方向、视觉质量、Web | 已基线化；Web/3D 等属于未来范围           |
| [`architecture/system-architecture.md`](architecture/system-architecture.md)             | 分层、模块职责、数据流、安全边界                | 初版；部分模块名与实际目录不一致          |
| [`architecture/domain-model.md`](architecture/domain-model.md)                           | 文档聚合、命令、revision、内容/设计隔离         | 初版；与实现基本一致                      |
| [`architecture/decisions/`](architecture/decisions/)                                     | 134 篇 ADR，覆盖导出、导入、设计、质量、布局等  | 编号有冲突；仅 6 篇含显式状态字段         |
| [`development/v0.1-plan.md`](development/v0.1-plan.md)                                   | V0.1 里程碑、验收、缺口表                       | 已完成 M0–M4；缺口表已同步到 2026-10-27   |
| [`development/implementation-status.md`](development/implementation-status.md)           | 已完成/部分完成/未开发的能力盘点                | **当前完成度入口**                        |
| [`development/engineering-guide.md`](development/engineering-guide.md)                   | 目录建议、编码规则、测试金字塔、合并门禁        | 可执行；目录示例需按实际仓库更新          |
| [`development/design-style-contract.md`](development/design-style-contract.md)           | AI 决定什么、代码保证什么                       | 可执行                                    |
| [`development/design-manual-verification.md`](development/design-manual-verification.md) | UI 目视与真实模型校准清单                       | 待执行                                    |
| [`development/prompt-regression.md`](development/prompt-regression.md)                   | 录制输出锁住方向、评审和设计合同                | 可执行；不评价真实模型措辞                |
| [`development/tasks/`](development/tasks/)                                               | 37 份任务书（36 个编号，`0019` 重复）           | 30 项已完成、6 项部分完成、若干未写任务书 |
| [`research/`](research/)                                                                 | 开源 PPT Skill 经验调研                         | 参考材料，不是需求基线                    |

## 3. 状态口径

本文档体系和实现盘点统一使用四个状态：

| 状态         | 含义                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| ✅ 已完成    | 当前需求范围内主路径闭环；有生产代码、错误/取消路径、测试或固定夹具；剩余仅人工目视或外部工具验证 |
| 🟡 部分完成  | 有可用代码，但需求范围、验收条件或阶段计划未闭环；必须写明“已落地”和“缺口”                        |
| ⬜ 未开发    | 只有需求、ADR 或任务书，没有生产代码；不得因为文档写了就标为可用                                  |
| 🗄️ 历史/废弃 | 已被新决策取代，保留用于追溯，不再作为实现依据                                                    |

两条硬规则：

- **文档存在 ≠ 功能可用。** TRS、ADR、任务书描述的是目标或决策；能否使用以代码和验收为准。
- **测试存在 ≠ 验收通过。** 视觉回归需要 PowerPoint/LibreOffice；没有工具链时显式跳过，不用跳过冒充通过。

## 4. 本次整理结论

- 桌面端主链路已闭环：内容生成 → 内容审核 → 模板/设计生成 → 视觉质检 → 2D 编辑 → PPTX 导出。
- 30 项任务书已完成；6 项部分完成（导入 Level A、视觉词汇、开始功能区第二阶段、设计基础数据、AI 坐标 API、低代码布局）。
- 最大未开发块：**字体库、3D、模板保留导出、PDF/图片导出、模板分类/收藏、幻灯片浏览/放映、Web/云协作**。
- 近期已落地但旧计划未记录：设计候选“换一版”、页级设计隔离、跨页一致性审计、精确行距导出、编辑文案后增高文本框、AI Workbench、`LayoutTree` 编译器。
- 详细证据、缺失项和下一步见 [实现状态盘点](development/implementation-status.md)。

## 5. 已知文档债

| 问题                    | 具体表现                                                                                                                                                                                                                                                | 处理建议                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ADR 编号冲突            | 134 个文件只有 120 个唯一编号；12 个编号被 26 个文件共用（多出 14 个文件）                                                                                                                                                                              | 先建索引/别名；重编号需单独迁移并更新所有引用                |
| 任务编号冲突            | `0019-ai-variant-batch.md` 与 `0019-content-page-typography.md` 共用 `0019`，且都声明 `TASK-DESIGN-009`                                                                                                                                                 | 把“内容页排版”改为独立编号，例如 `TASK-DESIGN-015`           |
| ADR 文件号与标题不一致  | `0014-persistence-testability-and-write-conflicts.md` 标题写 `0010`；`0015-visual-qa...` 标题写 `0011`                                                                                                                                                  | 修正标题，保留文件名以避免断链                               |
| ADR 状态元数据缺失      | 134 篇中只有 6 篇含“状态：”；0114、0117 仍有“提议”，但代码已部分实现                                                                                                                                                                                    | 统一补 `状态/日期`；已实施但未全部完成的标“接受（部分实施）” |
| 架构文档模块名漂移      | 文档写 `features/project`、`features/template-import`、`features/ai-content`、`features/ai-design`、`features/scene3d`、`components/`、`types/`；实际是 `src/app`、`src/features/ai`、`src/features/editor`、`src/features/pptx-export`、`src/services` | 按实际目录更新；未落地模块标为“目标结构”                     |
| V0.1 计划范围说明过时   | §5 仍写 AI、PPTX 导入、动画等“进入 V0.2 以后”，但这些已实现                                                                                                                                                                                             | 改为“历史范围”，并链接实现状态                               |
| Schema v30 固定样例缺失 | Schema 已到 30，`src/core/document-model/__fixtures__` 最新只有 `v29-document.json`                                                                                                                                                                     | 补 `v30-document.json` 与迁移断言，满足工程指南要求          |
| 任务书状态未统一        | 0034、0035、0036 原来没有状态字段；部分任务“已完成”仍带“待人工复核”                                                                                                                                                                                     | 已在任务书补状态行；后续把人工复核结果写回任务书             |

### ADR 编号冲突清单

| 编号 | 文件                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 0029 | `0029-live-deck-verification-and-punctuation.md`、`0029-scrim-footer-and-column-cards.md`                                 |
| 0031 | `0031-manual-ai-visual-asset.md`、`0031-theme-type-tokens-and-presets.md`                                                 |
| 0033 | `0033-canvas-assist-layer-and-snap-tiering.md`、`0033-preset-library-expansion.md`                                        |
| 0034 | `0034-multi-selection-and-batch-commands.md`、`0034-table-banding-and-alignment.md`                                       |
| 0035 | `0035-draft-regeneration-from-review.md`、`0035-template-less-preset-generation.md`                                       |
| 0036 | `0036-short-cover-title-scaling.md`、`0036-visual-asset-intent-in-content-review.md`                                      |
| 0037 | `0037-sparse-page-sizing.md`、`0037-visual-review-execution-bounds.md`                                                    |
| 0038 | `0038-built-in-icons.md`、`0038-line-element-and-fit-to-window.md`、`0038-visual-narrative-and-deck-art-direction.md`     |
| 0052 | `0052-interface-language.md`、`0052-pptx-level-a-import.md`                                                               |
| 0104 | `0104-chart-palette-and-grid.md`、`0104-layer-visibility-and-export.md`                                                   |
| 0105 | `0105-paragraph-spacing.md`、`0105-variants-belong-to-templates.md`                                                       |
| 0106 | `0106-dark-page-image-tone.md`、`0106-native-tab-stops.md`、`0106-style-profiles-compose-existing-design-capabilities.md` |

## 6. 维护规则

1. **完成度只改一处**：功能状态变化先更新 [实现状态盘点](development/implementation-status.md)，再按需同步任务书和计划。
2. **新增 ADR 用下一个未占用编号**：当前最大编号是 `0120`；不要复用已有编号，即使文件名不同也不行。
3. **新增任务先写任务书**：范围、验收、测试计划和状态字段齐全后再开工；未写任务书的条目不得直接进入实现。
4. **状态变化写日期**：`已实现（2026-10-27）`、`部分实现（阶段 A）` 比单独的“完成”可追溯。
5. **需求变化先改 TRS**：再同步架构、计划和验收；不要把实现选择写回需求而不留变更记录。
6. **ADR 状态统一**：提议 / 接受 / 接受（部分实施） / 已废弃；已实施的决定不要继续标“提议”。
7. **不静默改兼容性声明**：导入/导出的支持范围必须按真实测试结果写，降级项进入报告。
