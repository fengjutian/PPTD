import { Check, Copy, FileUp, Images, Palette, X } from "lucide-react";

import { EMU_PER_INCH } from "../core/document-model";

import { contrastRatio } from "../core/rendering/contrast";

import { ThemePresetPicker } from "../features/ai/ThemePresetPicker";
import { ThemeSpecimenDialog } from "../features/ai/ThemeSpecimenDialog";

import { THEME_PRESETS } from "../core/design/theme-presets";

import type { AppRuntime } from "./app-runtime";
import { themeColorRoleLabels, themeAudienceLabels, themePageTypeLabels, themeDensityLabels } from "./app-shared";

export function ThemeWorkspaceView({ app }: { app: AppRuntime }) {
  const {
    activeView,
    agentWorkflow,
    setTemplateUploadOpen,
    themePresetId,
    handleSelectThemePreset,
    templateLibrary,
    selectedTemplate,
    handleSelectTemplate,
    setTemplateMenu,
    themeDrawerOpen,
    drawerThemePreset,
    closeThemeDrawer,
    themePreviewLocked,
    drawerThemeGuidance,
    drawerThemeMetadata,
    drawerSurfaceColor,
    setTaskStatus,
    drawerThemeAiPrompt,
    templatePreviewBusy,
    templatePreview,
    templateAnalysis,
    templateTargetPreview,
    setThemeSpecimenPresetId,
    applyDrawerTheme,
    themeSpecimenPresetId,
  } = app;

  return (
    <>
      {activeView === "theme" && (
        <main className="feature-workspace theme-workspace">
          <header className="feature-header">
            <div>
              <Palette />
              <div>
                <h1>主题模板</h1>
                <p>选择内置主题，或从已有 PPT 中抽取配色、字体、母版和版式</p>
              </div>
            </div>
            <div className="feature-header-actions">
              <div className="workflow-steps">
                <span className="done">
                  <Check /> 生成草稿
                </span>
                <i />
                <span className="done">
                  <Check /> 编辑文字
                </span>
                <i />
                <span className="active">3 选择主题</span>
              </div>
              <span className="agent-workflow-status" aria-live="polite">
                {agentWorkflow.label}
              </span>
              <button
                type="button"
                className="primary-action header-upload-button"
                onClick={() => setTemplateUploadOpen(true)}
              >
                <FileUp />从 PPT 抽取主题
              </button>
            </div>
          </header>
          <div className="feature-scroll">
            <section className="template-content">
              <div className="theme-gallery-heading">
                <div>
                  <strong>内置主题</strong>
                  <span>{THEME_PRESETS.length} 套可用</span>
                </div>
                <p>点击卡片查看完整配色、字体和适用场景</p>
              </div>
              {/* 生成中也能点开详情：锁定的是“切换主题”，不是“查看主题”。 */}
              <ThemePresetPicker value={themePresetId} onChange={handleSelectThemePreset} />
              <div className="theme-gallery-heading extracted">
                <div>
                  <strong>从 PPT 抽取的主题</strong>
                  <span>{templateLibrary.length} 套</span>
                </div>
                <p>保留来源文件的设计语言，并展示可解析范围；右键卡片可重命名或删除</p>
              </div>
              <div className="theme-card-grid extracted-theme-grid">
                {templateLibrary.map((template) => (
                  <button
                    type="button"
                    className={`theme-card extracted${selectedTemplate?.id === template.id ? " active" : ""}`}
                    key={template.id}
                    onClick={() => void handleSelectTemplate(template)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTemplateMenu({ template, x: event.clientX, y: event.clientY });
                    }}
                    title="右键可重命名或删除"
                  >
                    <span className="theme-card-art extracted-art">
                      <FileUp />
                      <i />
                      <i />
                    </span>
                    <strong>{template.name}</strong>
                    <small>从 PPTX 抽取的主题、母版与版式</small>
                    <span className="theme-card-fonts">
                      {(template.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                      {new Date(template.importedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="theme-card theme-upload-card"
                  onClick={() => setTemplateUploadOpen(true)}
                >
                  <span className="theme-card-art upload-art">
                    <FileUp />
                  </span>
                  <strong>从 PPT 抽取主题</strong>
                  <small>上传 PPTX，提取主题色、字体、母版和页面版式</small>
                  <span className="theme-card-fonts">支持 .pptx · 最大 512 MB</span>
                </button>
              </div>
            </section>
          </div>
        </main>
      )}
      {activeView === "theme" && themeDrawerOpen && (drawerThemePreset || selectedTemplate) && (
        <div
          className="theme-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeThemeDrawer();
          }}
        >
          <aside className="theme-drawer" role="dialog" aria-modal="true" aria-labelledby="theme-drawer-title">
            <div className="theme-drawer-heading">
              <div>
                <span>{drawerThemePreset ? "内置主题" : "PPT 抽取主题"}</span>
                <h2 id="theme-drawer-title">{drawerThemePreset?.name ?? selectedTemplate?.name}</h2>
              </div>
              <button type="button" aria-label="关闭主题详情" onClick={closeThemeDrawer}>
                <X />
              </button>
            </div>
            <div className="theme-drawer-scroll">
              {themePreviewLocked && (
                <p className="theme-drawer-note">
                  AI 正在后台生成当前稿，这里可以查看主题详情；生成完成前不能切换已选主题。
                </p>
              )}
              {drawerThemePreset ? (
                <>
                  <div
                    className="theme-preset-preview"
                    style={
                      {
                        "--theme-primary": drawerThemePreset.theme.colors.find((color) => color.name === "primary")
                          ?.value,
                        "--theme-accent": drawerThemePreset.theme.colors.find((color) => color.name === "accent")
                          ?.value,
                        "--theme-muted": drawerThemePreset.theme.colors.find((color) => color.name === "muted")?.value,
                        "--theme-surface": drawerThemePreset.theme.colors.find((color) => color.name === "surface")
                          ?.value,
                        "--theme-major-font": drawerThemePreset.theme.majorFont,
                        "--theme-minor-font": drawerThemePreset.theme.minorFont,
                      } as React.CSSProperties
                    }
                  >
                    <span className="theme-preview-kicker">PPTD · THEME SYSTEM</span>
                    <div>
                      <h2>{drawerThemePreset.name}</h2>
                      <p>让内容层级、字体与色彩保持一致</p>
                    </div>
                    <div className="theme-preview-bars">
                      <i />
                      <i />
                      <i />
                    </div>
                    <small>{drawerThemePreset.description}</small>
                  </div>
                  <section className="theme-drawer-section">
                    <h3>主题说明</h3>
                    <p>{drawerThemePreset.description}</p>
                    <p>{drawerThemeGuidance?.character}</p>
                  </section>
                  <section className="theme-drawer-section theme-type-sample">
                    <h3>字体样张</h3>
                    <div
                      className="theme-type-row theme-type-display"
                      style={{ fontFamily: drawerThemePreset.theme.majorFont }}
                    >
                      <span>让内容层级、字体与色彩保持一致</span>
                      <small>
                        标题字体 {drawerThemePreset.theme.majorFont} · 封面{" "}
                        {drawerThemePreset.theme.textStyles?.display?.fontSizePt ?? "—"} pt
                      </small>
                    </div>
                    <div
                      className="theme-type-row theme-type-title"
                      style={{ fontFamily: drawerThemePreset.theme.majorFont }}
                    >
                      <span>页面标题示例 Section Title</span>
                      <small>
                        页标题 {drawerThemePreset.theme.textStyles?.title?.fontSizePt ?? "—"} pt · 字距{" "}
                        {drawerThemePreset.theme.textStyles?.title?.letterSpacingPt ?? 0} pt
                      </small>
                    </div>
                    <div
                      className="theme-type-row theme-type-body"
                      style={{ fontFamily: drawerThemePreset.theme.minorFont }}
                    >
                      <span>正文示例：主题决定字体、字号与颜色，已审核的内容结构保持不变。</span>
                      <small>
                        正文字体 {drawerThemePreset.theme.minorFont} · 正文{" "}
                        {drawerThemePreset.theme.textStyles?.body?.fontSizePt ?? "—"} pt · 行高{" "}
                        {drawerThemePreset.theme.textStyles?.body?.lineHeight ?? "—"}
                      </small>
                    </div>
                  </section>
                  <section className="theme-drawer-section theme-guidance-grid">
                    <div>
                      <h3>适用场景</h3>
                      <div className="theme-scenario-tags">
                        {drawerThemeGuidance?.scenarios.map((scenario) => (
                          <span key={scenario}>{scenario}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>页面节奏</h3>
                      <p>{drawerThemeGuidance?.pageRhythm}</p>
                    </div>
                    <div>
                      <h3>图片建议</h3>
                      <p>{drawerThemeGuidance?.imageStyle}</p>
                    </div>
                    {drawerThemeMetadata && (
                      <>
                        <div>
                          <h3>推荐页型</h3>
                          <div className="theme-tag-row">
                            {drawerThemeMetadata.recommendedPageTypes.map((page) => (
                              <span key={page}>{themePageTypeLabels[page]}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3>适用受众</h3>
                          <div className="theme-tag-row">
                            {drawerThemeMetadata.audiences.map((audience) => (
                              <span key={audience}>{themeAudienceLabels[audience]}</span>
                            ))}
                          </div>
                        </div>
                        <div className="theme-guidance-wide">
                          <h3>信息密度与约束</h3>
                          <p>密度：{themeDensityLabels[drawerThemeMetadata.density]}</p>
                          <p>避免：{drawerThemeMetadata.forbiddenCombinations.join("；")}</p>
                        </div>
                      </>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-palette-detail">
                    <div className="theme-drawer-section-heading">
                      <h3>配色与可读性</h3>
                      <p>点击色块可复制色值；对比度按页面底色计算，正文建议不低于 4.5:1。</p>
                    </div>
                    <div className="theme-palette-grid">
                      {drawerThemePreset.theme.colors.map((color) => {
                        const ratio =
                          drawerSurfaceColor && (color.name === "primary" || color.name === "muted")
                            ? contrastRatio(color.value, drawerSurfaceColor)
                            : undefined;
                        return (
                          <button
                            key={color.name}
                            type="button"
                            className="theme-palette-item"
                            title={`复制 ${color.value}`}
                            onClick={() => {
                              void navigator.clipboard.writeText(color.value).then(
                                () => setTaskStatus(`已复制色值 ${color.value}`),
                                () => setTaskStatus("复制失败，请手动选择色值"),
                              );
                            }}
                          >
                            <span className="theme-palette-swatch" style={{ backgroundColor: color.value }} />
                            <span className="theme-palette-copy">
                              <b>{themeColorRoleLabels[color.name] ?? color.name}</b>
                              <code>{color.value}</code>
                              {ratio !== undefined && <em>对比 {ratio.toFixed(1)}:1</em>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="theme-drawer-section theme-token-details">
                    <h3>设计令牌</h3>
                    <dl>
                      <div>
                        <dt>标题字体</dt>
                        <dd>{drawerThemePreset.theme.majorFont}</dd>
                      </div>
                      <div>
                        <dt>正文字体</dt>
                        <dd>{drawerThemePreset.theme.minorFont}</dd>
                      </div>
                      <div>
                        <dt>封面字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.display?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>页标题字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.title?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>副标题字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.subtitle?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>正文字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.body?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>注释字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.caption?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>主题 ID</dt>
                        <dd>
                          <code>{drawerThemePreset.id}</code>
                        </dd>
                      </div>
                    </dl>
                    {drawerThemeMetadata && (
                      <dl>
                        <div>
                          <dt>中文回退</dt>
                          <dd>{drawerThemeMetadata.fontFallbacks.eastAsian.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>西文回退</dt>
                          <dd>{drawerThemeMetadata.fontFallbacks.latin.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>图表色板</dt>
                          <dd>
                            <span className="theme-chart-palette" aria-hidden>
                              {drawerThemeMetadata.chartPalette.map((value) => (
                                <i key={value} style={{ backgroundColor: value }} />
                              ))}
                            </span>{" "}
                            {drawerThemeMetadata.chartPalette.join("、")}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-ai-prompt">
                    <div className="theme-ai-prompt-heading">
                      <div>
                        <h3>AI 主题提示词（复制用）</h3>
                        <p>内置生成会自动使用该主题的结构化方向；这段文本用于复制给外部 AI。</p>
                      </div>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          if (!drawerThemeAiPrompt) return;
                          void navigator.clipboard.writeText(drawerThemeAiPrompt).then(
                            () => setTaskStatus(`已复制「${drawerThemePreset.name}」AI 主题提示词`),
                            () => setTaskStatus("复制失败，请手动选择提示词"),
                          );
                        }}
                      >
                        <Copy />
                        复制提示词
                      </button>
                    </div>
                    <pre>{drawerThemeAiPrompt}</pre>
                  </section>
                </>
              ) : (
                <>
                  <div className="template-preview-stage drawer-preview">
                    {templatePreviewBusy ? (
                      <span>正在解析 PPT 主题…</span>
                    ) : templatePreview ? (
                      <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} />
                    ) : (
                      <span>此 PPTX 没有内嵌封面预览</span>
                    )}
                  </div>
                  {templateAnalysis && (
                    <div className="template-analysis drawer-analysis">
                      <div className="template-analysis-grid">
                        <span>
                          <b>{templateAnalysis.slideCount}</b>页面
                        </span>
                        <span>
                          <b>{templateAnalysis.masterCount}</b>母版
                        </span>
                        <span>
                          <b>{templateAnalysis.layoutCount}</b>版式
                        </span>
                        <span>
                          <b>{templateAnalysis.themeCount}</b>主题
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>页面尺寸</dt>
                          <dd>
                            {templateAnalysis.slideWidthEmu && templateAnalysis.slideHeightEmu
                              ? `${(templateAnalysis.slideWidthEmu / EMU_PER_INCH).toFixed(2)} × ${(templateAnalysis.slideHeightEmu / EMU_PER_INCH).toFixed(2)} in`
                              : "未定义"}
                          </dd>
                        </div>
                        <div>
                          <dt>标题字体</dt>
                          <dd>{templateAnalysis.majorFont || "未定义"}</dd>
                        </div>
                        <div>
                          <dt>正文字体</dt>
                          <dd>{templateAnalysis.minorFont || "未定义"}</dd>
                        </div>
                      </dl>
                      {templateAnalysis.themeColors.length > 0 && (
                        <div className="template-color-row" aria-label="主题色">
                          {templateAnalysis.themeColors.map((color) => (
                            <span
                              key={color.name}
                              title={`${color.name} ${color.value}`}
                              style={{ backgroundColor: color.value }}
                            />
                          ))}
                        </div>
                      )}
                      {templateAnalysis.warnings.length > 0 && (
                        <div className="template-analysis-warning">{templateAnalysis.warnings.join("；")}</div>
                      )}
                    </div>
                  )}
                  {selectedTemplate && (
                    <div className="template-analysis drawer-analysis">
                      <h3>模板验收目标</h3>
                      {templateTargetPreview ? (
                        <dl>
                          <div>
                            <dt>标题轴</dt>
                            <dd>
                              x {templateTargetPreview.grid.titleX.toFixed(3)} · y{" "}
                              {templateTargetPreview.grid.titleY.toFixed(3)}
                            </dd>
                          </div>
                          <div>
                            <dt>内容区</dt>
                            <dd>
                              x {templateTargetPreview.grid.left.toFixed(3)}–
                              {templateTargetPreview.grid.right.toFixed(3)} · y{" "}
                              {templateTargetPreview.grid.bodyTop.toFixed(3)}–
                              {templateTargetPreview.grid.bodyBottom.toFixed(3)}
                            </dd>
                          </div>
                          <div>
                            <dt>字号</dt>
                            <dd>
                              标题 {templateTargetPreview.titleSizePt ?? "未定义"}pt / 正文{" "}
                              {templateTargetPreview.bodySizePt ?? "未定义"}pt
                            </dd>
                          </div>
                          <div>
                            <dt>对齐</dt>
                            <dd>
                              标题 {templateTargetPreview.titleAlign ?? "未声明"} / 正文{" "}
                              {templateTargetPreview.bodyAlign ?? "未声明"}
                            </dd>
                          </div>
                          <div>
                            <dt>字体</dt>
                            <dd>
                              {templateTargetPreview.majorFont ?? "未定义"} /{" "}
                              {templateTargetPreview.minorFont ?? "未定义"}
                            </dd>
                          </div>
                          <div>
                            <dt>版式</dt>
                            <dd>
                              {templateTargetPreview.layouts.length} 个可用 ·
                              {templateTargetPreview.layouts.filter((layout) => layout.freeComposition).length}{" "}
                              个自由构图
                            </dd>
                          </div>
                          <div>
                            <dt>置信度</dt>
                            <dd>
                              {templateTargetPreview.confidence === "high" ? "高" : "低"} · 阈值{" "}
                              {templateTargetPreview.minimumFit}
                            </dd>
                          </div>
                          {templateTargetPreview.templateHash && (
                            <div>
                              <dt>来源指纹</dt>
                              <dd title={templateTargetPreview.templateHash}>
                                {templateTargetPreview.templateHash.slice(0, 12)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <div className="template-analysis-warning">
                          模板缺少可用的标题或内容占位符，无法建立可测量的验收目标。
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="theme-drawer-actions">
              {drawerThemePreset && (
                <button
                  type="button"
                  className="secondary-action theme-sample-action"
                  onClick={() => setThemeSpecimenPresetId(drawerThemePreset.id)}
                >
                  <Images />
                  查看 8 页样张
                </button>
              )}
              <button type="button" className="secondary-action" onClick={closeThemeDrawer}>
                关闭
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={applyDrawerTheme}
                disabled={themePreviewLocked}
                title={themePreviewLocked ? "AI 正在生成，完成后才能切换主题" : undefined}
              >
                <Check />
                使用此主题
              </button>
            </div>
          </aside>
        </div>
      )}
      {activeView === "theme" && themeSpecimenPresetId && (
        <ThemeSpecimenDialog
          presetId={themeSpecimenPresetId}
          aboveDrawer
          onClose={() => setThemeSpecimenPresetId(undefined)}
        />
      )}
    </>
  );
}
