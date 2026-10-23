# 0060 设计快照与视觉评审留痕

## 状态

已接受（V0.2）

## 背景

内容版本只保存标题、正文、内容块和备注。确认一版之后，用户仍会改版式、背景、动画和页面尺寸；这些变化没有历史，恢复内容版本也永远回不到当时的视觉状态。视觉评审的分数与逐页建议只存在于当次会话，重新打开项目后不可回看。

## 决策

### 内容版本带设计副本

`ContentVersion` 新增可选的 `design`：

```ts
interface ContentVersionDesign {
  pageSize: { width: Emu; height: Emu };
  theme?: DocumentTheme;
  layouts?: SlideLayoutSpec[];
  slides: Array<{
    slideId: SlideId;
    background: string;
    elements: SlideElement[];
    animations?: SlideAnimation[];
    transition?: SlideTransition;
    groups?: SlideGroup[];
    layoutId?: string;
  }>;
}
```

确认内容时一次性深拷贝设计状态。设计副本不参与内容签名：只移动对象不会新增内容版本，但下一次确认会把当时的设计一起冻结。

### 两种恢复方式

- `restore-content-version` 默认只恢复内容，保持既有行为。
- 新增 `includeDesign: true`：同一命令同时恢复页面尺寸、主题、版式、背景、元素、动画、切换和分组。版本窗口在检测到版式差异时显示“同时恢复版式（N 页）”。

设计副本缺失（旧版本）时，带设计恢复会返回 `CONTENT_VERSION_DESIGN_MISSING`，不会静默只恢复内容。页面集合不一致时整批拒绝。

### 视觉评审摘要随项目保存

`PresentationDocument.reviewTraces` 保存每次评审的摘要：

```ts
interface ReviewTrace {
  id: string;
  createdAt: string;
  overallScore: number;
  issueCount: number;
  slides: Array<{ slideIndex: number; overallScore: number }>;
}
```

只保存分数、问题数和逐页分数，不保存模型原始响应、不保存页面图片，也不进入内容哈希。最多 20 条，超出丢弃最旧。

### 为什么复用内容版本

设计快照和内容快照描述的是同一个确认时刻。拆成两个独立历史会产生两套时间线和两套恢复语义，而用户看到的只是“回到那一版”。复用 `ContentVersion` 让版本列表、页面匹配和恢复确认逻辑保持一处。

## 后果

- 重新打开项目后，内容版本窗口仍能看到每次评审的总分、问题数和逐页评分。
- 用户可以只恢复内容，也可以显式同时恢复版式；不会因为一次内容恢复静默重置设计。
- 只改设计不会产生新版本；下一次内容确认才冻结当时的设计。
- 设计副本会增加项目体积，尤其是含图片和大量对象的文稿。使用 `structuredClone` 深拷贝，版本上限仍是 30。
- 旧版本没有设计副本，只能恢复内容；界面不显示“同时恢复版式”。

## 验证

- 命令测试：带 `includeDesign` 恢复后，新增形状消失、元素位置和背景回到快照；不带时保持当前设计。
- 版本面板测试：设计变化后出现“同时恢复版式”；评审记录持久化后重新渲染仍显示分数。
- Schema：`reviewTraces` 与 `design` 校验通过，非法结构被拒绝。
- 前端全量测试、类型检查、构建通过。

## 备选方案

- **单独的设计版本数组**：需要第二套列表、第二套恢复和两套时间线对齐，复杂度高于收益。
- **保存完整 VisualReview 对象**：会把服务层类型和模型原始响应写进核心文档，既耦合又会膨胀项目文件。
- **把评审分数写进内容块**：分数是评审元数据，不是已审核内容，会污染内容哈希和版本比较。
