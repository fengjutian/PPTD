/**
 * Repairs a stored document before it is read back.
 *
 * A document whose pages point at layouts it does not declare is rejected by
 * the schema: the reference has to resolve, otherwise the exporter cannot tell
 * which slide master a page belongs to. A file written by an older build can
 * carry such a dangling reference, and refusing to open it would throw away
 * every page, every picture and every reviewed paragraph the user still has.
 *
 * The repair drops the dangling references and keeps the rest of the document
 * exactly as it was. It is a last resort for stored data, never a way to
 * legitimize a document the current build produces.
 */

export interface DocumentRepair {
  /** The repaired document, or the input unchanged when nothing had to change. */
  document: unknown;
  /** How many page references were dropped. */
  removedLayoutReferences: number;
}

interface SlideLike {
  layoutId?: unknown;
}

interface DocumentLike {
  slides?: unknown;
  layouts?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Removes the layout references a document cannot resolve.
 *
 * Only the reference is dropped: the page, its content and its objects stay
 * untouched, so the user still gets every word and every picture back.
 */
export function repairDanglingLayoutReferences(input: unknown): DocumentRepair {
  if (!isRecord(input)) return { document: input, removedLayoutReferences: 0 };
  const source = input as DocumentLike;
  if (!Array.isArray(source.slides)) return { document: input, removedLayoutReferences: 0 };
  const known = new Set<string>();
  if (Array.isArray(source.layouts)) {
    for (const layout of source.layouts) {
      if (isRecord(layout) && typeof layout.id === "string") known.add(layout.id);
    }
  }
  let removedLayoutReferences = 0;
  const slides = source.slides.map((slide) => {
    if (!isRecord(slide)) return slide;
    const layoutId = (slide as SlideLike).layoutId;
    if (typeof layoutId !== "string" || known.has(layoutId)) return slide;
    removedLayoutReferences += 1;
    const copy = { ...slide };
    delete copy.layoutId;
    return copy;
  });
  if (removedLayoutReferences === 0) return { document: input, removedLayoutReferences: 0 };
  return { document: { ...source, slides }, removedLayoutReferences };
}
