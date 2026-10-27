import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Image as ImageIcon,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";

import { buildDesignAudit } from "../core/design/design-audit";
import { RECIPE_SPECIMENS, type RecipeSpecimenMode } from "../core/design/recipe-specimens";
import { RECIPE_CATALOG } from "../core/layout/recipes/catalog";
import type { PresentationQualityIssueKind } from "../services/presentation-quality-gate";
import { loadDesignCandidateUsage } from "../services/design-candidate-usage";
import type { AppRuntime } from "./app-runtime";

type QualityTab = "overview" | "issues" | "templates" | "audit" | "specimens";

const tabs: Array<{ id: QualityTab; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "issues", label: "页面问题" },
  { id: "templates", label: "模板能力" },
  { id: "audit", label: "设计审计" },
  { id: "specimens", label: "样张基线" },
];

const issueLabels: Record<PresentationQualityIssueKind, string> = {
  "out-of-bounds": "元素超出页面",
  "text-overlap": "文本相互重叠",
  "obstacle-overlap": "文本遮挡关键对象",
  "low-contrast": "文字对比度不足",
  "text-overflow": "文字可能溢出",
  "underfilled-columns": "分栏内容过少",
  "underfilled-page": "页面内容过少",
};

const specimenModeLabels: Record<RecipeSpecimenMode, string> = {
  light: "浅色",
  dark: "深色",
  capacity: "最大容量",
  template: "模板兼容",
};

const componentLabels: Record<string, string> = {
  text: "文本",
  image: "图片",
  shape: "形状",
  line: "线条",
  icon: "图标",
  table: "表格",
  chart: "图表",
  group: "组合",
};

