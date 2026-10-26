import { useEffect, useState } from "react";
import { Ban, Check, Image, Info, Layers3, LayoutTemplate, Palette, X } from "lucide-react";

import { CONCEPT_PRESET_LABELS } from "../core/design/deck-concept";
import { STYLE_PROFILES, type StyleProfile, type StyleProfileId } from "../core/design/style-profiles";
import { findThemePreset } from "../core/design/theme-presets";
import type { AppRuntime } from "./app-runtime";

const RECIPE_LABELS: Record<string, string> = {
  "cover-statement": "主张式封面",
  "data-story": "指标叙事",
  "chart-story": "图表叙事",
  "image-led": "图像主导",
  "full-bleed-image": "全幅图片",
  "side-image-text": "侧图正文",
  "editorial-index": "编辑索引",
  "asymmetric-split": "非对称分栏",
  "process-rail": "流程轨",
  comparison: "对比页",
  "weighted-split": "加权对比",
  "timeline-rail": "时间线",
  "quote-field": "引文页",
  "section-statement": "章节主张",
  "paper-column": "纸本专栏",
  "instrument-columns": "指标列阵",
};

const DENSITY_LABELS = { airy: "疏朗", balanced: "均衡", compact: "紧凑" } as const;
const MEDIUM_LABELS = { photo: "摄影", illustration: "插画", "3d": "3D", texture: "材质" } as const;

function StyleSpecimen({
  profile,
  large = false,
  variant = 0,
}: {
  profile: StyleProfile;
  large?: boolean;
  variant?: 0 | 1 | 2;
}) {
  return (
    <span
      className={`style-specimen style-specimen-${profile.specimen.composition} style-specimen-variant-${variant}${large ? " large" : ""}`}
      style={
        {
          "--style-bg": profile.specimen.background,
          "--style-ink": profile.specimen.ink,
          "--style-accent": profile.specimen.accent,
          "--style-secondary": profile.specimen.secondary,
        } as React.CSSProperties
      }
      aria-hidden
    >
      <i className="style-specimen-kicker" />
      <i className="style-specimen-title" />
      <i className="style-specimen-copy" />
      <i className="style-specimen-visual" />
      <i className="style-specimen-rule" />
      <i className="style-specimen-number">0{variant + 1}</i>
      <i className="style-specimen-caption" />
      <i className="style-specimen-metric metric-one" />
      <i className="style-specimen-metric metric-two" />
      <i className="style-specimen-metric metric-three" />
      <i className="style-specimen-dot dot-one" />
      <i className="style-specimen-dot dot-two" />
      <i className="style-specimen-dot dot-three" />
    </span>
  );
}

