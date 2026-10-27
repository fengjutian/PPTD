import { CircleAlert, Sparkles, X } from "lucide-react";

import type { DesignCandidateView } from "./app-shared";

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case "DESIGN_CANDIDATE_PLAN_REQUIRED":
      return "这一页没有语义设计计划，无法证明候选配方真的画了页面；请重新生成设计后再试。";
    case "DESIGN_CANDIDATE_PAGE_MISSING":
      return "当前页已经不在文稿里，请重新选择页面。";
    default:
      return "这一页暂时没有可换的构图；内容形状可能只匹配当前的配方。";
  }
}

/**
 * Three compiled takes on the same reviewed page.
 *
 * The cards are real one-page builds, not swatches: each was produced by the
 * same command path as the page in the deck, and the compiler already refused
 * any recipe that would drop content. Picking a card rebuilds the deck as one
 * design-only transaction; the dialog never edits the document itself.
 */
export function DesignCandidateDialog({
  view,
  onPick,
  onClose,
}: {
  view: DesignCandidateView;
  onPick: (recipe: DesignCandidateView["options"][number]["recipe"]) => void;
  onClose: () => void;
}) {
  return (
    <div className="upload-dialog-backdrop" role="presentation">
      <section
        className="upload-dialog design-candidate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-candidate-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Sparkles />
            <div>
              <h2 id="design-candidate-title">换一版 · 第 {view.slideIndex + 1} 页</h2>
              <p>同一份已审核内容，只换页面构图；选定后会重建整册，并作为一个可撤销的设计事务提交。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭换版" onClick={onClose}>
            <X />
          </button>
        </div>
        {view.options.length === 0 ? (
          <p className="design-candidate-empty">{reasonText(view.reason)}</p>
        ) : (
          <div className="design-candidate-grid">
            {view.options.map((option) => (
              <button
                key={option.recipe}
                type="button"
                className="design-candidate-card"
                onClick={() => onPick(option.recipe)}
              >
                {option.image ? (
                  <img src={option.image} alt={`${option.label} 预览`} />
                ) : (
                  <span className="design-candidate-placeholder">这一版没有渲染出预览</span>
                )}
                <span className="design-candidate-label">{option.label}</span>
                <span className={`design-candidate-issues ${option.auditCount > 0 ? "warning" : ""}`}>
                  {option.auditCount > 0 ? (
                    <>
                      <CircleAlert size={12} />
                      {option.auditCount} 处版面问题
                    </>
                  ) : option.tasteHardCount > 0 ? (
                    <>
                      <CircleAlert size={12} />
                      {option.tasteHardCount} 处字号/字阶告警
                    </>
                  ) : (
                    "无版面问题"
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {view.rejected > 0 && (
          <p className="design-candidate-note">
            另有 {view.rejected} 个配方被编译器拒绝、替换，或与当前页面几何相同，已从候选中移除。
          </p>
        )}
        {view.usage && view.usage.opened > 0 && (
          <p className="design-candidate-usage">
            本机累计：打开 {view.usage.opened} 次，采用 {view.usage.picked} 次。
          </p>
        )}
      </section>
    </div>
  );
}
