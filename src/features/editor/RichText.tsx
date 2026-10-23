import { useMemo } from "react";
import {
  EMU_PER_INCH,
  resolveFragmentStyle,
  textFragments,
  type TextElement,
  type TextFragment,
} from "../../core/document-model";

/**
 * One drawn line of a marked text box.
 *
 * A marker belongs to the whole box, so the text is split on its line breaks
 * and every line gets the same marker. The split never changes the element's
 * text: the markers are drawn next to the copy, not written into it.
 */
function splitIntoLines(fragments: TextFragment[]): TextFragment[][] {
  const lines: TextFragment[][] = [[]];
  for (const fragment of fragments) {
    const segments = fragment.text.split("\n");
    segments.forEach((segment, index) => {
      if (index > 0) lines.push([]);
      if (segment) lines[lines.length - 1]!.push({ ...fragment, text: segment });
    });
  }
  return lines;
}

/**
 * The canvas view of a text element.
 *
 * The styled fragments of the element are drawn with their own weight and
 * colour, the same way the export writes them as separate runs. The fragments
 * are read from the text of the element, so the canvas cannot show an
 * emphasis the content does not carry.
 */
export function RichText({ element, scale }: { element: TextElement; scale: number }) {
  const fragments = useMemo(() => textFragments(element.text, element.runs), [element.text, element.runs]);
  const verticalAlign = element.style.verticalAlign ?? "top";
  const bullet = element.style.bullet ?? "none";
  const indentLevel = element.style.indentLevel ?? 0;
  const struck = element.style.strikethrough ?? false;

  const decorationOf = (underline: boolean): string | undefined => {
    const decoration = [underline ? "underline" : "", struck ? "line-through" : ""].filter(Boolean).join(" ");
    return decoration || undefined;
  };

  const renderFragment = (fragment: TextFragment, key: number) => {
    const style = resolveFragmentStyle(element.style, fragment.style);
    return (
      <span
        key={key}
        style={{
          fontWeight: style.bold ? 700 : 400,
          color: style.color,
          textDecoration: decorationOf(style.underline),
        }}
      >
        {fragment.text}
      </span>
    );
  };

  const boxStyle: React.CSSProperties = {
    fontFamily: element.style.fontFamily,
    fontSize: (element.style.fontSizePt * scale * EMU_PER_INCH) / 72,
    color: element.style.color,
    fontWeight: element.style.bold ? 700 : 400,
    fontStyle: element.style.italic ? "italic" : undefined,
    textAlign: element.style.align,
    letterSpacing:
      element.style.letterSpacingPt === undefined
        ? undefined
        : (element.style.letterSpacingPt * scale * EMU_PER_INCH) / 72,
    lineHeight: element.style.lineHeight,
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: verticalAlign === "middle" ? "center" : verticalAlign === "bottom" ? "flex-end" : "flex-start",
    paddingLeft: indentLevel > 0 ? `${indentLevel * 1.4}em` : undefined,
  };

  // Plain paragraphs keep the one-flow layout the renderer has always used.
  // Markers need per-line boxes, so only then is the text split. The inner div
  // is what makes the fragments one paragraph: making the fragments themselves
  // flex items would stack every styled run on its own line.
  if (bullet === "none") {
    return (
      <div style={boxStyle}>
        <div style={{ width: "100%" }}>{fragments.map(renderFragment)}</div>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      {splitIntoLines(fragments).map((line, lineIndex) => (
        <div key={lineIndex} style={{ display: "flex", gap: "0.45em", width: "100%" }}>
          <span style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>
            {bullet === "number" ? `${lineIndex + 1}.` : "•"}
          </span>
          <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: element.style.align }}>
            {line.map(renderFragment)}
          </span>
        </div>
      ))}
    </div>
  );
}
