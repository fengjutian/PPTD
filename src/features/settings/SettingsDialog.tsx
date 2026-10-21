import { KeyRound, Palette, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteMiniMaxKey, minimaxKeyConfigured, saveMiniMaxKey } from "../../services/minimax";
import { loadSettings, saveSettings, type AppSettings } from "../../services/settings";

export function SettingsDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (message: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void minimaxKeyConfigured().then(setConfigured).catch(() => setConfigured(false)); }, []);
  const save = async () => { setBusy(true); try { if (apiKey.trim()) await saveMiniMaxKey(apiKey); saveSettings(settings); onMessage("设置已保存"); onClose(); } catch (error) { onMessage(`设置保存失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); } };
  const removeKey = async () => { setBusy(true); try { await deleteMiniMaxKey(); setConfigured(false); onMessage("MiniMax Key 已删除"); } finally { setBusy(false); } };
  return <div className="settings-overlay" role="dialog" aria-modal="true"><div className="settings-panel"><header><div><Settings /><strong>设置</strong></div><button onClick={onClose} aria-label="关闭"><X /></button></header>
    <section><h3><KeyRound />MiniMax 模型</h3><label>模型名称<input value={settings.minimaxModel} onChange={(event) => setSettings({ ...settings, minimaxModel: event.target.value })} /></label><label>API Key <span className={configured ? "configured" : ""}>{configured ? "已安全配置" : "未配置"}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "留空则保持当前 Key" : "输入 MiniMax API Key"} /></label>{configured && <button className="remove-key" disabled={busy} onClick={removeKey}><Trash2 />删除已保存 Key</button>}<p>Key 保存在操作系统凭据库中，不进入项目、前端存储或日志。</p></section>
    <section><h3><Palette />应用主题</h3><div className="theme-options">{(["dark", "light", "system"] as const).map((theme) => <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => setSettings({ ...settings, theme })}>{theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}</button>)}</div></section>
    <footer><button onClick={onClose}>取消</button><button className="primary" disabled={busy || !settings.minimaxModel.trim()} onClick={save}>{busy ? "保存中…" : "保存设置"}</button></footer></div></div>;
}
