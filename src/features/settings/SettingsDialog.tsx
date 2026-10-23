import { Check, KeyRound, Palette, PlugZap, Trash2, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_PROVIDERS, findAiProvider } from "../../services/ai-providers";
import { aiKeyConfigured, deleteAiKey, saveAiKey, testAiConnection } from "../../services/ai-service";
import {
  defaultSettings,
  loadSettings,
  probeUiFont,
  saveSettings,
  UI_FONT_OPTIONS,
  type AppSettings,
  type AppTheme,
} from "../../services/settings";

const THEME_OPTIONS: { id: AppTheme; label: string }[] = [
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
  { id: "amber", label: "橙黄" },
  { id: "green", label: "绿色" },
  { id: "blue", label: "蓝色" },
  { id: "system", label: "跟随系统" },
];

export function SettingsWorkspace({ onMessage }: { onMessage: (message: string) => void }) {
  const [activeTab, setActiveTab] = useState<"model" | "appearance" | "font">("model");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<{ kind: "success" | "error"; message: string }>();
  const [installedFonts, setInstalledFonts] = useState<Record<string, boolean>>({});
  const provider = findAiProvider(settings.aiProviderId);
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
    const detected: Record<string, boolean> = {};
    for (const option of UI_FONT_OPTIONS) detected[option.id] = probeUiFont(option);
    setInstalledFonts(detected);
  }, []);
  useEffect(() => {
    void aiKeyConfigured(settings.aiProviderId)
      .then(setConfigured)
      .catch(() => setConfigured(false));
  }, [settings.aiProviderId]);
  const save = async () => {
    setBusy(true);
    try {
      if (apiKey.trim()) await saveAiKey(settings.aiProviderId, apiKey);
      await saveSettings(settings);
      setApiKey("");
      setConfigured(configured || Boolean(apiKey.trim()));
      onMessage("设置已保存");
    } catch (error) {
      const detail =
        error instanceof Error && error.message === "DESKTOP_RUNTIME_REQUIRED"
          ? "浏览器预览模式不保存设置，请使用桌面端"
          : error instanceof Error
            ? error.message
            : String(error);
      onMessage(`设置保存失败：${detail}`);
    } finally {
      setBusy(false);
    }
  };
  const removeKey = async () => {
    setBusy(true);
    try {
      await deleteAiKey(settings.aiProviderId);
      setConfigured(false);
      onMessage(`${provider.label} API Key 已删除`);
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
        setConfigured(true);
      }
      const message = await testAiConnection(settings.aiProviderId, settings.aiModel);
      setTestState({ kind: "success", message });
      onMessage(message);
    } catch (error) {
      const message = `连接失败：${error instanceof Error ? error.message : String(error)}`;
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
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "model"}
          className={activeTab === "model" ? "active" : ""}
          onClick={() => setActiveTab("model")}
        >
          <KeyRound />
          模型服务
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "appearance"}
          className={activeTab === "appearance" ? "active" : ""}
          onClick={() => setActiveTab("appearance")}
        >
          <Palette />
          应用外观
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "font"}
          className={activeTab === "font" ? "active" : ""}
          onClick={() => setActiveTab("font")}
        >
          <Type />
          字体
        </button>
      </div>
      {activeTab === "model" && (
        <section className="settings-card" role="tabpanel">
          <div className="settings-section-heading">
            <KeyRound />
            <div>
              <h2>AI 模型服务</h2>
              <p>选择生成结构化演示文稿内容所用的厂商与模型。</p>
            </div>
          </div>
          <label>
            服务商
            <select value={settings.aiProviderId} onChange={(event) => selectProvider(event.target.value)}>
              {AI_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            模型
            <select
              value={settings.aiModel}
              onChange={(event) => {
                setSettings({ ...settings, aiModel: event.target.value });
                setTestState(undefined);
              }}
            >
              {provider.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                  {provider.modelNotes[model] ? `（${provider.modelNotes[model]}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.visionReviewEnabled}
              onChange={(event) => setSettings({ ...settings, visionReviewEnabled: event.target.checked })}
            />
            <span>
              <strong>允许视觉评审</strong>
              <em>
                生成时把页面渲染图发送给当前模型服务检查排版。关闭后不再上传任何渲染图，只做确定性排版校验，视觉评分与建议将不可用。
              </em>
            </span>
          </label>
          <label>
            API 地址
            <input value={provider.baseUrl} readOnly />
          </label>
          <label>
            API Key <span className={configured ? "configured" : ""}>{configured ? "已安全配置" : "未配置"}</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setTestState(undefined);
              }}
              placeholder={configured ? "留空则使用已保存的 Key" : `输入 ${provider.label} API Key`}
            />
          </label>
          <p className="field-help">
            Key 保存在操作系统凭据库中，不进入项目文件或日志。测试会发送一条最小请求，可能产生少量 Token 消耗。
          </p>
          <div className="model-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={busy || (!configured && !apiKey.trim())}
              onClick={testConnection}
            >
              <PlugZap />
              {busy ? "正在测试…" : "测试模型连通性"}
            </button>
            {configured && (
              <button type="button" className="button-danger" disabled={busy} onClick={removeKey}>
                <Trash2 />
                删除 API Key
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
              <h2>应用主题</h2>
              <p>只调整 PPTD 界面外观，不影响 PPT 模板和演示文稿设计。</p>
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
                <span>{option.label}</span>
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
              <h2>界面字体</h2>
              <p>只调整 PPTD 界面的排版字体，不影响 PPT 模板与导出文稿里的字体。</p>
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
                    <strong>{option.label}</strong>
                    {installed === false && <em className="font-badge missing">未安装</em>}
                    {settings.uiFont === option.id && <Check />}
                  </span>
                  <span className="font-sample" style={{ fontFamily: option.stack }}>
                    思源宋体示例 ABC 0123
                  </span>
                  <span className="font-note">{option.note}</span>
                </button>
              );
            })}
          </div>
          <p className="field-help">
            PPTD 不内置字体文件。选择未安装的字体时会自动回退到系统同类字体；如需使用思源宋体，请先在操作系统中安装
            Source Han Serif。
          </p>
        </section>
      )}
      <div className="settings-actions">
        <button type="button" className="primary-action" disabled={busy || !settings.aiModel.trim()} onClick={save}>
          {busy ? "保存中…" : "保存设置"}
          <Check />
        </button>
      </div>
    </div>
  );
}
