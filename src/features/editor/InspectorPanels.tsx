import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadSettings } from "../../services/settings";

import { ChevronDown, Stethoscope } from "lucide-react";
import { type ElementId, type SlideId } from "../../core/document-model";

import { lintTaste, type TasteIssue } from "../../core/design/taste-lint";

import { useEditorStore } from "../../store/editor-store";

/**
 * One group of properties.
 *
 * The groups can be folded away, because the panel of a text object is longer
 * than the window. The head of a group sticks to the top of the panel while
 * the group scrolls by, so the user always knows where the fields belong.
 */
export function InspectorSection({
  title,
  tools,
  children,
  defaultOpen = true,
}: {
  title: string;
  tools?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`inspector-section${open ? "" : " folded"}`}>
      <div className="section-head">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown className={open ? "" : "folded"} />
          <h4>{title}</h4>
        </button>
        {tools}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/**
 * Deterministic design review, shown next to the properties of the page.
 *
 * Collapsed by default: it is a report, not a form. The badge still surfaces a
 * hard finding so a page with unreadable copy does not pass unnoticed, and the
 * panel never blocks or edits anything.
 */
const SKIPPED_LABELS: Readonly<Record<string, string>> = {
  "template-artwork:color-whitespace": "模板底图的颜色与留白",
  "full-bleed-artwork:color-whitespace": "整页图形的颜色与留白",
  "typography:no-title": "无标题页",
  "typography:no-body": "无正文页",
};

export function TastePanel() {
  const document = useEditorStore((state) => state.document);
  const selectSlide = useEditorStore((state) => state.selectSlide);
  const selectElements = useEditorStore((state) => state.selectElements);
  const report = useMemo(() => lintTaste(document), [document]);
  const [tasteLintEnabled, setTasteLintEnabled] = useState(true);
  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((settings) => {
        if (active) setTasteLintEnabled(settings.tasteLintEnabled);
      })
      .catch(() => {
        // A read failure keeps the panel visible; hiding it would look like a
        // clean bill of health.
      });
    return () => {
      active = false;
    };
  }, []);
  const hard = report.issues.filter((issue) => issue.severity === "hard").length;
  const soft = report.issues.length - hard;

  const jumpTo = (issue: TasteIssue) => {
    selectSlide(issue.slideId as SlideId);
    if (issue.elementIds.length > 0) selectElements(issue.elementIds as ElementId[]);
  };

  if (!tasteLintEnabled) return null;

  return (
    <InspectorSection
      title="设计体检"
      defaultOpen={false}
      tools={
        <span className="taste-badges" aria-label="体检结果">
          <span className={`taste-badge${hard > 0 ? " hard" : ""}`}>{hard} 硬底线</span>
          <span className={`taste-badge${soft > 0 ? " soft" : ""}`}>{soft} 提示</span>
          {report.skipped.length > 0 && <span className="taste-badge muted">{report.skipped.length} 未覆盖</span>}
        </span>
      }
    >
      <div className="taste-panel">
        <p className="taste-intro">
          <Stethoscope size={14} />
          仅提示，不影响生成与导出；像素级问题由视觉评审负责。
        </p>
        {report.issues.length === 0 ? (
          <p className="field-help">未发现问题。</p>
        ) : (
          <ul className="taste-issues">
            {report.issues.map((issue, index) => (
              <li key={`${issue.slideIndex}:${issue.code}:${index}`}>
                <button type="button" className="taste-issue" onClick={() => jumpTo(issue)}>
                  <span className={`taste-dot ${issue.severity}`} aria-hidden />
                  <span className="taste-issue-text">
                    <strong>{issue.message}</strong>
                    <small>
                      第 {issue.slideIndex + 1} 页 · {issue.code}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {report.skipped.length > 0 && (
          <p className="field-help">
            未覆盖：{report.skipped.map((reason) => SKIPPED_LABELS[reason] ?? reason).join("、")}
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

/**
 * The last direction decision, kept next to the page properties.
 *
 * It answers "why does the deck look like this" after a reopen: which direction
 * was chosen, which alternatives were shown, and what the user said at the time.
 */
const DIRECTION_PRESET_LABELS: Readonly<Record<string, string>> = {
  editorial: "编辑式",
  documentary: "纪实全幅",
  paper: "纸本专栏",
  instrument: "数据仪表",
};

export function DirectionPanel() {
  const document = useEditorStore((state) => state.document);
  const records = document.designDirections ?? [];
  const record = records.at(-1);
  const selected = record?.proposals.find((proposal) => proposal.id === record.selectedProposalId);
  return (
    <InspectorSection
      title="设计方向"
      defaultOpen={false}
      tools={record ? <span className="taste-badge">{selected?.name ?? "已记录"}</span> : undefined}
    >
      {!record ? (
        <p className="field-help">尚未记录设计方向。无模板生成时会先给出四个方向供选择。</p>
      ) : (
        <div className="direction-record">
          <p className="direction-record-line">
            <strong>{selected?.name ?? "已删除的方向"}</strong>
            <span className="taste-badge">{DIRECTION_PRESET_LABELS[selected?.preset ?? ""] ?? selected?.preset}</span>
            <span className="direction-record-meta">
              {record.selectedBy === "user" ? "你选的" : "按推荐"} ·{" "}
              {new Date(record.createdAt).toLocaleDateString("zh-CN")} · 内容 rev {record.contentRevision}
            </span>
          </p>
          {record.userWords && <p className="direction-record-words">“{record.userWords}”</p>}
          <ul className="direction-record-list">
            {record.proposals.map((proposal) => (
              <li key={proposal.id} className={proposal.id === record.selectedProposalId ? "selected" : ""}>
                <span aria-hidden>{proposal.id === record.selectedProposalId ? "✓" : "·"}</span>
                <div>
                  <strong>{proposal.name}</strong>
                  <small>
                    {DIRECTION_PRESET_LABELS[proposal.preset] ?? proposal.preset} · {proposal.idea}
                  </small>
                </div>
              </li>
            ))}
          </ul>
          {record.regenerations > 0 && <p className="field-help">生成前换过 {record.regenerations} 组方向。</p>}
          {records.length > 1 && (
            <details className="direction-history">
              <summary>历史方向（{records.length - 1}）</summary>
              <ul>
                {[...records]
                  .reverse()
                  .slice(1, 6)
                  .map((item) => {
                    const chosen = item.proposals.find((proposal) => proposal.id === item.selectedProposalId);
                    return (
                      <li key={item.id}>
                        <strong>{chosen?.name ?? "已删除的方向"}</strong>
                        <span>
                          {new Date(item.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                          {item.selectedBy === "user" ? "你选的" : "按推荐"}
                        </span>
                        {item.userWords && <small>“{item.userWords}”</small>}
                      </li>
                    );
                  })}
              </ul>
            </details>
          )}
        </div>
      )}
    </InspectorSection>
  );
}

/**
 * Presentation of the inspector for one element. It only emits commands, so the
 * same markup can be rendered without a store and asserted in tests.
 */
