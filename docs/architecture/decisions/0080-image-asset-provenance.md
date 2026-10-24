# 0080 图片资产来源与核验状态

## 状态

已接受（2026-10-24）。

## 背景

图片元素只有替代文本。用户无法回答“这张图哪来的、能不能商用、是不是最新版 logo”；导出报告也无法区分官方素材、AI 生成图和未标注图片。需求 FR-D7 要求记录来源 URL、许可、时间、内容哈希与核验状态。

## 决策

### 1. provenance 是图片元素的可选设计态

```ts
interface AssetProvenance {
  verification: "verified" | "pending" | "user";
  sourceUrl?: string;
  license?: string;
  checkedAt?: string;
  contentHash?: string;
}
```

挂在 `ImageElement.provenance`，不进入内容哈希，不改变内容 revision。Schema 20 → 21，旧文档与导入图片没有该字段，报告为“未标注”。

### 2. 命令负责规则，界面只提交意图

新增设计命令 `set-image-provenance`：

- `verified` 必须同时有 `sourceUrl` 与 `license`，否则 `IMAGE_PROVENANCE_INCOMPLETE`；
- `sourceUrl` 只接受 `http(s)://`，≤2048 字符；`license` ≤200 字符；
- `contentHash` 由命令根据当前嵌入的 data URL 计算，不信任调用方；
- `checkedAt` 由命令写入时间，除非调用方显式提供；
- `null` 清除 provenance，图片本身不变。

### 3. 哈希用于“图片被换过”，不是密码学证明

`contentHash` 是 FNV-1a 64 位，与内容哈希同一实现。它只能回答“嵌入字节是否变了”，不能证明来源真实性；ADR 与界面都不得把它描述成签名或版权凭证。

### 4. 界面与报告

- 属性面板“图片”区提供来源 URL、许可说明、状态徽标、标记已核验、清除来源。
- 编辑来源或许可导致 `verified` 不再完整时，命令自动降为 `pending`，不会保留一个名不副实的“已核验”。
- 导出报告统计 `verified / pending / user / missing`（只统计内容图片，不含 `layout-background`），界面显示为“素材 已核验 N / 待核验 N / 未标注 N”。

### 5. 不阻断、不自动核验

没有来源不阻止导出，只作为报告状态。当前不访问 URL、不校验许可真实性和商标；这些需要网络、法律与供应链流程，属于后续独立能力。

## 后果

正面：

- “官方素材”与“未标注素材”第一次可区分，报告可追溯。
- 图片被替换后哈希变化，来源记录不会悄悄指向旧图。
- 核验规则集中在命令层，界面无法绕过。

代价与限制：

- 需要用户手工填写来源与许可；AI 生成图目前仍需用户自己标注（可在后续生成时预填 `user`）。
- 导入 PPTX 的图片没有来源，全部显示“未标注”。
- 哈希不是 SHA-256，不用于对外证明；如需密码学校验要换算法并迁移字段语义。

## 验证

- `image-provenance.test.ts`：verified 缺字段被拒、URL 规范化、哈希生成、非法协议被拒、清除来源。
- `schema.test.ts`：v21 固定样例保留 provenance；v20 迁移不发明来源。
- `export-pptx.test.ts`：导出报告统计 `verified: 1`。
- 全量测试、类型检查、ESLint、生产构建通过。

## 备选方案

- **项目级资产表**：更适合资源去重，但当前图片是内嵌 data URL，跨页共享少；先做元素级，等资源库落地再迁移。
- **导入时自动抓取来源**：PPTX 不携带可靠来源信息，猜测会产生假 provenance；不采用。
- **把 provenance 写进内容哈希**：来源不是已审核文案，进入内容版本会污染审核语义。
- **用 SHA-256**：命令是同步纯函数，WebCrypto 异步；当前目标是检测替换，FNV 足够，密码学场景另立 ADR。
