# TASK-IMPORT-001：PPTX 内容导入（Level A）

| 项目     | 内容                                        |
| -------- | ------------------------------------------- |
| 状态     | 部分实现（Level A 首版已落地）              |
| 优先级   | P0                                          |
| 里程碑   | V0.3 内容导入                               |
| 预估     | 5–7 人日                                    |
| 依赖     | 无（复用现有 PPTX 模板解析与旧版 PPT 转换） |
| 需求依据 | TRS 4.5、4.5.1、4.5.2、4.5.4、4.5.5         |

## 1. 背景

TRS 4.5 要求统一“打开/导入”入口接受 `.pptd`、`.pptx` 和 `.ppt`，并把 PPTX 解析成新的可编辑 `PresentationDocument`，同时生成逐项兼容报告。

当前实现只做了“模板抽取”：`import_pptx_template` / `analyze_pptx_template` 读取主题色、字体、母版和版式区域，用于后续 AI 设计参考；幻灯片里的文字、图片、形状和表格没有被导入。用户无法打开一份已有 PPTX 继续编辑，只能重新生成。

同一入口还承担两种意图，必须显式区分：

- **作为模板**：只取设计语言，不导入内容（现有能力）。
- **导入内容**：把幻灯片解析成可编辑文档（本任务）。

## 2. 目标

用户选择一份 `.pptx`（或经受控转换后的 `.ppt`），在确认导入报告后得到一份新的 PPTD 文档：页面尺寸与顺序、文本、图片、基础形状和基础表格可编辑；不支持的对象逐项记录并跳过；源文件永不被覆盖；导入过程有清晰的安全边界和取消路径。

## 3. Level A 范围

TRS 4.5.4 的 Level A 定义：常规文本、图片、形状和基础表格可解析及编辑。本任务只做 Level A。

### 3.1 包含

| OOXML 对象       | 映射                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `p:sldSz`        | `document.pageSize`（EMU）                                           |
| `p:sldIdLst`     | 页面顺序                                                             |
| `p:sp` 文本框    | `text` 元素；段落 → 换行；run 样式 → `style`/`runs`                  |
| 标题/正文占位符  | `content.title` / `content.body` 与 `contentRef`                     |
| `p:pic`          | `image` 元素；`blip` 关系 → 媒体字节 → data URL；`srcRect` → `crop`  |
| 基础 `p:sp` 形状 | `shape`（rect/ellipse/roundRect）与 `line`；填充、描边、旋转         |
| `a:tbl`          | `table` 元素 + `table-data` 内容块；基础表头/单元格文字              |
| 主题             | 主题色与 major/minor 字体写入 `document.theme`，供文字和默认样式使用 |
| 演讲备注         | `slide.content.speakerNotes`                                         |
| 页面标题         | 占位符标题或首个文本，写入 `content.title`                           |

### 3.2 明确不支持（记录报告后跳过）

- 图表（`c:chart`）、SmartArt、组合（`p:grpSp`）、OLE/嵌入对象、3D 模型。
- 动画和切换：不导入；报告逐页说明。
- 视频/音频、外部链接图片、EMF/WMF/SVG 等 Level A 之外的媒体。
- 母版/版式形状的保真重建：只读取主题与页面尺寸，不把母版装饰绘成对象。
- 合并单元格、复杂表格样式：基础表格可导入；合并/嵌套表格降级并报告。
- 超链接（文档模型暂无超链接字段）。
- 三种保留模式中的“智能重排/重新设计”：Level A 只做“解析后重建、保留原坐标”。

## 4. 架构与数据流

```text
选择文件
  → 文件签名/容器识别（不信任扩展名）
  → 旧版 .ppt 用现有 convert_legacy_ppt 转临时 .pptx
  → Rust import_pptx_content(path)：
      ZIP 安全检查 → presentation.xml → 页面关系 → slide XML
      → 文本 / 图片 / 形状 / 表格提取 → ImportedDeck JSON
      → 图片以 data URL 返回（受大小上限）
  → TS 映射器 importedDeckToDocument()：生成 PresentationDocument
  → 导入报告对话框（页数、对象数、兼容等级、逐项警告）
  → 用户确认 → loadDocument → 另存为新的 .pptd
```

### 4.1 Rust 端

新增 `src-tauri/src/import/pptx.rs`（或 `commands/project_file.rs` 内的独立模块）：

```rust
#[tauri::command]
pub async fn import_pptx_content(path: String) -> Result<ImportedDeck, String>;
```

- 只读源文件；临时转换文件写入受控临时目录并在结束后清理。
- 复用 `validate_pptx_archive` 的 ZIP 限制思路，新增页面数、对象数、单媒体大小、总媒体大小上限。
- 关系解析只跟随内部 `TargetMode="Internal"`；外部关系跳过并报告。
- 不执行宏、脚本、外部实体或任何 OOXML 扩展。
- 返回结构与 `analyze_pptx_template` 分开，避免把“设计分析”与“内容导入”混成一个契约。

建议的 `ImportedDeck`：

