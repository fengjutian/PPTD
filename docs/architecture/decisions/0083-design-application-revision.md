# 0083 设计应用的内容 revision 语义

## 状态

已接受（2026-10-24）。

## 背景

`apply-ai-designed-draft` 同时可能重建页面与内容，因此 `commandDomain` 把它标成 `both`。store 对 `both` 的处理是无条件递增 `contentRevision` 和 `designRevision`。

结果是：只换配色、重新应用同一份已审核内容，也会让内容 revision 前进。方向记录、内容审核状态与版本历史因此看到一个并未发生的内容变更。

## 决策

### 1. “能改内容”不等于“这次改了内容”

`commandDomain` 仍返回 `both`：命令确实有能力写入内容，静态分类不应撒谎。

store 在执行 `apply-ai-designed-draft` 时额外做一次语义比较：

- 执行前记录 `documentSemanticContentFingerprint`；
- 执行后比较；
- 只有语义内容变化时才递增 `contentRevision`；
- `designRevision` 仍按 `both` 递增，`documentRevision` 仍递增。

### 2. 语义指纹忽略实体 ID

新增 `documentSemanticContentFingerprint`：标题、正文、备注、结构化块的值与顺序，**去掉块 ID**。

重建设计时会为同一份内容铸造新的块 ID；如果按普通内容哈希比较，每次应用都会被判成内容变化。ID 是存储身份，不是审核过的内容。

### 3. 范围只限这个命令

其他 `both` 命令（复制页、删除页、移动页）保持无条件递增：它们确实改变页面集合与内容归属。只有“重新应用设计”需要区分“设计变了”与“内容变了”。

### 4. 撤销与持久化不变

revision 仍写在 Immer patch 里，撤销会恢复旧 revision；语义指纹只在 store 内临时计算，不进入文档、不进入 Schema。

## 后果

正面：

- 只改设计不再推进内容 revision，方向记录与审核状态不会被误判过期。
- 真正的内容改动仍然递增，测试覆盖两个方向。
- 不改变命令合同，不新增持久化字段。

代价与限制：

- 语义比较每次应用多做一次 JSON 遍历；文稿规模下可忽略。
- 语义指纹只比较结构化块的值，不理解块类型的业务含义；未来若块内出现非内容元数据，需要同步排除。
- 其他 `both` 命令仍可能多计内容 revision；它们属于页面集合变更，暂不细化。

## 验证

- `editor-store.test.ts`：同一内容换配色 → `contentRevision` 不变、`designRevision` +1；改正文 → `contentRevision` +1。
- 全量测试、类型检查、ESLint、生产构建通过。

## 备选方案

- **把命令域改成 `design`**：首次生成会漏掉内容 revision，审核状态会错。
- **拆成两个命令**：语义更干净，但调用方、撤销与预览链路都要改；当前不值得。
- **直接比较普通内容哈希**：块 ID 随机，会把每次设计应用都判成内容变化。
- **比较整份 JSON**：同上，且会被坐标、样式等设计字段干扰。
