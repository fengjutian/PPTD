import { useState } from "react";
import { History, X } from "lucide-react";
import {
  diffContentVersion,
  type ContentFieldChange,
  type ContentSlideDiff,
  type PresentationDocument,
} from "../../core/document-model";

const FIELD_LABELS: Record<ContentFieldChange["field"], string> = {
  title: "标题",
  body: "正文",
  speakerNotes: "演讲备注",
  block: "内容块",
  blockOrder: "内容块顺序",
};

const STATUS_LABELS: Record<ContentSlideDiff["status"], string> = {
  added: "新增页",
  removed: "已删除",
  changed: "有修改",
  moved: "顺序调整",
};

function excerpt(value: string | undefined): string {
  if (!value) return "（空）";
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

function ChangeLine({ change }: { change: ContentFieldChange }) {
  if (change.change === "added") {
    return (
      <li className="content-diff-added">
        <span>{FIELD_LABELS[change.field]}</span>
        <span>新增：{excerpt(change.after)}</span>
      </li>
    );
  }
  if (change.change === "removed") {
    return (
      <li className="content-diff-removed">
        <span>{FIELD_LABELS[change.field]}</span>
        <span>删除：{excerpt(change.before)}</span>
      </li>
    );
  }
  return (
    <li>
      <span>{FIELD_LABELS[change.field]}</span>
      <span className="content-diff-values">
        <del>{excerpt(change.before)}</del>
        <ins>{excerpt(change.after)}</ins>
      </span>
    </li>
  );
}

function SlideDiff({ diff, currentIndex }: { diff: ContentSlideDiff; currentIndex: number }) {
  const index = diff.afterIndex ?? (currentIndex >= 0 ? currentIndex : diff.beforeIndex) ?? 0;
  const moved = diff.beforeIndex !== undefined && diff.afterIndex !== undefined && diff.beforeIndex !== diff.afterIndex;
  return (
    <li className={`content-diff-page ${diff.status}`}>
      <div className="content-diff-page-heading">
        <span className={`content-diff-badge ${diff.status}`}>{STATUS_LABELS[diff.status]}</span>
        <strong>{diff.afterTitle || diff.beforeTitle || "未命名页"}</strong>
        <span>{diff.status === "removed" ? `原第 ${index + 1} 页` : `第 ${index + 1} 页`}</span>
      </div>
      {diff.status === "added" && <p>这个版本之后新增的页面。</p>}
      {diff.status === "removed" && <p>整页已从当前文稿删除。</p>}
      {moved && (
        <p>
          从第 {diff.beforeIndex! + 1} 页移到第 {diff.afterIndex! + 1} 页。
        </p>
      )}
      {diff.changes.length > 0 && (
        <ul className="content-diff-changes">
          {diff.changes.map((change, index) => (
            <ChangeLine key={`${change.field}-${change.change}-${index}`} change={change} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 已确认内容版本的对比与恢复面板。
 *
 * 恢复只回滚内容字段和页序，版式、对象和背景留在当前文稿里。页面集合
 * 发生变化时只允许查看差异，避免用一次内容恢复悄悄删掉或重建页面。
 */
function designSignature(slide: PresentationDocument["slides"][number]) {
  return JSON.stringify({
    background: slide.background,
    elements: slide.elements,
    animations: slide.animations ?? null,
    transition: slide.transition ?? null,
    groups: slide.groups ?? null,
    layoutId: slide.layoutId ?? null,
  });
}

export function ContentHistory({
  document,
  onClose,
  onRestore,
  onRestoreDesign,
}: {
  document: PresentationDocument;
  onClose: () => void;
  onRestore: (versionId: string) => void;
  onRestoreDesign: (versionId: string) => void;
}) {
  const versions = document.contentVersions ?? [];
  const reviewTraces = document.reviewTraces ?? [];
  const latestId = versions.at(-1)?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(latestId);
  const selected = versions.find((version) => version.id === selectedId) ?? versions.at(-1);
  const diff = selected ? diffContentVersion(selected, document) : [];
  const restorable =
    selected !== undefined &&
    selected.slides.length === document.slides.length &&
    selected.slides.every((versionSlide) => document.slides.some((slide) => slide.id === versionSlide.slideId));
  const designChangedPages =
    selected?.design?.slides.filter((snapshot) => {
      const slide = document.slides.find((candidate) => candidate.id === snapshot.slideId);
      if (!slide) return false;
      const expected = {
        background: snapshot.background,
        elements: snapshot.elements,
        animations: snapshot.animations ?? null,
        transition: snapshot.transition ?? null,
        groups: snapshot.groups ?? null,
        layoutId: snapshot.layoutId ?? null,
      };
      return designSignature(slide) !== JSON.stringify(expected);
    }).length ?? 0;

  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog content-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-history-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <History />
            <div>
              <h2 id="content-history-title">内容版本</h2>
              <p>已确认内容的历史快照，可逐页对比；可只恢复内容，也可同时恢复当时的版式。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭内容版本窗口" onClick={onClose}>
            <X />
          </button>
        </div>

        {versions.length === 0 ? (
          <p className="content-history-empty">
            还没有已确认的内容版本。确认本页内容或应用 AI
            内容后，会自动保存第一份版本。旧项目不会自动补历史；已确认的页面可先退回审核，再重新确认本页来建立基线。
          </p>
        ) : (
          <div className="content-history-body">
            <ol className="content-history-versions" aria-label="内容版本列表">
              {versions
                .slice()
                .reverse()
                .map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      className={version.id === selected?.id ? "active" : ""}
                      aria-pressed={version.id === selected?.id}
                      onClick={() => setSelectedId(version.id)}
                    >
                      <strong>内容 r{version.contentRevision}</strong>
                      <span>
                        文档 r{version.documentRevision} · {version.slides.length} 页
                      </span>
                      {version.id === latestId && <em>最新</em>}
                    </button>
                  </li>
                ))}
            </ol>

            <div className="content-history-diff">
              <div className="content-history-diff-heading">
                <div>
                  <strong>与当前内容比较</strong>
                  <span>{diff.length === 0 ? "没有差异" : `${diff.length} 页有变化`}</span>
                </div>
                {selected && diff.length > 0 && (
                  <button
                    type="button"
                    className="content-history-restore"
                    disabled={!restorable}
                    title={
                      restorable
                        ? "只恢复标题、正文、内容块、备注和页序；版式、对象和背景不变"
                        : "此版本与当前页面集合不同，无法只恢复内容"
                    }
                    onClick={() => onRestore(selected.id)}
                  >
                    恢复此版本内容
                  </button>
                )}
                {selected?.design && designChangedPages > 0 && (
                  <button
                    type="button"
                    className="content-history-restore"
                    disabled={!restorable}
                    title="同时恢复这个版本的背景、对象、动画、切换和页面尺寸"
                    onClick={() => onRestoreDesign(selected.id)}
                  >
                    同时恢复版式（{designChangedPages} 页）
                  </button>
                )}
              </div>
              {selected && diff.length > 0 && !restorable && (
                <p className="content-history-hint">
                  此版本与当前页面集合不同，只能查看差异。请用撤销或手动编辑回到这个内容。
                </p>
              )}
              {diff.length === 0 ? (
                <p className="content-history-empty">当前内容与这个版本一致。</p>
              ) : (
                <ul className="content-diff-list">
                  {diff.map((item) => (
                    <SlideDiff
                      key={item.slideId}
                      diff={item}
                      currentIndex={document.slides.findIndex((slide) => slide.id === item.slideId)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {reviewTraces.length > 0 && (
          <div className="content-history-traces">
            <h3>AI 视觉评审记录</h3>
            <ul>
              {reviewTraces
                .slice()
                .reverse()
                .map((trace) => {
                  const fitCount = trace.templateFitCounts
                    ? Object.values(trace.templateFitCounts).reduce((sum, count) => sum + count, 0)
                    : 0;
                  return (
                    <li key={trace.id}>
                      <strong>
                        {trace.overallScore} 分
                        {trace.templateFitScore !== undefined ? ` · 模板符合度 ${trace.templateFitScore}` : ""}
                      </strong>
                      <span>{new Date(trace.createdAt).toLocaleString("zh-CN")}</span>
                      {trace.templateName && (
                        <span>
                          模板：{trace.templateName}
                          {trace.templateHash ? ` · ${trace.templateHash.slice(0, 8)}` : ""}
                        </span>
                      )}
                      {fitCount > 0 && <span>模板偏差 {fitCount} 处</span>}
                      <span>
                        {trace.issueCount} 条问题 · {trace.slides.length} 页有评分
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
