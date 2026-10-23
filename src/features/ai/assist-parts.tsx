/**
 * 审核页 AI 对话框共用的文本展示。
 *
 * 正文在合同里是一行一条的纯文本投影，所以对话框按行展示，而不是重新解释
 * 内容块。这样三个对话框看到的都是同一份文字。
 */
export function TextLines({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return <p className="slide-rewrite-empty">{emptyLabel}</p>;
  return (
    <div className="slide-rewrite-lines">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}

export function SpeakerNotes({ text }: { text: string }) {
  return (
    <div className="slide-rewrite-notes">
      <span>演讲备注</span>
      {text.trim() ? <p>{text}</p> : <p className="slide-rewrite-empty">没有备注</p>}
    </div>
  );
}