function recipeLabel(recipe: string): string {
  return RECIPE_CATALOG[recipe as keyof typeof RECIPE_CATALOG]?.label ?? recipe;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="quality-empty">
      <FileSearch />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function QualityWorkspaceView({ app }: { app: AppRuntime }) {
  const { activeView, document, designQualityReport, exportReport } = app;
  const [tab, setTab] = useState<QualityTab>("overview");
  const audit = useMemo(() => buildDesignAudit(document), [document]);
  const issues = designQualityReport?.issues ?? [];
  const templateFit = designQualityReport?.templateFit ?? exportReport?.templateFit;
  const visualCoverage = designQualityReport?.visualReviewCoverage;
  const hasReview = Boolean(designQualityReport);
  const reviewStatus = !hasReview ? "尚未检查" : issues.length > 0 ? "需要处理" : "未发现阻断问题";
  const specimenGroups = useMemo(
    () =>
      Object.values(RECIPE_CATALOG).map((recipe) => ({
        recipe,
        specimens: RECIPE_SPECIMENS.filter((specimen) => specimen.recipeId === recipe.id),
      })),
    [],
  );
  // Local, cross-deck counters from the session-only “换一版” prototype. They
  // contain no copy, so the quality view can show them without exposing a deck.
  const candidateUsage = loadDesignCandidateUsage();
  const topCandidateRecipes = Object.entries(candidateUsage.recipes)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3);

  if (activeView !== "quality") return null;

  return (
    <main className="feature-workspace quality-workspace">
      <header className="feature-header">
        <div>
          <ShieldCheck />
          <div>
            <h1>设计质检</h1>
            <p>集中查看页面质量、模板能力、PPTX 可编辑性与视觉回归基线</p>
          </div>
        </div>
        <div className={`quality-status ${issues.length > 0 ? "warning" : hasReview ? "passed" : "idle"}`}>
          {issues.length > 0 ? <AlertTriangle /> : hasReview ? <CheckCircle2 /> : <ClipboardCheck />}
          <span>{reviewStatus}</span>
        </div>
      </header>

      <div className="quality-tabs" role="tablist" aria-label="质检报告分类">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === "issues" && issues.length > 0 && <span>{issues.length}</span>}
          </button>
        ))}
      </div>

      <div className="feature-scroll quality-scroll">
        {tab === "overview" && (
          <div className="quality-panel-stack">
            <section className="quality-metrics" aria-label="质检摘要">
              <article>
                <small>页面</small>
                <strong>{document.slides.length}</strong>
                <span>当前文稿</span>
              </article>
              <article className={issues.length > 0 ? "metric-warning" : ""}>
                <small>确定性问题</small>
                <strong>{hasReview ? issues.length : "—"}</strong>
                <span>{hasReview ? reviewStatus : "生成或复检后统计"}</span>
              </article>
              <article>
                <small>模板适配</small>
                <strong>{templateFit?.checked ? `${Math.round(templateFit.score)}%` : "—"}</strong>
                <span>{templateFit?.checked ? (templateFit.passed ? "达到阈值" : "未达到阈值") : "暂无模板测量"}</span>
              </article>
              <article>
                <small>原生可编辑对象</small>
                <strong>{exportReport?.nativeObjectCount ?? "—"}</strong>
                <span>{exportReport ? `最近导出 · ${exportReport.slideCount} 页` : "导出后提供实测"}</span>
              </article>
            </section>

            <section className="quality-card quality-overview-grid">
              <div>
                <h2>检查覆盖</h2>
                <dl>
                  <div>
                    <dt>确定性布局检查</dt>
                    <dd>{hasReview ? "已运行" : "未运行"}</dd>
                  </div>
                  <div>
                    <dt>视觉评审</dt>
                    <dd>{visualCoverage ? `${visualCoverage.reviewed} / ${visualCoverage.total} 页` : "无结果"}</dd>
                  </div>
                  <div>
                    <dt>模板兼容</dt>
                    <dd>{templateFit?.checked ? `${templateFit.checkedSlides} 页已测量` : "无结果"}</dd>
                  </div>
                  <div>
                    <dt>PPTX 包校验</dt>
                    <dd>{exportReport ? "最近导出已记录" : "尚未导出"}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h2>跨页节奏</h2>
                <dl>
                  <div>
                    <dt>不同版式</dt>
                    <dd>{audit.rhythm.uniqueLayouts}</dd>
                  </div>
                  <div>
                    <dt>最长连续重复</dt>
                    <dd>{audit.rhythm.longestRepeat} 页</dd>
                  </div>
                  <div>
                    <dt>三页以上重复段</dt>
                    <dd>{audit.rhythm.repeatedRuns}</dd>
                  </div>
                  <div>
                    <dt>已登记样张</dt>
                    <dd>{RECIPE_SPECIMENS.length} 项</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="quality-card quality-overview-grid" aria-label="换一版使用">
              <div>
                <h2>换一版使用（本机）</h2>
                <dl>
                  <div>
                    <dt>打开</dt>
                    <dd>{candidateUsage.opened} 次</dd>
                  </div>
                  <div>
                    <dt>采用</dt>
                    <dd>{candidateUsage.picked} 次</dd>
                  </div>
                  <div>
                    <dt>打开后取消</dt>
                    <dd>{candidateUsage.abandoned} 次</dd>
                  </div>
                  <div>
                    <dt>无快照 / 已编辑 / 无 plan</dt>
                    <dd>
                      {candidateUsage.noContext} / {candidateUsage.edited} / {candidateUsage.noPlan}
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <h2>最常采用的构图</h2>
                {topCandidateRecipes.length === 0 ? (
                  <p className="quality-muted">还没有采用记录。生成后点“换一版”才会累计。</p>
                ) : (
                  <dl>
                    {topCandidateRecipes.map(([recipe, count]) => (
                      <div key={recipe}>
                        <dt>{recipeLabel(recipe)}</dt>
                        <dd>{count} 次</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "issues" &&
          (hasReview ? (
            issues.length > 0 ? (
              <section className="quality-issue-list">
                {issues.map((issue, index) => (
                  <article key={`${issue.slideIndex}-${issue.issue}-${index}`}>
                    <span className="quality-page-badge">第 {issue.slideIndex + 1} 页</span>
                    <div>
                      <strong>{issueLabels[issue.issue]}</strong>
                      <p>{issue.message}</p>
                      {issue.elementIds.length > 0 && <small>涉及 {issue.elementIds.length} 个对象</small>}
                    </div>
                  </article>
                ))}
              </section>
            ) : (
              <EmptyState title="未发现确定性问题" description="当前报告没有越界、重叠、溢出或对比度问题。" />
            )
          ) : (
            <EmptyState title="尚无质检报告" description="完成一次 AI 设计或手动视觉复检后，这里会按页列出问题。" />
          ))}

        {tab === "templates" &&
          (audit.layouts.length > 0 ? (
            <section className="quality-layout-grid">
              {audit.layouts.map((layout) => (
                <article key={layout.name}>
                  <div className="quality-card-heading">
                    <LayoutTemplate />
                    <div>
                      <strong>{layout.name}</strong>
                      <span>{layout.usedBySlides} 页使用</span>
                    </div>
                  </div>
                  {layout.capabilities ? (
                    <div className="quality-capability-list">
                      <span className={layout.capabilities.hasTitle ? "supported" : "unsupported"}>标题</span>
                      <span className={layout.capabilities.hasBody ? "supported" : "unsupported"}>正文</span>
                      <span className={layout.capabilities.hasImage ? "supported" : "unsupported"}>图片</span>
                      <span className="supported">{layout.capabilities.columns} 栏</span>
                      {layout.capabilities.free && <span className="neutral">自由构图</span>}
                    </div>
                  ) : (
                    <p className="quality-muted">旧版式尚未记录能力清单</p>
                  )}
                </article>
              ))}
            </section>
          ) : (
            <EmptyState
              title="当前文稿没有模板版式"
              description="导入或选择带版式的模板后，这里会展示标题、正文、图片和分栏能力。"
            />
          ))}

        {tab === "audit" && (
          <div className="quality-panel-stack">
            <section className="quality-card">
              <h2>
                <Boxes />
                组件清单
              </h2>
              <div className="quality-component-grid">
                {Object.entries(audit.components).map(([name, count]) => (
                  <div key={name}>
                    <span>{componentLabels[name] ?? name}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="quality-card quality-audit-grid">
              <div>
                <h2>版本追踪</h2>
                <dl>
                  <div>
                    <dt>Schema</dt>
                    <dd>v{audit.versions.schema}</dd>
                  </div>
                  <div>
                    <dt>配方目录</dt>
                    <dd>v{audit.versions.recipeCatalog}</dd>
                  </div>
                  <div>
                    <dt>样张矩阵</dt>
                    <dd>v{audit.versions.specimenMatrix}</dd>
                  </div>
                  <div>
                    <dt>主题</dt>
                    <dd>{audit.versions.theme ?? "未命名"}</dd>
                  </div>
                  <div>
                    <dt>模板</dt>
                    <dd>{audit.versions.template ?? "未使用"}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h2>导出降级</h2>
                {exportReport ? (
                  exportReport.designAudit.degradations.length > 0 ? (
                    <ul>
                      {exportReport.designAudit.degradations.map((item) => (
                        <li key={item.code}>
                          {item.message} · {item.count}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="quality-muted">最近一次导出没有记录对象降级。</p>
                  )
                ) : (
                  <p className="quality-muted">尚未导出，无法提供 PPTX 原生写入与降级实测。</p>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "specimens" && (
          <div className="quality-panel-stack">
            <section className="quality-callout">
              <ImageIcon />
              <div>
                <strong>{RECIPE_SPECIMENS.length} 个样张用例已登记</strong>
                <p>矩阵已覆盖浅色、深色、最大内容量和模板兼容；视觉快照与 PPTX 原生可编辑性结果仍需由回归任务生成。</p>
              </div>
              <span>待生成基线</span>
            </section>
            <section className="quality-specimen-grid">
              {specimenGroups.map(({ recipe, specimens }) => (
                <article key={recipe.id}>
                  <div>
                    <strong>{recipe.label}</strong>
                    <small>{recipe.id}</small>
                  </div>
                  <p>{recipe.summary}</p>
                  <div className="quality-specimen-modes">
                    {specimens.map((specimen) => (
                      <span key={specimen.id}>{specimenModeLabels[specimen.mode]}</span>
                    ))}
                  </div>
                  <footer>
                    {recipe.requiresImage ? "需要图片" : "无需图片"} · 至少 {recipe.minimumColumns} 栏 · 原生可编辑
                  </footer>
                </article>
              ))}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
