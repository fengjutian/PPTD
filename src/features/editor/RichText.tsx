import { useMemo } from "react";
import { EMU_PER_INCH, resolveFragmentStyle, textFragments, type TextElement } from "../../core/document-model";

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
  return (
    <div
      style={{
        fontFamily: element.style.fontFamily,
        fontSize: (element.style.fontSizePt * scale * EMU_PER_INCH) / 72,
        color: element.style.color,
        fontWeight: element.style.bold ? 700 : 400,
        textAlign: element.style.align,
        letterSpacing:
          element.style.letterSpacingPt === undefined
            ? undefined
            : (element.style.letterSpacingPt * scale * EMU_PER_INCH) / 72,
        lineHeight: element.style.lineHeight,
      }}
    >
      {fragments.map((fragment, index) => {
        const style = resolveFragmentStyle(element.style, fragment.style);
        return (
          <span
            key={index}
            style={{
              fontWeight: style.bold ? 700 : 400,
              color: style.color,
              textDecoration: style.underline ? "underline" : undefined,
            }}
          >
            {fragment.text}
          </span>
        );
      })}
    </div>
  );
}
