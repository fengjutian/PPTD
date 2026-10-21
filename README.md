# PPTD

PPTD 是一个以结构化文档模型为核心的桌面端 PPT 生成、设计与编辑平台。产品采用“内容生成与审核 → 视觉设计与导出”的两阶段工作流，目标是生成可继续编辑的 PPTX，而非整页图片。

当前仓库处于技术设计阶段。开发以 [技术需求基线](docs/requirements/PPTD-TRS-v1.0.md) 为准，实施细节见：

- [系统架构](docs/architecture/system-architecture.md)
- [领域模型与版本规则](docs/architecture/domain-model.md)
- [V0.1 开发计划](docs/development/v0.1-plan.md)
- [工程约定与质量门禁](docs/development/engineering-guide.md)

## 核心约束

1. `Content Model` 与 `Design Model` 分离，设计操作不得静默修改已审核内容。
2. 编辑器、预览、导入和导出共享同一个 `PresentationDocument`。
3. 普通对象优先导出为 PowerPoint 原生可编辑对象。
4. PPTX 兼容能力按实际解析结果报告，不承诺任意文件无损往返。
5. V0.1 先完成 2D 编辑闭环，再扩展 OOXML、AI 与 3D 能力。

## 文档状态

| 文档 | 状态 | 用途 |
|---|---|---|
| TRS V1.0 | 已基线化 | 产品与技术需求的原始依据 |
| 系统架构 | 初版 | 模块边界、依赖方向和运行时数据流 |
| 领域模型 | 初版 | 核心实体、命令、版本与不变量 |
| V0.1 计划 | 可执行 | 第一阶段任务拆分、顺序和验收 |
| 工程指南 | 初版 | 仓库结构、测试、提交与质量规则 |
