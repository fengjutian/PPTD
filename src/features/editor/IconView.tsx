import { BUILTIN_ICONS, type BuiltinIconName, type IconElement } from "../../core/document-model";

export interface IconGlyphProps {
  name: BuiltinIconName;
  color: string;
  strokeWidth?: number;
}

/**
 * The drawing of one built-in icon.
 *
 * The paths come from the registry, never from the document: the only thing a
 * saved file can choose is the icon name. The caller decides the box; the icon
 * keeps its 24×24 grid and centres itself in it.
 */
export function IconGlyph({ name, color, strokeWidth = 2 }: IconGlyphProps) {
  const definition = BUILTIN_ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-hidden="true"
    >
      {(definition.circles ?? []).map((circle, index) => (
        <circle key={`circle-${index}`} cx={circle.cx} cy={circle.cy} r={circle.r} />
      ))}
      {definition.paths.map((path, index) => (
        <path key={`path-${index}`} d={path} />
      ))}
    </svg>
  );
}

/** The canvas view of an icon element. */
export function IconView({ element }: { element: IconElement }) {
  return <IconGlyph name={element.name} color={element.style.color} strokeWidth={element.style.strokeWidth} />;
}
