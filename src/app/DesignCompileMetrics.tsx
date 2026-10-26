import { RECIPE_CATALOG } from "../core/layout/recipes/catalog";
import type { RecipeId } from "../core/design/deck-concept";
import type {
  DesignCompileOutcome,
} from "../core/layout/design-compiler";
import type { DesignMetrics } from "../core/design/design-metrics";

const OUTCOME_LABELS: Record<DesignCompileOutcome, string> = {
  accepted: "采用",
  "accepted-with-adjustments": "调整",
  rejected: "拒绝",
};

function recipeLabel(recipe: RecipeId | undefined): string {
  if (recipe === undefined) return "未选定";
  return RECIPE_CATALOG[recipe]?.label ?? recipe;
}

function decisionFlow(decision: DesignMetrics["decisions"][number]): string {
  if (decision.requestedRecipe === undefined) {
    return decision.selectedRecipe === undefined ? "自动 → 未选定" : `自动 → ${recipeLabel(decision.selectedRecipe)}`;
  }
  if (decision.selectedRecipe === undefined) return `${recipeLabel(decision.requestedRecipe)} → 未选定`;
  if (!decision.substituted) return recipeLabel(decision.selectedRecipe);
  return `${recipeLabel(decision.requestedRecipe)} → ${recipeLabel(decision.selectedRecipe)}`;
}

/**
 * The design run's numbers, next to the diagnostics they explain.
 *
 * The component is presentational on purpose: it receives a summary that only
 * contains counts, recipe ids and diagnostic codes, so the report can be shown
 * and copied without exposing the deck's copy. It never reads the document or
 * the compiler, and therefore cannot change either.
 */
export function DesignCompileMetrics({
  metrics,
  promptVersion,
}: {
  metrics: DesignMetrics;
  promptVersion?: string;
}) {
  return (
    <section className="design-compile-metrics" aria-label="设计编译度量">
      <div className="design-compile-metrics-row">
        <span>
          <b>{metrics.plannedSlides}</b>/{metrics.totalSlides} 页按计划编译
        </span>
        <span>采用 {metrics.accepted}</span>
        <span>调整 {metrics.adjusted}</span>
        <span className={metrics.rejected > 0 ? "is-warning" : undefined}>拒绝 {metrics.rejected}</span>
        {metrics.substituted > 0 && <span>换配方 {metrics.substituted}</span>}
        {promptVersion && <span className="is-muted">提示词 {promptVersion}</span>}
      </div>
      {metrics.recipes.length > 0 && (
        <p className="design-compile-metrics-recipes">
          配方：
          {metrics.recipes.map((usage) => `${recipeLabel(usage.recipe)}×${usage.pages}`).join(" · ")}
        </p>
      )}
      {metrics.diagnostics.length > 0 && (
        <p className="design-compile-metrics-diagnostics">
          诊断：
          {metrics.diagnostics
            .slice(0, 6)
            .map((diagnostic) => `${diagnostic.code}×${diagnostic.pages}`)
            .join(" · ")}
          {metrics.diagnostics.length > 6 ? ` · 另有 ${metrics.diagnostics.length - 6} 类` : ""}
        </p>
      )}
      {metrics.decisions.length > 0 && (
        <details className="design-compile-decisions">
          <summary>每页配方决策（{metrics.decisions.length} 页）</summary>
          <ul>
            {metrics.decisions.map((decision) => (
              <li key={decision.slideIndex}>
                <span>第 {decision.slideIndex + 1} 页</span>
                <span>{decisionFlow(decision)}</span>
                <span
                  className={
                    decision.outcome === "rejected"
                      ? "is-error"
                      : decision.outcome === "accepted-with-adjustments"
                        ? "is-warning"
                        : undefined
                  }
                >
                  {OUTCOME_LABELS[decision.outcome]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
