import { strFromU8, strToU8 } from "fflate";

/**
 * Package part names of an exported PPTX.
 *
 * A part name is a URI segment. PowerPoint refuses to open a package whose
 * part names contain characters that are not valid in a URI, and the layout of
 * a Chinese template produces exactly such a name: the media of a layout
 * background is derived from the name of the layout, so it ends up as
 * `ppt/media/内页（浅色）1-image-1.png`. The file opens in LibreOffice but
 * PowerPoint answers `0x808D1003`.
 *
 * The name of the layout itself is safe: it is an attribute of the layout XML,
 * not a part name, so the template keeps its Chinese name in the layout list
 * of PowerPoint. Only the media parts are renamed, and every relationship that
 * points at them is rewritten with them.
 */

const MEDIA_PREFIX = "ppt/media/";

/** Characters that are not allowed in the URI segment of a part name. */
const UNSAFE_IN_PART_NAME = /[^\x21-\x7e]|[<>:"|?*\\]/;

export interface PackageRewrite {
  /** Part names that were renamed, old name first. */
  renamed: string[];
}

function isMediaPart(name: string): boolean {
  return name.startsWith(MEDIA_PREFIX) && !name.endsWith("/");
}

/**
 * Renames every media part whose name cannot live in a URI and rewrites the
 * relationships that reference it. The entries are returned untouched when no
 * part needs to be renamed.
 */
export function normalizePackagePartNames(entries: Record<string, Uint8Array>): PackageRewrite {
  const renames = new Map<string, string>();
  let counter = 0;
  for (const name of Object.keys(entries)) {
    if (!isMediaPart(name)) continue;
    const fileName = name.slice(MEDIA_PREFIX.length);
    if (!UNSAFE_IN_PART_NAME.test(fileName)) continue;
    const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "png";
    renames.set(name, `${MEDIA_PREFIX}layout-artwork-${counter + 1}.${extension}`);
    counter += 1;
  }
  if (renames.size === 0) return { renamed: [] };

  const rewritten: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    rewritten[renames.get(name) ?? name] = data;
  }
  for (const [name, data] of Object.entries(rewritten)) {
    if (!name.endsWith(".rels")) continue;
    let xml = strFromU8(data);
    let touched = false;
    for (const [from, to] of renames) {
      const fromName = from.slice(MEDIA_PREFIX.length);
      const toName = to.slice(MEDIA_PREFIX.length);
      if (!xml.includes(fromName)) continue;
      xml = xml.split(fromName).join(toName);
      touched = true;
    }
    if (touched) rewritten[name] = strToU8(xml);
  }
  for (const [name, data] of Object.entries(rewritten)) entries[name] = data;
  for (const name of Object.keys(entries)) {
    if (!renames.has(name)) continue;
    delete entries[name];
  }
  return { renamed: [...renames.keys()] };
}
