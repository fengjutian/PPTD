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

function SlideDiff({ diff }: { diff: ContentSlideDiff }) {
  const index = diff.afterIndex ?? diff.beforeIndex ?? 0;
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
 * 已确认内容版本的对比面板。
 *
 * 版本是确认动作的副产品，只读：这里不提供“恢复”按钮，避免用户以为点一下
 * 就能把设计、对象和版式一起回滚。改动仍然通过撤销或重新编辑完成。
 */
export function ContentHistory({ document, onClose }: { document: PresentationDocument; onClose: () => void }) {
  const versions = document.contentVersions ?? [];
  const latestId = versions.at(-1)?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(latestId);
  const selected = versions.find((version) => version.id === selectedId) ?? versions.at(-1);
  const diff = selected ? diffContentVersion(selected, document) : [];

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
              <p>已确认内容的历史快照，只用于对比当前文稿，不会改动文字或版式。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭内容版本窗口" onClick={onClose}>
            <X />
          </button>
        </div>

        {versions.length === 0 ? (
          <p className="content-history-empty">
            还没有已确认的内容版本。确认本页内容或应用 AI 内容后，会自动保存第一份版本。旧项目不会自动补历史；如需建立基线，可先退回审核，再重新确认本页。
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
                <strong>与当前内容比较</strong>
                <span>{diff.length === 0 ? "没有差异" : `${diff.length} 页有变化`}</span>
              </div>
              {diff.length === 0 ? (
                <p className="content-history-empty">当前内容与这个版本一致。</p>
              ) : (
                <ul className="content-diff-list">
                  {diff.map((item) => (
                    <SlideDiff key={item.slideId} diff={item} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
