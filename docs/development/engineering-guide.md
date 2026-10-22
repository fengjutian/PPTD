# 工程约定与质量门禁

## 1. 建议目录

```text
src/
  app/                 # 路由、工作台组装、错误边界
  components/          # 通用 UI；不包含领域规则
  core/
    document-model/    # 类型、Schema、迁移
    commands/          # 命令、事务、撤销重做
    geometry/          # EMU、矩形、变换
    validation/        # 文档与导出前校验
    rendering/         # 渲染输入与选择器
  features/
    editor/
    project/
    pptx-export/
    template-import/   # V0.2
    ai-content/        # V0.4
    ai-design/         # V0.4
    scene3d/           # V0.5
  services/            # 端口接口与前端适配器
  store/               # 会话状态与领域聚合连接
  types/
src-tauri/
  src/commands/        # 窄 Tauri commands
  src/services/        # 文件、数据库、安全凭据
  src/storage/         # SQLite 与项目存储
tests/
  fixtures/
  compatibility/
  visual/
```

模块通过公开入口导入，禁止从其他 feature 深层路径读取内部实现。`core` 不导入 React、Tauri、PptxGenJS 或 Three.js。

## 2. 编码规则

- TypeScript 开启严格模式，不用 `any` 绕过领域边界。
- 外部输入先以 `unknown` 接收，通过 Schema 后进入领域层。
- 单位写入类型名或值对象，禁止裸数字混用像素、英寸和 EMU。
- 状态修改必须使用命令；组件不得直接改聚合对象。
- 错误采用稳定错误码、用户可读消息和可选诊断上下文。
- 日志不得包含 API Key、完整用户正文或未脱敏文件内容。
- 长任务接收取消信号并报告结构化进度。

## 3. 测试金字塔

| 层级 | 覆盖重点                                   | 运行频率      |
| ---- | ------------------------------------------ | ------------- |
| 单元 | Schema、命令、不变量、坐标、迁移、导出计划 | 每次提交      |
| 组件 | 编辑器选择、属性修改、快捷键、错误展示     | 每次提交      |
| 集成 | 新建/保存/恢复、资源管理、PPTX 生成        | 合并前        |
| 兼容 | 固定 PPTX 样例在目标软件中的行为           | 里程碑/发布前 |
| 视觉 | 编辑画布与导出渲染关键页差异               | 里程碑/发布前 |

测试关注可观察行为。不要为简单样式或实现细节写脆弱快照。领域测试应验证 revision、内容隔离和反向 patch，而不只是断言函数被调用。

## 4. 合并门禁

每个合并请求至少通过：

1. TypeScript 类型检查。
2. ESLint 和格式检查。
3. Rust `fmt`、`clippy` 和测试。
4. 前端单元/组件测试。
5. 生产构建。
6. 直接与传递依赖的许可证扫描。

触及文档 Schema 时必须包含迁移和固定样例；触及导出器时必须更新至少一个导出夹具和导出报告断言；触及 Tauri capability 时必须说明新增权限的使用场景。

## 5. Definition of Done

一项功能只有在以下条件全部满足后才算完成：需求与边界明确，错误和取消路径可见，必要测试通过，文档/迁移同步更新，无未说明的数据格式变化，且验收者可以从干净项目复现结果。

## 6. 文档治理

TRS 是需求基线；架构文档解释实现边界；影响长期结构的决定记录为 `docs/architecture/decisions/NNNN-title.md`。需求变化先更新 TRS 版本或变更记录，再更新计划与验收场景，避免实现文档成为互相冲突的事实来源。
