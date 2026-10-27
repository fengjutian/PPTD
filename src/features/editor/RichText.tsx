import { useMemo } from "react";
import {
  EMU_PER_INCH,
  resolveFragmentStyle,
  textFragments,
  type TextElement,
  type TextRunStyle,
} from "../../core/document-model";
import { breakAtoms, type MeasurableAtom } from "../../core/rendering/cjk-linebreak";
import { DEFAULT_LINE_HEIGHT, measureCharacterEm, runMetricsOf } from "../../core/rendering/text-fit";

/**
 * One character of the text with the style it is drawn in.
 *
 * The canvas has to draw fragments, not paragraphs: a line that carries an
 * emphasised word is one line with two spans, the way the export writes two
 * runs. Keeping the style per character is also what lets the measured line
 * breaking below split a styled run at a line boundary.
 */
interface StyledCharacter {
  character: string;
  style: TextRunStyle;
  bold: boolean;
  color: string;
  underline: boolean;
}

/** The characters of the element, with the style of the fragment they belong to. */
function styledCharacters(element: TextElement): StyledCharacter[] {
  const characters: StyledCharacter[] = [];
  for (const fragment of textFragments(element.text, element.runs)) {
    const style = resolveFragmentStyle(element.style, fragment.style);
    for (const character of fragment.text) {
      characters.push({
        character,
        style: fragment.style,
        bold: style.bold,
        color: style.color,
        underline: style.underline,
      });
    }
  }
  return characters;
}

/** The paragraphs of a text, split at the line breaks the author wrote. */
function splitParagraphs(characters: StyledCharacter[]): StyledCharacter[][] {
  const paragraphs: StyledCharacter[][] = [[]];
  for (const character of characters) {
    if (character.character === "\n") {
      paragraphs.push([]);
      continue;
    }
    paragraphs[paragraphs.length - 1]!.push(character);
  }
  return paragraphs;
}

/**
 * The canvas view of a text element.
 *
 * The lines are the ones the layout measured, not the ones the browser would
 * choose: the canvas, the preview and the file break a paragraph at the same
 * character. Drawing the browser's wrapping instead meant a title fit on one
 * line in the editor and on two in the exported page — the layout engine had
 * counted a break the canvas never showed.
 *
 * A line is rendered with `white-space: pre` so the browser cannot wrap it a
 * second time; a measured line that does not fit overflows its box, which is
 * what the dashed overflow edge on the frame is for.
 */
export function RichText({ element, scale }: { element: TextElement; scale: number }) {
  const verticalAlign = element.style.verticalAlign ?? "top";
  const bullet = element.style.bullet ?? "none";
  const indentLevel = element.style.indentLevel ?? 0;
  const struck = element.style.strikethrough ?? false;
  const trackingPt = element.style.letterSpacingPt;

  const paragraphs = useMemo(() => {
    const characters = styledCharacters(element);
    if (characters.length === 0) return [];
    const metrics = runMetricsOf(element);
    const widthEm = Math.max(1, element.frame.width / 12_700 / Math.max(0.01, element.style.fontSizePt));
    return splitParagraphs(characters).map((paragraph) => {
      if (paragraph.length === 0) return [[]];
      const atoms: MeasurableAtom<StyledCharacter>[] = paragraph.map((character) => ({
        value: character,
        text: character.character,
        // The same advance the layout counted, tracking and weight included.
        width: measureCharacterEm(character.character, element.style.fontSizePt, metrics, element.style.fontFamily),
      }));
      return breakAtoms(atoms, widthEm).map((line) => line.map((atom) => atom.value));
    });
  }, [element, trackingPt]);

  const decorationOf = (underline: boolean): string | undefined => {
    const decoration = [underline ? "underline" : "", struck ? "line-through" : ""].filter(Boolean).join(" ");
    return decoration || undefined;
  };

  const tabWidth =
    ((element.style.tabStops?.[0]?.positionPt ?? element.style.fontSizePt * 4) * scale * EMU_PER_INCH) / 72;

  /** One line, grouped into spans of one style each. */
  const renderLine = (line: StyledCharacter[], key: number): React.ReactNode => {
    const groups: StyledCharacter[][] = [];
    for (const character of line) {
      const last = groups[groups.length - 1];
      const same =
        last?.[0] !== undefined &&
        last[0].bold === character.bold &&
        last[0].color === character.color &&
        last[0].underline === character.underline &&
        last[0].style.hyperlinkUrl === character.style.hyperlinkUrl;
      if (!same) groups.push([character]);
      else last.push(character);
    }
    const renderGroup = (group: StyledCharacter[], groupIndex: number, pre: boolean) => {
      const first = group[0]!;
      const content = group.map((character) => character.character).join("");
      const pieces = content.split("\t");
      const body =
        pieces.length === 1
          ? content
          : pieces.map((piece, pieceIndex) => (
              <span key={pieceIndex}>
                {pieceIndex > 0 && <span aria-hidden="true" style={{ display: "inline-block", width: tabWidth }} />}
                {piece}
              </span>
            ));
      return (
        <span
          key={groupIndex}
          style={{
            fontWeight: first.bold ? 700 : 400,
            color: first.color,
            textDecoration: decorationOf(first.underline),
            ...(pre ? { whiteSpace: "pre" as const } : {}),
          }}
        >
          {body}
        </span>
      );
    };
    // A single style needs no wrapper: the span carries the no-wrap rule itself.
    if (groups.length === 1) return renderGroup(groups[0]!, 0, true);
    return (
      <span key={key} style={{ whiteSpace: "pre" }}>
        {groups.map((group, groupIndex) => renderGroup(group, groupIndex, false))}
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
    letterSpacing: trackingPt === undefined ? undefined : (trackingPt * scale * EMU_PER_INCH) / 72,
    lineHeight: element.style.lineHeight ?? DEFAULT_LINE_HEIGHT,
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: verticalAlign === "middle" ? "center" : verticalAlign === "bottom" ? "flex-end" : "flex-start",
    paddingLeft: indentLevel > 0 ? `${indentLevel * 1.4}em` : undefined,
  };

  const paragraphStyle = (): React.CSSProperties => ({
    width: "100%",
    paddingTop:
      element.style.paragraphSpaceBeforePt === undefined
        ? undefined
        : (element.style.paragraphSpaceBeforePt * scale * EMU_PER_INCH) / 72,
    paddingBottom:
      element.style.paragraphSpaceAfterPt === undefined
        ? undefined
        : (element.style.paragraphSpaceAfterPt * scale * EMU_PER_INCH) / 72,
  });

  return (
    <div style={boxStyle}>
      {paragraphs.map((lines, paragraphIndex) => (
        <div key={paragraphIndex} style={paragraphStyle()}>
          {lines.map((line, lineIndex) => {
            if (line.length === 0 && lines.length > 1) return null;
            if (bullet === "none") {
              return (
                <div key={lineIndex} data-line={lineIndex} style={{ width: "100%" }}>
                  {renderLine(line, lineIndex)}
                </div>
              );
            }
            return (
              <div key={lineIndex} data-line={lineIndex} style={{ display: "flex", gap: "0.45em", width: "100%" }}>
                <span style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>
                  {lineIndex === 0 ? (bullet === "number" ? `${paragraphIndex + 1}.` : "•") : ""}
                </span>
                <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: element.style.align }}>
                  {renderLine(line, lineIndex)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
