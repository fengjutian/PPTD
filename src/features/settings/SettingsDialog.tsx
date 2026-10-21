import { Check, KeyRound, Palette, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteMiniMaxKey, minimaxKeyConfigured, saveMiniMaxKey } from "../../services/minimax";
import { loadSettings, saveSettings, type AppSettings } from "../../services/settings";

export function SettingsWorkspace({ onMessage }: { onMessage: (message: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void minimaxKeyConfigured().then(setConfigured).catch(() => setConfigured(false)); }, []);
  const save = async () => { setBusy(true); try { if (apiKey.trim()) await saveMiniMaxKey(apiKey); saveSettings(settings); setApiKey(""); setConfigured(configured || Boolean(apiKey.trim())); onMessage("设置已保存"); } catch (error) { onMessage(`设置保存失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); } };
  const removeKey = async () => { setBusy(true); try { await deleteMiniMaxKey(); setConfigured(false); onMessage("MiniMax Key 已删除"); } finally { setBusy(false); } };
  return <div className="settings-page">
    <section className="settings-card"><div className="settings-section-heading"><KeyRound /><div><h2>MiniMax 模型</h2><p>配置用于生成结构化演示文稿草稿的模型服务。</p></div></div><label>模型名称<input value={settings.minimaxModel} onChange={(event) => setSettings({ ...settings, minimaxModel: event.target.value })} /></label><label>API Key <span className={configured ? "configured" : ""}>{configured ? "已安全配置" : "未配置"}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "留空则保持当前 Key" : "输入 MiniMax API Key"} /></label><p className="field-help">Key 保存在操作系统凭据库中，不进入项目、前端存储或日志。</p>{configured && <button type="button" className="button-danger" disabled={busy} onClick={removeKey}><Trash2 />删除 API Key</button>}</section>
    <section className="settings-card"><div className="settings-section-heading"><Palette /><div><h2>应用主题</h2><p>只调整 PPTD 界面外观，不影响 PPT 模板和演示文稿设计。</p></div></div><div className="theme-options">{(["dark", "light", "system"] as const).map((theme) => <button type="button" key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => setSettings({ ...settings, theme })}><i className={`theme-swatch ${theme}`} /><span>{theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}</span>{settings.theme === theme && <Check />}</button>)}</div></section>
    <div className="settings-actions"><button type="button" className="primary-action" disabled={busy || !settings.minimaxModel.trim()} onClick={save}>{busy ? "保存中…" : "保存设置"}<Check /></button></div>
  </div>;
}