```ts
interface ImportedDeck {
  pageSize: { width: number; height: number };
  slides: ImportedSlide[];
  theme?: { majorFont?: string; minorFont?: string; colors: { name: string; value: string }[] };
  report: ImportReport;
}
```

### 4.2 TS 映射器

新增 `src/services/pptx-import.ts` 与 `src/core/commands/import-mapping.ts`（纯函数，可测试）：

- 生成新的 `PresentationDocument`：`createDocument()` 后逐页替换，保留 `schemaVersion` 当前值。
- 文本：统一映射到 `TextElement`；段落换行、对齐、字号、颜色、粗体、斜体、下划线；不一致的斜体/删除线降级为元素样式并报告。
- 占位符：标题/正文绑定 `contentRef`，其余文本为 `decorative`，避免把版式装饰误当内容。
- 图片：data URL + MIME + 宽高 + crop + alt。
- 形状：rect/ellipse/roundRect/line；其他 preset 降级为矩形并报告。
- 表格：创建 `table-data` 块与 `table` 元素；合并单元格降级并报告。
- 内容状态：导入页统一为 `review`（未经用户审核，导出预检会提示）；是否改为 `draft` 待确认。

### 4.3 报告

`ImportReport` 不写入项目文件，只在导入对话框和状态栏使用：

```ts
interface ImportReport {
  format: "pptx" | "ppt";
  compatibility: "A" | "B" | "C";
  slideCount: number;
  counts: { text: number; image: number; shape: number; table: number };
  unsupported: Array<{ slideIndex: number; kind: string; detail: string }>;
  warnings: string[];
  assets: { extracted: number; skipped: number; bytes: number };
}
```

- 兼容等级由实际解析结果决定，不由扩展名推断。
- 任何降级、跳过、字体替代都必须出现在报告里。
- 报告里明确写出“母版/版式未保真重建”“动画未导入”。

## 5. 安全与限制

| 风险       | 处理                                                  |
| ---------- | ----------------------------------------------------- |
| ZIP 炸弹   | 条目数、单条目解压大小、总解压大小、压缩比上限        |
| 路径穿越   | 只接受规范化的内部路径，拒绝 `..`、绝对路径、符号链接 |
| 异常 XML   | 深度/节点数/文本大小上限；解析失败按页报告，不 panic  |
| 外部关系   | `TargetMode="External"` 一律跳过并报告                |
| 宏与脚本   | 不执行、不读取 `vbaProject.bin`，只作为不支持对象报告 |
| 媒体炸弹   | 单图/总媒体字节上限；超限跳过并报告                   |
| 源文件覆盖 | 导入只读；新文档必须另存为新的 `.pptd`                |
| 取消       | 解析与映射支持取消，取消后不改变当前工作区            |

上限建议：文件 ≤ 512 MB、页数 ≤ 200、每页元素 ≤ 500、单图 ≤ 20 MB、总媒体 ≤ 200 MB、XML 文本 ≤ 20 MB/页。

## 6. UI

- 选择 `.pptx/.ppt` 后先弹出意图选择：
  - **导入内容（Level A）**
  - **仅提取模板主题**（现有流程）
- 导入内容时显示进度（解析页数/对象数）与取消。
- 完成后显示导入报告：兼容等级、页数、各类对象数、不支持项、字体与资源提示。
- 用户确认后载入新文档；状态栏提示“已导入，尚未保存”，引导“另存为”。
- 源文件路径只用于读取，不写回；旧版 `.ppt` 的临时转换文件清理。

## 7. 验收

- **AC-1** 导入 2 页含文本/图片/矩形/表格的 PPTX，页数、顺序、页面尺寸一致。
- **AC-2** 文本框内容、字号、颜色、粗体/斜体/下划线和坐标可编辑；标题/正文进入内容模型。
- **AC-3** 图片可显示、可裁剪、可导出为原生图片；媒体资源随项目保存。
- **AC-4** 基础表格成为原生表格 + 内容块，单元格可编辑。
- **AC-5** 图表/组合/动画/视频被跳过并在报告里逐项记录，不产生半成品元素。
- **AC-6** 损坏 ZIP、ZIP 炸弹、路径穿越、外部关系文件被拒绝或安全跳过，应用不崩溃。
- **AC-7** 取消导入后当前文档、撤销栈、保存状态不变。
- **AC-8** 导入后另存为新的 `.pptd`，重新打开内容一致；源 PPTX 未被修改（哈希不变）。
- **AC-9** 导出导入后的文档，页数/顺序一致，文本/图片/表格仍可编辑。
- **AC-10** 旧版 `.ppt` 在无转换器时明确报错，不假装成功。

## 8. 测试与夹具

