const HEX_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalizes `#abc` / `abc` / `#aabbcc` into the `#aabbcc` form the schema and exporter accept. */
export function normalizeHexColor(raw: string): string | undefined {
  const value = raw.trim();
  if (!HEX_PATTERN.test(value)) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  // A short color repeats every digit: `#abc` is `#aabbcc`.
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex;
  return `#${full.toLowerCase()}`;
}
