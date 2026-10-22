import { memo, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import type { AiVisualAssetRole } from "../../core/commands/visual-asset";

/**
 * AI 配图对话框。
 *
 * 手工编辑路径也能生成配图。AI 设计流程里的配图是模型决定"这一页配什么图"，
 * 这里是用户自己说"这一页要一张什么样的图"——同一套图片生成能力，两种入口。
 *
 * 它只发出一个意图（画面描述 + 角色），不碰几何：图片落在哪、多大，
 * 由命令层的排版规则算。用户要的图生成失败时对话框如实说明，不假装成功。
 */

/** 角色选项。顺序与视觉素材层一致。 */
const ROLE_OPTIONS: ReadonlyArray<{ role: AiVisualAssetRole; label: string; hint: string }> = [
  { role: "hero", label: "主视觉", hint: "右侧整块" },
  { role: "side", label: "侧栏图", hint: "右下角一块" },
  { role: "band", label: "通栏图", hint: "标题下一条" },
];

export interface AiImageDialogProps {
  /** 生成中。 */
  busy: boolean;
  /** 生成失败时的原因。 */
  error?: string;
  onClose: () => void;
  onGenerate: (prompt: string, role: AiVisualAssetRole) => void;
}

/**
 * 对话框本体。
 *
 * 单独拆出来是为了能脱离 Tauri 运行时测试：它不直接调用命令，
 * 只把用户的意图交出去。
 */
export function AiImageDialogView({ busy, error, onClose, onGenerate }: AiImageDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [role, setRole] = useState<AiVisualAssetRole>("side");
  const trimmed = prompt.trim();

  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog ai-image-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-image-title"
        aria-busy={busy}
      >
        <div className="upload-dialog-heading">
          <div>
            <Sparkles />
            <div>
              <h2 id="ai-image-title">AI 配图</h2>
              <p>描述画面内容，生成一张可以放进这一页的图片。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭 AI 配图窗口" onClick={onClose} disabled={busy}>
            <X />
          </button>
        </div>

        <label className="ai-image-field">
          <span className="ai-image-label">画面描述</span>
          <textarea
            className="ai-image-prompt"
            value={prompt}
            disabled={busy}
            placeholder="例如：一间明亮的现代化数据中心，几何线条构成的上升箭头"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <p className="ai-image-hint">描述画面本身，不要写标题或正文文字——生成的文字在演示里几乎总是错的。</p>

        <div className="ai-image-field">
          <span className="ai-image-label">图片位置</span>
          <div className="ai-image-roles">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.role}
                type="button"
                className={role === option.role ? "active" : ""}
                aria-pressed={role === option.role}
                disabled={busy}
                onClick={() => setRole(option.role)}
              >
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="ai-image-error" role="alert">
            {error}
          </p>
        )}

        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy || !trimmed}
            onClick={() => onGenerate(trimmed, role)}
          >
            {busy ? (
              <>
                <Loader2 className="spin" />
                生成中
              </>
            ) : (
              <>
                <ImagePlus />
                生成配图
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

export const AiImageDialog = memo(AiImageDialogView);
