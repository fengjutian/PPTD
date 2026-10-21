import { Check, KeyRound, Palette, PlugZap, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteMiniMaxKey, MINIMAX_MODELS, minimaxKeyConfigured, saveMiniMaxKey, testMiniMaxConnection } from "../../services/minimax";
import { loadSettings, saveSettings, type AppSettings } from "../../services/settings";

export function SettingsWorkspace({ onMessage }: { onMessage: (message: string) => void }) {
  const [activeTab, setActiveTab] = useState<"model" | "appearance">("model");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<{ kind: "success" | "error"; message: string }>();
  useEffect(() => { void minimaxKeyConfigured().then(setConfigured).catch(() => setConfigured(false)); }, []);
  const save = async () => { setBusy(true); try { if (apiKey.trim()) await saveMiniMaxKey(apiKey); saveSettings(settings); setApiKey(""); setConfigured(configured || Boolean(apiKey.trim())); onMessage("设置已保存"); } catch (error) { onMessage(`设置保存失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); } };
  const removeKey = async () => { setBusy(true); try { await deleteMiniMaxKey(); setConfigured(false); onMessage("MiniMax Key 已删除"); } finally { setBusy(false); } };
  const testConnection = async () => {
    setBusy(true); setTestState(undefined);
    try {
      if (apiKey.trim()) { await saveMiniMaxKey(apiKey); setConfigured(true); }
      const message = await testMiniMaxConnection(settings.minimaxModel);
      setTestState({ kind: "success", message });
      onMessage(message);
    } catch (error) {
      const message = `连接失败：${error instanceof Error ? error.message : String(error)}`;
      setTestState({ kind: "error", message });
      onMessage(message);
    } finally { setBusy(false); }
  };
  return <div className="settings-page">
    <div className="settings-tabs" role="tablist" aria-label="设置分类"><button type="button" role="tab" aria-selected={activeTab === "model"} className={activeTab === "model" ? "active" : ""} onClick={() => setActiveTab("model")}><KeyRound />模型服务</button><button type="button" role="tab" aria-selected={activeTab === "appearance"} className={activeTab === "appearance" ? "active" : ""} onClick={() => setActiveTab("appearance")}><Palette />应用外观</button></div>
    {activeTab === "model" && <section className="settings-card" role="tabpanel"><div className="settings-section-heading"><KeyRound /><div><h2>MiniMax 模型</h2><p>使用 MiniMax 中国区开放平台生成结构化演示文稿草稿。</p></div></div><label>模型<select value={settings.minimaxModel} onChange={(event) => { setSettings({ ...settings, minimaxModel: event.target.value }); setTestState(undefined); }}>{MINIMAX_MODELS.map((model) => <option key={model} value={model}>{model}{model === "MiniMax-M3" ? "（最新旗舰）" : model.endsWith("highspeed") ? "（高速版）" : ""}</option>)}</select></label><label>国内 API 地址<input value="https://api.minimaxi.com/v1/text/chatcompletion_v2" readOnly /></label><label>API Key <span className={configured ? "configured" : ""}>{configured ? "已安全配置" : "未配置"}</span><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setTestState(undefined); }} placeholder={configured ? "留空则使用已保存的 Key" : "输入 MiniMax API Key"} /></label><p className="field-help">Key 保存在操作系统凭据库中，不进入项目文件或日志。测试会发送一条最小请求，可能产生少量 Token 消耗。</p><div className="model-actions"><button type="button" className="button-secondary" disabled={busy || (!configured && !apiKey.trim())} onClick={testConnection}><PlugZap />{busy ? "正在测试…" : "测试模型连通性"}</button>{configured && <button type="button" className="button-danger" disabled={busy} onClick={removeKey}><Trash2 />删除 API Key</button>}</div>{testState && <div className={`connection-result ${testState.kind}`}><span>{testState.kind === "success" ? <Check /> : "!"}</span>{testState.message}</div>}</section>}
    {activeTab === "appearance" && <section className="settings-card" role="tabpanel"><div className="settings-section-heading"><Palette /><div><h2>应用主题</h2><p>只调整 PPTD 界面外观，不影响 PPT 模板和演示文稿设计。</p></div></div><div className="theme-options">{(["dark", "light", "system"] as const).map((theme) => <button type="button" key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => setSettings({ ...settings, theme })}><i className={`theme-swatch ${theme}`} /><span>{theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}</span>{settings.theme === theme && <Check />}</button>)}</div></section>}
    <div className="settings-actions"><button type="button" className="primary-action" disabled={busy || !settings.minimaxModel.trim()} onClick={save}>{busy ? "保存中…" : "保存设置"}<Check /></button></div>
  </div>;
}