- Rust：提交固定夹具 `src-tauri/tests/fixtures/level-a.pptx`（2–3 页、含图片/表格/形状/备注），覆盖页面尺寸、顺序、文本、图片、表格、备注、不支持对象。
- Rust 安全：损坏 ZIP、压缩比炸弹、路径穿越、外部关系、超大媒体。
- TS：`importedDeckToDocument` 快照测试；标题/正文/装饰文本的 contentRef；表格块；crop；降级报告。
- UI：意图选择、报告对话框、取消路径、确认后另存提示。
- 集成：导入 → 保存 → 重开 → 导出；可选视觉回归（有 Office/LibreOffice 的机器）。
- 手工：PowerPoint 打开导入后再导出的文件，确认文本/图片/表格可编辑。

## 9. 实施切片

1. Rust 读取器 + `import_pptx_content` + 夹具测试（2–3 人日）。
2. TS 映射器 + 报告模型 + 单元测试（1–2 人日）。
3. 意图选择/进度/报告/另存 UI（1 人日）。
4. 安全边界、取消、集成测试、文档（1 人日）。

## 10. 风险与待定

| 风险                                 | 对策                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| 文本版式差异（换行、autofit、inset） | Level A 只保证内容与基础样式；报告说明版式差异                 |
| 主题色/字体解析不完整                | 先支持 `clrScheme` 与 major/minor 字体；缺失回退并报告         |
| 图片体积导致项目膨胀                 | 媒体上限 + 保存时外部化为资源文件                              |
| 旧版 `.ppt` 依赖本机转换器           | 复用现有 `convert_legacy_ppt`，无转换器明确失败                |
| 表格合并/边框样式                    | 基础表格先落地；合并单元格降级并报告                           |
| 导入页审核状态                       | 待定：`review` 还是 `draft`；建议 `review`，导出预检提示未审核 |

## 11. 完成定义

- [x] Level A 对象可导入并在编辑器中编辑（文本、图片、基础形状、基础表格）。
- [x] 不支持对象逐项进入报告，不产生悬空引用。
- [x] ZIP 路径穿越与源文件只读边界有测试。
- [ ] 导入 → 保存 → 重开 → 导出链路的端到端测试。
- [x] 文档更新：README 限制、任务状态、ADR 与领域模型。
- [ ] 在 PowerPoint 中打开导入后再导出的文件做人工核验。

## 12. 首版实现记录（2026-10-23）

### 已落地

- Rust `commands/pptx_import.rs`：`import_pptx_content` 命令；读取 `presentation.xml`、关系、主题、幻灯片、版式/母版占位符几何、备注。
- 文本：段落换行、对齐、字号、颜色、粗体/斜体/下划线/删除线、行距、项目符号、垂直对齐、run 级粗体/颜色/下划线、标题/正文 `contentRef`。
- 图片：PNG/JPEG/WebP、data URL、裁剪、旋转、替代文本、媒体大小与总量上限。
- 形状：矩形、椭圆、圆角矩形（按带半径的矩形）、连接线；填充/描边/线宽/虚线。
- 表格：表头 + 数据行、基础单元格文字；超过 8 列或 30 行截断并报告；合并单元格降级并报告。
- 主题：`clrScheme` 颜色、major/minor 字体；主题色解析用于文字和默认样式。
- 安全：文件大小、ZIP 条目数/解压总量、路径穿越、XML 大小、外部关系、媒体上限；源文件只读。
- TS `core/commands/pptx-import.ts`：中性结构 → `PresentationDocument`；导入页状态为 `review`；每页内容缺失标题时回退“第 N 页”。
- UI：打开 PPTX/PPT 后先选“导入内容（Level A）”或“仅提取模板主题”；导入报告展示兼容等级、对象计数、跳过项、警告；确认后载入为未保存新项目并提示另存。
- 导出预检会继续提示导入内容尚未审核。

### 与任务书的差异 / 仍缺

- **没有进度条与取消按钮**：解析期间状态栏显示“正在解析”，对话框显示解析中；Rust 侧暂未接入取消令牌。
- `.ppt` 仍先走现有 `convertLegacyPpt` 转临时 `.pptx`，没有独立解析器。
- 主题只读取 `ppt/theme/theme1.xml`；主题经其他部件引用时可能缺色，文字回退默认色。
- 母版/版式只用于补齐占位符几何，不重建母版装饰、背景图形和占位符继承样式。
- 表格样式统一按默认表格样式导入；合并单元格按普通单元格处理；超过 8 列/30 行截断。
- 圆角矩形映射为带圆角的矩形；其他 preset 形状降级为矩形并报告。
- 没有导入动画、切换、超链接、图表、组合、SmartArt、OLE、音视频。
- 没有端到端“导入→保存→重开→导出”测试，也没有 PowerPoint 人工目检。

### 验证

- Rust：`cargo fmt --all`、`cargo clippy --all-targets -- -D warnings`、`cargo test --lib` 通过；新增 5 项导入测试（含真实 ZIP 夹具、路径穿越拒绝），Rust 全量 107 通过、5 忽略。
- 前端：`npm run typecheck`、`npm run lint`、`npm run build` 通过；新增 5 项测试（映射 3、对话框 2）；全量 124 个文件、953 项通过。
- 用 `.tmp/out/recipe-data.pptx` 与 `recipe-image.pptx` 做过手工探针：文本/形状/图片可读，兼容等级 A。
