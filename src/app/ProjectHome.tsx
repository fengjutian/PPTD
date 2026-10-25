import { FilePlus2, FileUp, LayoutDashboard, Sparkles, Trash2 } from "lucide-react";
import type { AiHistoryEntry } from "../services/ai-history";
import type { RecentProjectEntry } from "../services/app-database";

type ProjectHomeItem =
  | { kind: "project"; timestamp: number; entry: RecentProjectEntry }
  | { kind: "ai"; timestamp: number; entry: AiHistoryEntry };

export function ProjectHome({
  items,
  designBusy,
  generatingHistoryId,
  designProgress,
  onOpenOrImport,
  onNew,
  onOpenAi,
  onRemoveAi,
  onOpenRecent,
  onRemoveRecent,
}: {
  items: ProjectHomeItem[];
  designBusy: boolean;
  generatingHistoryId?: string;
  designProgress: { percent: number; label: string };
  onOpenOrImport: () => void;
  onNew: () => void;
  onOpenAi: (entry: AiHistoryEntry) => void;
  onRemoveAi: (entry: AiHistoryEntry) => void;
  onOpenRecent: (entry: RecentProjectEntry) => void;
  onRemoveRecent: (entry: RecentProjectEntry) => void;
}) {
  return (
    <main className="feature-workspace project-home">
      <header className="feature-header project-home-header">
        <div>
          <LayoutDashboard />
          <div>
            <h1>我的演示文稿</h1>
            <p>继续编辑最近的项目，或创建一份新的演示文稿</p>
          </div>
        </div>
        <div className="project-home-actions">
          <button type="button" className="secondary-action" onClick={() => void onOpenOrImport()}>
            <FileUp />
            打开项目
          </button>
          <button type="button" className="primary-action" onClick={() => void onNew()}>
            <FilePlus2 />
            新建项目
          </button>
        </div>
      </header>
      <div className="feature-scroll project-home-scroll">
        {items.length === 0 ? (
          <section className="project-home-empty">
            <LayoutDashboard />
            <h2>还没有编辑过的演示文稿</h2>
            <p>保存、打开或使用 AI 生成文稿后，它们会以卡片形式显示在这里。</p>
            <button type="button" className="primary-action" onClick={() => void onNew()}>
              <FilePlus2 />
              创建第一份演示文稿
            </button>
          </section>
        ) : (
          <section className="project-gallery" aria-label="最近编辑的演示文稿">
            <div className="project-gallery-heading">
              <div>
                <h2>最近编辑</h2>
                <p>上一次编辑的项目已排在最前面</p>
              </div>
              <span>{items.length} 个项目</span>
            </div>
            <div className="project-card-grid">
              {items.map((item, index) => {
                if (item.kind === "ai") {
                  const entry = item.entry;
                  const isGenerating = designBusy && generatingHistoryId === entry.id;
                  return (
                    <article key={`ai:${entry.id}`} className={`project-card ai ${index === 0 ? "featured" : ""}`}>
                      <button
                        type="button"
                        className="project-card-open"
                        title={entry.topic}
                        disabled={designBusy && !entry.presentation}
                        onClick={() => void onOpenAi(entry)}
                      >
                        <span className="project-card-preview ai" aria-hidden="true">
                          <span className="project-card-preview-brand">
                            <Sparkles />
                            {entry.presentation ? "AI PPT" : isGenerating ? "生成中" : "待生成"}
                          </span>
                          <strong>{entry.draft.title}</strong>
                          <small>{entry.slideCount} 页演示文稿</small>
                        </span>
                        <span className="project-card-copy">
                          <span className="project-card-title-row">
                            <strong>{entry.draft.title}</strong>
                            <em>
                              {entry.presentation
                                ? index === 0
                                  ? "上次编辑"
                                  : "PPT"
                                : isGenerating
                                  ? `${designProgress.percent}%`
                                  : "待生成"}
                            </em>
                          </span>
                          <span>{entry.topic}</span>
                          <small>
                            {entry.slideCount} 页 · 最后编辑
                            {new Date(entry.updatedAt).toLocaleString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="project-card-remove"
                        aria-label={`删除 ${entry.draft.title}`}
                        title={
                          designBusy && generatingHistoryId === entry.id
                            ? "正在生成 PPT，完成后再删除"
                            : "删除草稿和已生成的 PPT"
                        }
                        disabled={designBusy && generatingHistoryId === entry.id}
                        onClick={() => onRemoveAi(entry)}
                      >
                        <Trash2 />
                      </button>
                    </article>
                  );
                }
                const entry = item.entry;
                return (
                  <article key={entry.path} className={`project-card ${index === 0 ? "featured" : ""}`}>
                    <button
                      type="button"
                      className="project-card-open"
                      disabled={entry.missing}
                      title={entry.path}
                      onClick={() => void onOpenRecent(entry)}
                    >
                      <span className="project-card-preview" aria-hidden="true">
                        <span>{entry.title.slice(0, 1).toUpperCase()}</span>
                      </span>
                      <span className="project-card-copy">
                        <span className="project-card-title-row">
                          <strong>{entry.title}</strong>
                          {index === 0 && !entry.missing && <em>上次编辑</em>}
                        </span>
                        <span>{entry.missing ? "文件已移动或删除" : entry.path}</span>
                        <small>
                          {entry.missing
                            ? "请移除此记录后重新打开文件"
                            : `最后打开 ${new Date(entry.lastOpenedAt).toLocaleString("zh-CN", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="project-card-remove"
                      aria-label={`从首页移除 ${entry.title}`}
                      title="仅移除记录，不删除项目文件"
                      onClick={() => onRemoveRecent(entry)}
                    >
                      <Trash2 />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
