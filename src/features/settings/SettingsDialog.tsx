import { Check, KeyRound, Languages, Palette, PlugZap, ScrollText, Trash2, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LogViewer } from "../diagnostics/LogPanel";
import { AI_PROVIDERS, findAiProvider } from "../../services/ai-providers";
import { CONCEPT_PRESET_LABELS, type ConceptPresetId } from "../../core/design/deck-concept";
import { aiKeyConfigured, deleteAiKey, saveAiKey, testAiConnection } from "../../services/ai-service";
import type { AppLogRecord } from "../../services/app-log";
import {
  clearDesignMemory,
  designMemorySummary,
  loadDesignPreferences,
  loadRecentLooks,
  removeDesignMemory,
  type DesignLook,
  type DesignMemorySummary,
  type DesignPreference,
} from "../../services/design-memory";
import { clearVisionCapabilityCache } from "../../services/ai-vision";
import {
  createTranslator,
  translate,
  UI_LANGUAGE_OPTIONS,
  type UiLanguage,
  type UiMessageKey,
} from "../../services/i18n";
import {
  defaultSettings,
  loadSettings,
  probeUiFont,
  saveSettings,
  UI_FONT_OPTIONS,
  type AppSettings,
  type AppTheme,
  type AppUiFont,
} from "../../services/settings";

const THEME_OPTIONS: ReadonlyArray<{ id: AppTheme; labelKey: UiMessageKey }> = [
  { id: "dark", labelKey: "settings.theme.dark" },
  { id: "light", labelKey: "settings.theme.light" },
  { id: "amber", labelKey: "settings.theme.amber" },
  { id: "green", labelKey: "settings.theme.green" },
  { id: "blue", labelKey: "settings.theme.blue" },
  { id: "system", labelKey: "settings.theme.system" },
];

const FONT_LABEL_KEYS: Record<AppUiFont, UiMessageKey> = {
  sans: "settings.font.sans.label",
  song: "settings.font.song.label",
  hei: "settings.font.hei.label",
  mono: "settings.font.mono.label",
};

const FONT_NOTE_KEYS: Record<AppUiFont, UiMessageKey> = {
  sans: "settings.font.sans.note",
  song: "settings.font.song.note",
  hei: "settings.font.hei.note",
  mono: "settings.font.mono.note",
};

export interface SettingsWorkspaceProps {
  language: UiLanguage;
  onLanguageChange: (language: UiLanguage) => void;
  onMessage: (message: string) => void;
  logRecords?: AppLogRecord[];
  logLoading?: boolean;
  logLocation?: string;
  onLogRefresh?: () => void;
}

export interface DesignMemoryDetailsProps {
  language: UiLanguage;
  looks: DesignLook[];
  preferences: DesignPreference[];
  onRemove: (id: string) => void;
}

/**
 * The readable, deletable view of what design memory actually stores.
 *
 * Kept as a pure component so a static render can assert the fonts, palette,
 * scope badge and delete affordance without a desktop database.
 */
