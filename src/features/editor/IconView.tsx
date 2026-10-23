import { BUILTIN_ICONS, type IconElement } from "../../core/document-model";

/**
 * The canvas view of a built-in icon.
 *
 * The drawing is rebuilt from the icon definition instead of being injected as
 * markup, so the only thing a document can choose is a name from the registry.
 * The frame of the element decides the size; the icon keeps its 24×24 grid and
 * centres itself in the frame.
 */
export function IconView({ element }: { element: IconElement }) {
  const definition = BUILTIN_ICONS[element.name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={element.style.color}
      strokeWidth={element.style.strokeWidth ?? 2}
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
