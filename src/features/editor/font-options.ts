/**
 * The fonts offered by the font picker.
 *
 * Availability is a runtime concern: the export preflight reports a font the
 * machine does not have, and the picker still lists it so a shared deck keeps
 * its declared font. A deck may also carry a font from an imported template,
 * which the picker adds next to these.
 */
export const FONT_OPTIONS = [
  "Microsoft YaHei",
  "Source Han Serif SC",
  "Noto Serif SC",
  "SimSun",
  "SimHei",
  "KaiTi",
  "FangSong",
  "Arial",
  "Calibri",
  "Times New Roman",
  "Georgia",
] as const;
