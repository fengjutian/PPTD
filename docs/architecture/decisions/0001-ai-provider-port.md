# 0001 AI 服务按厂商端口/适配器拆分

- 状态：已接受
- 日期：2026-10-21

## 背景

早期 AI 相关代码集中在 `src-tauri/src/commands/minimax.rs`，文件名、命令名、错误码、凭据槽位和界面文案全部绑定在 MiniMax 一家厂商上。这带来三个问题：

1. 文件名和模块名暗示"本应用只能用一个厂商"，与"后续可能支持别的 AI"的产品方向冲突。
2. 厂商细节（地址、鉴权、请求体结构、响应结构）散落在命令实现中，新增第二家厂商必须改动同一批文件。
3. 前端通过 `minimax_api_key_configured` 这类命令名与后端耦合，换厂商要同时改前后端。

## 决策

### 后端

- 新增 `src-tauri/src/ai/` 作为 AI 服务端口层：
  - `ChatProvider` trait 定义厂商契约：标识、展示名、服务地址、默认模型、环境变量、鉴权、请求体构造、响应解析。
  - `PROVIDERS` 注册表登记已支持的厂商，`resolve()` 按标识解析。
  - `chat()` 统一承担超时、限流重试与退避，产出厂商无关的错误码。
  - 凭据按厂商分槽位保存（`ai-api-key/{provider_id}`），互不覆盖。
- `src-tauri/src/ai/minimax.rs` 是 MiniMax 适配器，厂商专属信息只出现在这一个文件里。
- `src-tauri/src/commands/ai.rs` 是厂商无关的命令层，只描述"要做什么"。命令名不再含厂商名：
  - `save_ai_api_key` / `delete_ai_api_key` / `ai_api_key_configured` / `test_ai_connection`
  - `generate_presentation` / `generate_slide_briefs` / `generate_presentation_design` 增加可选 `provider` 字段。
- 错误码统一为 `AI_*` 前缀，厂商不再泄漏错误码。

### 前端

- 新增 `src/services/ai-providers.ts` 作为厂商目录，登记界面需要的厂商信息（标识、展示名、服务地址、可用模型）。
- `AppSettings` 由 `minimaxModel` 改为 `aiProviderId` + `aiModel`，设置项与厂商解耦。
- `src/services/ai-service.ts` 只暴露厂商无关的调用，不再出现厂商名。

### 兼容

- 旧凭据槽位 `minimax-api-key` 仍会被读取一次，保存新凭据后自动清理旧槽位，历史用户无需重新配置 Key。
- 旧的 localStorage 键 `pptd:minimax-model` 曾在引入时读取一次作为模型回退；本地设置迁移到 SQLite 后该回退已移除。

## 后果

- 新增一家厂商的成本：后端新增一个适配器文件并注册，前端在厂商目录加一条；命令层、设置界面和调用代码不需要改动。
- 模型目录目前只在前端维护（后端只保留默认模型作为兜底），两边的 `defaultModel` / `default_model()` 必须一致。
- 端口层目前按 OpenAI 风格协议设计；协议差异较大的厂商需要在适配器里自行构造请求体与解析响应，端口层不感知差异。

## 备选方案

- **只重命名文件，不做抽象**：改动最小，但厂商细节仍然散落，第二家厂商进来还是要改同一批文件，未解决根因。
- **让前端直接切换厂商实现**：前端承担了后端已有的职责，与"能力通过端口及适配器接入"的架构规则冲突。
