import { Check, Layers3, Palette } from "lucide-react";

import { CONCEPT_PRESET_LABELS } from "../core/design/deck-concept";
import { STYLE_PROFILES } from "../core/design/style-profiles";
import { findThemePreset } from "../core/design/theme-presets";
import type { AppRuntime } from "./app-runtime";

export function StyleWorkspaceView({ app }: { app: AppRuntime }) {
  const { activeView, styleProfileId, handleSelectStyleProfile, changeActiveView } = app;
  if (activeView !== "style") return null;

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
                  aria-pressed={active}
                  onClick={() => handleSelectStyleProfile(profile.id)}
                >
                  <span
                    className={`style-specimen style-specimen-${profile.specimen.composition}`}
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
                  </span>
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
    </main>
  );
}