export function DesignMemoryDetails({ language, looks, preferences, onRemove }: DesignMemoryDetailsProps) {
  const t = useMemo(() => createTranslator(language), [language]);
  if (looks.length === 0 && preferences.length === 0) return null;
  return (
    <details className="settings-memory-details">
      <summary>{t("settings.memory.details")}</summary>
      {looks.length > 0 && (
        <>
          <h4>{t("settings.memory.looks")}</h4>
          <ul>
            {looks.map((look) => (
              <li key={look.id}>
                <div className="settings-memory-look">
                  <span>
                    {CONCEPT_PRESET_LABELS[look.concept as ConceptPresetId] ?? look.concept} · {look.pageCount} 页 ·{" "}
                    {new Date(look.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <small>
                    {look.fonts.major || "未记录字体"} / {look.fonts.minor || "未记录字体"}
                  </small>
                  {look.palette.length > 0 && (
                    <span className="settings-memory-swatches">
                      {look.palette.slice(0, 6).map((color) => (
                        <i key={color} style={{ background: color }} title={color} />
                      ))}
                    </span>
                  )}
                </div>
                <button type="button" aria-label={t("settings.memory.remove")} onClick={() => onRemove(look.id)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {preferences.length > 0 && (
        <>
          <h4>{t("settings.memory.preferences")}</h4>
          <ul>
            {preferences.map((preference) => (
              <li key={preference.id}>
                <span>
                  “{preference.text}” <small className="settings-memory-scope">{preference.scope}</small>
                </span>
                <button type="button" aria-label={t("settings.memory.remove")} onClick={() => onRemove(preference.id)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

export interface DiagnosticsLogProps {
  language: UiLanguage;
  /** 日志文件的绝对路径；读取失败或浏览器预览时为 undefined。 */
  path?: string;
}

/**
 * 诊断日志的位置。
 *
 * 失败提示只在状态栏停留几秒。用户回头说"生成报错了"时，既没有错误码也
 * 没有失败阶段。把文件位置放在设置里，下一次可以直接取文件，而不是靠回忆。
 */
export function DiagnosticsLog({ language, path }: DiagnosticsLogProps) {
  const t = useMemo(() => createTranslator(language), [language]);
  return (
    <div className="settings-diagnostics">
      <h3>{t("settings.diagnostics.title")}</h3>
      <p>{t("settings.diagnostics.help")}</p>
      <code className="settings-diagnostics-path">{path ?? t("settings.diagnostics.unavailable")}</code>
    </div>
  );
}

export function SettingsWorkspace({
  language,
  onLanguageChange,
  onMessage,
  logRecords = [],
  logLoading = false,
  logLocation,
  onLogRefresh = () => undefined,
}: SettingsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"model" | "appearance" | "font" | "language" | "log">("model");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<{ kind: "success" | "error"; message: string }>();
  const [installedFonts, setInstalledFonts] = useState<Record<string, boolean>>({});
  const [memory, setMemory] = useState<DesignMemorySummary>();
  const [memoryDetails, setMemoryDetails] = useState<{ looks: DesignLook[]; preferences: DesignPreference[] }>({
    looks: [],
    preferences: [],
  });
  const provider = findAiProvider(settings.aiProviderId);
  const t = useMemo(() => createTranslator(language), [language]);
  const providerLabel = language === "en" ? (provider.labelEn ?? provider.label) : provider.label;
  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((stored) => {
        if (active) setSettings(stored);
      })
      .catch(() => {
        if (active) setSettings(defaultSettings());
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([designMemorySummary(), loadRecentLooks(5), loadDesignPreferences(5)]).then(
      ([summary, looks, preferences]) => {
        if (!active) return;
        setMemory(summary);
        setMemoryDetails({ looks, preferences });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const detected: Record<string, boolean> = {};
    for (const option of UI_FONT_OPTIONS) detected[option.id] = probeUiFont(option);
    setInstalledFonts(detected);
  }, []);
  const refreshMemory = async () => {
    const [summary, looks, preferences] = await Promise.all([
      designMemorySummary(),
      loadRecentLooks(5),
      loadDesignPreferences(5),
    ]);
    setMemory(summary);
    setMemoryDetails({ looks, preferences });
  };
  useEffect(() => {
    void aiKeyConfigured(settings.aiProviderId)
      .then(setConfigured)
      .catch(() => setConfigured(false));
  }, [settings.aiProviderId]);
  const save = async () => {
    setBusy(true);
    try {
      if (apiKey.trim()) {
        await saveAiKey(settings.aiProviderId, apiKey);
        // A new key can belong to an account with different model access.
        clearVisionCapabilityCache();
      }
      await saveSettings(settings);
      setApiKey("");
      setConfigured(configured || Boolean(apiKey.trim()));
      onLanguageChange(settings.uiLanguage);
      // 保存成功后界面可能已经切到另一种语言，提示也要用新语言。
      onMessage(translate(settings.uiLanguage, "settings.message.saved"));
    } catch (error) {
      const detail =
        error instanceof Error && error.message === "DESKTOP_RUNTIME_REQUIRED"
          ? t("settings.message.browserPreview")
          : error instanceof Error
            ? error.message
            : String(error);
      onMessage(t("settings.message.saveFailed", { detail }));
    } finally {
      setBusy(false);
    }
  };
  const removeKey = async () => {
    setBusy(true);
    try {
      await deleteAiKey(settings.aiProviderId);
      clearVisionCapabilityCache();
      setConfigured(false);
      onMessage(t("settings.message.keyDeleted", { provider: providerLabel }));
    } finally {
      setBusy(false);
    }
  };
  const testConnection = async () => {
    setBusy(true);
    setTestState(undefined);
    try {
      if (apiKey.trim()) {
        await saveAiKey(settings.aiProviderId, apiKey);
        clearVisionCapabilityCache();
        setConfigured(true);
      }
      const message = await testAiConnection(settings.aiProviderId, settings.aiModel);
      setTestState({ kind: "success", message });
      onMessage(message);
    } catch (error) {
      const message = t("settings.model.testFailed", {
        detail: error instanceof Error ? error.message : String(error),
      });
      setTestState({ kind: "error", message });
      onMessage(message);
    } finally {
      setBusy(false);
    }
  };
  const selectProvider = (providerId: string) => {
    const next = findAiProvider(providerId);
    setSettings({ ...settings, aiProviderId: next.id, aiModel: next.defaultModel });
    setApiKey("");
    setTestState(undefined);
  };
  return (
    <div className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label={t("settings.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "model"}
          className={activeTab === "model" ? "active" : ""}
          onClick={() => setActiveTab("model")}
        >
          <KeyRound />
          {t("settings.tabs.model")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "appearance"}
          className={activeTab === "appearance" ? "active" : ""}
          onClick={() => setActiveTab("appearance")}
        >
          <Palette />
          {t("settings.tabs.appearance")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "font"}
          className={activeTab === "font" ? "active" : ""}
          onClick={() => setActiveTab("font")}
        >
          <Type />
          {t("settings.tabs.font")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "language"}
          className={activeTab === "language" ? "active" : ""}
          onClick={() => setActiveTab("language")}
        >
          <Languages />
          {t("settings.tabs.language")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "log"}
          className={activeTab === "log" ? "active" : ""}
          onClick={() => {
            setActiveTab("log");
            onLogRefresh();
          }}
        >
          <ScrollText />
          {t("settings.tabs.log")}
        </button>
      </div>
      {activeTab === "model" && (
        <section className="settings-card" role="tabpanel">
          <div className="settings-section-heading">
            <KeyRound />
            <div>
              <h2>{t("settings.model.title")}</h2>
              <p>{t("settings.model.description")}</p>
            </div>
          </div>
          <label>
            {t("settings.model.provider")}
            <select value={settings.aiProviderId} onChange={(event) => selectProvider(event.target.value)}>
              {AI_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {language === "en" ? (item.labelEn ?? item.label) : item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.model.model")}
            <select
              value={settings.aiModel}
              onChange={(event) => {
                setSettings({ ...settings, aiModel: event.target.value });
                setTestState(undefined);
              }}
            >
              {provider.models.map((model) => {
                const note =
                  language === "en"
                    ? (provider.modelNotesEn?.[model] ?? provider.modelNotes[model])
                    : provider.modelNotes[model];
                return (
                  <option key={model} value={model}>
                    {model}
                    {note ? (language === "en" ? ` (${note})` : `（${note}）`) : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.visionReviewEnabled}
              onChange={(event) => setSettings({ ...settings, visionReviewEnabled: event.target.checked })}
            />
            <span>
              <strong>{t("settings.model.visionReview")}</strong>
              <em>{t("settings.model.visionReviewHelp")}</em>
            </span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.designDirectionGate}
              onChange={(event) => setSettings({ ...settings, designDirectionGate: event.target.checked })}
            />
            <span>
              <strong>{t("settings.model.directionGate")}</strong>
              <em>{t("settings.model.directionGateHelp")}</em>
            </span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.designMemoryEnabled}
              onChange={(event) => setSettings({ ...settings, designMemoryEnabled: event.target.checked })}
            />
            <span>
              <strong>{t("settings.model.designMemory")}</strong>
              <em>{t("settings.model.designMemoryHelp")}</em>
            </span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.tasteLintEnabled}
              onChange={(event) => setSettings({ ...settings, tasteLintEnabled: event.target.checked })}
            />
            <span>
              <strong>{t("settings.model.tasteLint")}</strong>
              <em>{t("settings.model.tasteLintHelp")}</em>
            </span>
          </label>
          <div className="settings-memory">
            <span>
              {t("settings.memory.count", {
                decks: String(memory?.decks ?? 0),
                preferences: String(memory?.preferences ?? 0),
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                void clearDesignMemory().then(refreshMemory);
              }}
              disabled={!memory || (memory.decks === 0 && memory.preferences === 0)}
            >
              <Trash2 size={14} />
              {t("settings.memory.clear")}
            </button>
          </div>
          <DesignMemoryDetails
            language={language}
            looks={memoryDetails.looks}
            preferences={memoryDetails.preferences}
            onRemove={(id) => {
              void removeDesignMemory(id).then(refreshMemory);
            }}
          />
          <label>
            {t("settings.model.apiBaseUrl")}
            <input value={provider.baseUrl} readOnly />
          </label>
          <label>
            {t("settings.model.apiKey")}{" "}
            <span className={configured ? "configured" : ""}>
              {configured ? t("settings.model.configured") : t("settings.model.notConfigured")}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setTestState(undefined);
              }}
              placeholder={
                configured
                  ? t("settings.model.apiKeySavedPlaceholder")
                  : t("settings.model.apiKeyPlaceholder", { provider: providerLabel })
              }
            />
          </label>
          <p className="field-help">{t("settings.model.keyHelp")}</p>
          <div className="model-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={busy || (!configured && !apiKey.trim())}
              onClick={testConnection}
            >
              <PlugZap />
              {busy ? t("settings.model.testing") : t("settings.model.test")}
            </button>
            {configured && (
              <button type="button" className="button-danger" disabled={busy} onClick={removeKey}>
                <Trash2 />
                {t("settings.model.deleteKey")}
              </button>
            )}
          </div>
          {testState && (
            <div className={`connection-result ${testState.kind}`}>
              <span>{testState.kind === "success" ? <Check /> : "!"}</span>
              {testState.message}
            </div>
          )}
        </section>
      )}
      {activeTab === "appearance" && (
        <section className="settings-card" role="tabpanel">
          <div className="settings-section-heading">
            <Palette />
            <div>
              <h2>{t("settings.appearance.title")}</h2>
              <p>{t("settings.appearance.description")}</p>
            </div>
          </div>
          <div className="theme-options">
            {THEME_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={settings.theme === option.id ? "active" : ""}
                onClick={() => setSettings({ ...settings, theme: option.id })}
              >
                <i className={`theme-swatch ${option.id}`} />
                <span>{t(option.labelKey)}</span>
                {settings.theme === option.id && <Check />}
              </button>
            ))}
          </div>
        </section>
      )}
      {activeTab === "font" && (
        <section className="settings-card" role="tabpanel">
          <div className="settings-section-heading">
            <Type />
            <div>
              <h2>{t("settings.font.title")}</h2>
              <p>{t("settings.font.description")}</p>
            </div>
          </div>
          <div className="font-options">
            {UI_FONT_OPTIONS.map((option) => {
              const installed = installedFonts[option.id];
              return (
                <button
                  type="button"
                  key={option.id}
                  className={settings.uiFont === option.id ? "active" : ""}
                  onClick={() => setSettings({ ...settings, uiFont: option.id })}
                >
                  <span className="font-card-head">
                    <strong>{t(FONT_LABEL_KEYS[option.id])}</strong>
                    {installed === false && <em className="font-badge missing">{t("settings.font.missing")}</em>}
                    {settings.uiFont === option.id && <Check />}
                  </span>
                  <span className="font-sample" style={{ fontFamily: option.stack }}>
                    {t("settings.font.sample")}
                  </span>
                  <span className="font-note">{t(FONT_NOTE_KEYS[option.id])}</span>
                </button>
              );
            })}
          </div>
          <p className="field-help">{t("settings.font.help")}</p>
        </section>
      )}
      {activeTab === "language" && (
        <section className="settings-card" role="tabpanel">
          <div className="settings-section-heading">
            <Languages />
            <div>
              <h2>{t("settings.language.title")}</h2>
              <p>{t("settings.language.description")}</p>
            </div>
          </div>
          <div className="language-options" role="radiogroup" aria-label={t("settings.language.title")}>
            {UI_LANGUAGE_OPTIONS.map((option) => (
              <button
                type="button"
                role="radio"
                aria-checked={settings.uiLanguage === option.id}
                key={option.id}
                className={settings.uiLanguage === option.id ? "active" : ""}
                onClick={() => setSettings({ ...settings, uiLanguage: option.id })}
              >
                <span className="language-card-head">
                  <strong>{option.name}</strong>
                  {option.englishName !== option.name && <em className="language-card-native">{option.englishName}</em>}
                  {settings.uiLanguage === option.id && <Check />}
                </span>
                <span className="language-card-sample">{option.sample}</span>
                <span className="language-card-note">{t(option.noteKey)}</span>
              </button>
            ))}
          </div>
          <p className="field-help">{t("settings.language.help")}</p>
        </section>
      )}
      {activeTab === "log" && (
        <section className="settings-card settings-log-card" role="tabpanel">
          <div className="settings-section-heading">
            <ScrollText />
            <div>
              <h2>{t("diagnostics.panel.title")}</h2>
              <p>{t("diagnostics.panel.description")}</p>
            </div>
          </div>
          <LogViewer
            language={language}
            records={logRecords}
            loading={logLoading}
            location={logLocation}
            onRefresh={onLogRefresh}
          />
        </section>
      )}
      {activeTab !== "log" && (
        <div className="settings-actions">
          <button type="button" className="primary-action" disabled={busy || !settings.aiModel.trim()} onClick={save}>
            {busy ? t("settings.actions.saving") : t("settings.actions.save")}
            <Check />
          </button>
        </div>
      )}
    </div>
  );
}
