import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  buildReplaceAllEdits,
  editKey,
  findTextMatches,
  matchIsLocked,
  matchKey,
  replaceOccurrence,
  toReplaceEdit,
  type TextMatch,
} from "../../core/commands";
import { useEditorStore } from "../../store/editor-store";

/**
 * The find-and-replace bar.
 *
 * The search runs over every place the deck shows copy: text elements, table
 * cells, chart labels and values, speaker notes and the document title. A
 * result jumps to its page and selects the object, so the canvas shows the
 * match in context; the result list carries the exact snippet because selecting
 * an object alone does not say which occurrence matched. Replacing one or all
 * writes through `replace-text-edits`, which keeps each replacement one undo
 * step and routes every target through the same rules as its single-target
 * command.
 */
export function FindReplaceBar({ onClose }: { onClose: () => void }) {
  const document = useEditorStore((state) => state.document);
  const execute = useEditorStore((state) => state.execute);
  const selectSlide = useEditorStore((state) => state.selectSlide);
  const selectElement = useEditorStore((state) => state.selectElement);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<string>();

  const matches = useMemo(() => findTextMatches(document, query, { matchCase }), [document, query, matchCase]);

  // A shrinking result set must not leave the cursor past the end.
  useEffect(() => {
    setIndex((current) => (matches.length === 0 ? 0 : Math.min(current, matches.length - 1)));
  }, [matches.length]);

  const jumpTo = (next: number) => {
    const match = matches[next];
    if (!match) return;
    setIndex(next);
    // 标题没有画布位置，跳到它只会弹出一个重命名框；结果行本身已经给出
    // 完整标题，替换也直接生效，所以这里只更新状态，不打断输入。
    if (match.kind === "document-title") {
      setStatus("文档标题：替换会直接改写项目标题");
      return;
    }
    // selectSlide 会清空选择；备注结果因此回到页面属性栏，那里才是备注的
    // 编辑入口。文本、表格和图表再选回具体对象。
    selectSlide(match.slideId);
    if (match.kind !== "speaker-notes") selectElement(match.elementId);
  };

  const move = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    jumpTo((index + direction + matches.length) % matches.length);
  };

  const replaceOne = () => {
    const match = matches[index];
    if (!match) return;
    if (matchIsLocked(document, match)) {
      setStatus("对象已锁定，先解锁再替换");
      return;
    }
    const nextText = replaceOccurrence(match.text, match.start, match.end, replacement);
    if (nextText === match.text) {
      setStatus("替换内容与原文相同");
      return;
    }
    execute({ type: "replace-text-edits", edits: [toReplaceEdit(match, nextText)] });
    setStatus(`已替换 1 处（${targetLabel(match)}）`);
  };

  const replaceAll = () => {
    const edits = buildReplaceAllEdits(document, query, replacement, { matchCase });
    if (edits.length === 0) {
      setStatus(matches.length > 0 ? "替换内容与原文相同" : "没有可替换的内容");
      return;
    }
    const edited = new Set(edits.map(editKey));
    const replaced = matches.filter((match) => edited.has(matchKey(match))).length;
    const skipped = matches.length - replaced;
    execute({ type: "replace-text-edits", edits });
    setStatus(
      `已替换 ${replaced} 处（${edits.length} 个位置）${skipped > 0 ? `，跳过 ${skipped} 处锁定对象` : ""}`,
    );
  };

  return (
    <section className="find-replace-bar" role="dialog" aria-label="查找和替换">
      <div className="find-replace-heading">
        <Search />
        <strong>查找和替换</strong>
        <span>{query ? `${matches.length} 处` : "输入要查找的文字"}</span>
        <button type="button" aria-label="关闭查找和替换" onClick={onClose}>
          <X />
        </button>
      </div>
      <label className="find-replace-field">
        <span>查找</span>
        <input
          autoFocus
          value={query}
          placeholder="在文本、表格、图表、备注和标题中查找"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
            setStatus(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) move(-1);
              else move(1);
            }
            if (event.key === "Escape") onClose();
          }}
        />
      </label>
      <label className="find-replace-field">
        <span>替换为</span>
        <input
          value={replacement}
          placeholder="留空表示删除匹配文字"
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              replaceOne();
            }
            if (event.key === "Escape") onClose();
          }}
        />
      </label>
      <div className="find-replace-actions">
        <label className="find-replace-case">
          <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
          区分大小写
        </label>
        <div className="find-replace-buttons">
          <button
            type="button"
            aria-label="上一个匹配"
            title="上一个（Shift+Enter）"
            disabled={!matches.length}
            onClick={() => move(-1)}
          >
            <ChevronUp />
          </button>
          <button
            type="button"
            aria-label="下一个匹配"
            title="下一个（Enter）"
            disabled={!matches.length}
            onClick={() => move(1)}
          >
            <ChevronDown />
          </button>
          <button type="button" disabled={!matches.length} onClick={replaceOne}>
            替换
          </button>
          <button type="button" disabled={!matches.length} onClick={replaceAll}>
            全部替换
          </button>
        </div>
      </div>
      {status && (
        <p className="find-replace-status" role="status">
          {status}
        </p>
      )}
      {matches.length > 0 && (
        <ol className="find-results">
          {matches.slice(0, 50).map((match, matchIndex) => (
            <li key={`${matchKey(match)}-${match.start}`}>
              <button
                type="button"
                className={matchIndex === index ? "active" : undefined}
                aria-current={matchIndex === index ? "true" : undefined}
                onClick={() => jumpTo(matchIndex)}
              >
                <span className="find-result-page">{targetLabel(match)}</span>
                <MatchSnippet match={match} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Where the match lives, shown in the result list. */
function targetLabel(match: TextMatch): string {
  if (match.kind === "document-title") return "文档标题";
  const page = `第 ${match.slideIndex + 1} 页`;
  switch (match.kind) {
    case "speaker-notes":
      return `${page} · 备注`;
    case "table-cell":
      return `${page} · 表格`;
    case "metric":
      return `${page} · 图表`;
    case "text":
      return `${page} · 文本`;
  }
}

function MatchSnippet({ match }: { match: TextMatch }) {
  const from = Math.max(0, match.start - 10);
  const to = Math.min(match.text.length, match.end + 16);
  return (
    <span className="find-result-copy">
      {from > 0 ? "…" : ""}
      {match.text.slice(from, match.start)}
      <mark>{match.text.slice(match.start, match.end)}</mark>
      {match.text.slice(match.end, to)}
      {to < match.text.length ? "…" : ""}
    </span>
  );
}