export function StyleDetailDrawer({
  profile,
  selected,
  onClose,
  onSelect,
}: {
  profile: StyleProfile;
  selected: boolean;
  onClose: () => void;
  onSelect: (id: StyleProfileId) => void;
}) {
  const theme = findThemePreset(profile.themePresetId);
  const colors = theme?.theme.colors.filter((color) =>
    ["surface", "primary", "accent", "accent2", "accent3"].includes(color.name),
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="style-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="style-drawer" role="dialog" aria-modal="true" aria-labelledby="style-drawer-title">
        <header className="style-drawer-header">
          <div>
            <span>PPT 风格 · {profile.englishName}</span>
            <h2 id="style-drawer-title">{profile.name}</h2>
            <p>{profile.summary}</p>
          </div>
          <button type="button" aria-label="关闭风格详情" onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="style-drawer-scroll">
          <section className="style-specimen-showcase" aria-label={`${profile.name}三页样张`}>
            <div className="style-specimen-main">
              <StyleSpecimen profile={profile} large variant={0} />
              <span>主视觉页</span>
            </div>
            <div className="style-specimen-secondary">
              <div>
                <StyleSpecimen profile={profile} variant={1} />
                <span>内容结构页</span>
              </div>
              <div>
                <StyleSpecimen profile={profile} variant={2} />
                <span>数据 / 流程页</span>
              </div>
            </div>
          </section>

          {profile.capability && (
            <section className="style-capability-note">
              <Info />
              <div>
                <strong>部分支持</strong>
                <p>{profile.capability.note}</p>
              </div>
            </section>
          )}

          <section className="style-detail-section style-detail-overview">
            <div>
              <small>信息密度</small>
              <strong>{DENSITY_LABELS[profile.density]}</strong>
            </div>
            <div>
              <small>首选骨架</small>
              <strong>{CONCEPT_PRESET_LABELS[profile.preferredConcept]}</strong>
            </div>
            <div>
              <small>匹配主题</small>
              <strong>{theme?.name ?? profile.themePresetId}</strong>
            </div>
          </section>

          <section className="style-detail-section">
            <h3>
              <Layers3 /> 视觉语言
            </h3>
            <div className="style-detail-tags">
              {profile.visualTraits.map((trait) => (
                <span key={trait}>{trait}</span>
              ))}
            </div>
            <p>适合：{profile.suitableFor.join("、")}</p>
          </section>

          <section className="style-detail-section">
            <h3>
              <LayoutTemplate /> 页面构图
            </h3>
            <p>可用骨架：{profile.allowedConcepts.map((item) => CONCEPT_PRESET_LABELS[item]).join("、")}</p>
            <div className="style-recipe-list">
              {profile.preferredRecipes.map((recipe) => (
                <span key={recipe}>{RECIPE_LABELS[recipe] ?? recipe}</span>
              ))}
            </div>
          </section>

          <section className="style-detail-section">
            <h3>
              <Image /> 图片语言
            </h3>
            <p>{profile.imagery.guidance}</p>
            <div className="style-detail-tags">
              {profile.imagery.media.map((medium) => (
                <span key={medium}>{MEDIUM_LABELS[medium]}</span>
              ))}
            </div>
          </section>

          <section className="style-detail-section">
            <h3>
              <Palette /> 匹配主题
            </h3>
            <p>{theme?.description}</p>
            <div className="style-theme-swatches" aria-label="主题颜色">
              {colors?.map((color) => (
                <span key={color.name} title={`${color.name} ${color.value}`} style={{ background: color.value }} />
              ))}
            </div>
            <p className="style-font-pair">
              {theme?.theme.majorFont} · {theme?.theme.minorFont}
            </p>
          </section>

          <section className="style-detail-section style-detail-forbidden">
            <h3>
              <Ban /> 避免使用
            </h3>
            <ul>
              {profile.forbidden.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          {profile.capability && (
            <section className="style-detail-section style-detail-fallbacks">
              <h3>导出降级规则</h3>
              <ul>
                {profile.capability.fallbacks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="style-drawer-actions">
          <button type="button" className="secondary-action" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={selected}
            onClick={() => {
              onSelect(profile.id);
              onClose();
            }}
          >
            {selected ? (
              <>
                <Check /> 当前已选择
              </>
            ) : (
              "选择此风格"
            )}
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function StyleWorkspaceView({ app }: { app: AppRuntime }) {
  const { activeView, styleProfileId, handleSelectStyleProfile, changeActiveView } = app;
  const [previewProfileId, setPreviewProfileId] = useState<StyleProfileId>();
  if (activeView !== "style") return null;
  const previewProfile = STYLE_PROFILES.find((profile) => profile.id === previewProfileId);

  return (
    <main className="feature-workspace style-workspace">
      <header className="feature-header">
        <div>
          <Layers3 />
          <div>
            <h1>PPT 风格</h1>
            <p>风格决定整册构图、信息密度和图片语言；主题负责配色与字体</p>
          </div>
        </div>
        <div className="feature-header-actions">
          <span className="style-selection-summary">
            {styleProfileId ? "已选择风格，生成时自动带入设计约束" : "选择一套视觉语言"}
          </span>
          <button type="button" className="secondary-action" onClick={() => changeActiveView("theme")}>
            <Palette /> 查看匹配主题
          </button>
        </div>
      </header>

      <div className="feature-scroll">
        <section className="style-content">
          <div className="style-gallery-heading">
            <div>
              <strong>内置风格</strong>
              <span>{STYLE_PROFILES.length} 种可用</span>
            </div>
            <p>同一种风格仍可组合不同主题和页面骨架，不是固定模板</p>
          </div>

          <div className="style-card-grid">
            {STYLE_PROFILES.map((profile) => {
              const active = profile.id === styleProfileId;
              const theme = findThemePreset(profile.themePresetId);
              return (
                <button
                  type="button"
                  key={profile.id}
                  className={`style-card${active ? " active" : ""}`}
                  aria-haspopup="dialog"
                  aria-label={`查看${profile.name}风格详情`}
                  onClick={() => setPreviewProfileId(profile.id)}
                >
                  <StyleSpecimen profile={profile} />
                  <span className="style-card-heading">
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.englishName}</small>
                    </span>
                    {active && (
                      <span className="style-selected-badge">
                        <Check /> 已选择
                      </span>
                    )}
                  </span>
                  {profile.capability && <span className="style-card-support">部分支持</span>}
                  <span className="style-card-summary">{profile.summary}</span>
                  <span className="style-traits">
                    {profile.visualTraits.map((trait) => (
                      <i key={trait}>{trait}</i>
                    ))}
                  </span>
                  <span className="style-card-meta">
                    <span>首选骨架：{CONCEPT_PRESET_LABELS[profile.preferredConcept]}</span>
                    <span>匹配主题：{theme?.name ?? profile.themePresetId}</span>
                  </span>
                  <span className="style-card-scenes">适合：{profile.suitableFor.join("、")}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
      {previewProfile && (
        <StyleDetailDrawer
          profile={previewProfile}
          selected={previewProfile.id === styleProfileId}
          onClose={() => setPreviewProfileId(undefined)}
          onSelect={handleSelectStyleProfile}
        />
      )}
    </main>
  );
}
