import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, paletteSwatches } from "./inspector-palette";

/** One PowerPoint color scheme, in the order the analysis lists it. */
const scheme = [
  { name: "dk1", value: "#000000" },
  { name: "lt1", value: "#FFFFFF" },
  { name: "dk2", value: "#44546A" },
  { name: "lt2", value: "#E7E6E6" },
  { name: "accent1", value: "#0F8B8D" },
  { name: "accent2", value: "#D35230" },
  { name: "accent3", value: "#7F7F7F" },
  { name: "accent4", value: "#C2660F" },
  { name: "accent5", value: "#2B579A" },
  { name: "accent6", value: "#7030A0" },
  { name: "hlink", value: "#0563C1" },
  { name: "folHlink", value: "#954F72" },
];

describe("palette swatches", () => {
  it("offers the colors of the template in the order it lists them", () => {
    expect(paletteSwatches(scheme)).toEqual(scheme.map((color) => color.value.toLowerCase()));
  });

  it("keeps one scheme when the template carries several themes", () => {
    // A template with five theme parts lists the same twelve slots five times.
    // Drawing all of them is the wall of chips the panel used to show.
    const fiveThemes = [...scheme, ...scheme, ...scheme, ...scheme, ...scheme];
    expect(paletteSwatches(fiveThemes)).toHaveLength(12);
  });

  it("does not offer the same color twice", () => {
    const repeated = [
      { name: "dk1", value: "#000000" },
      { name: "lt1", value: "#FFFFFF" },
      { name: "accent1", value: "#FFFFFF" },
      { name: "accent2", value: "#0F8B8D" },
    ];
    expect(paletteSwatches(repeated)).toEqual(["#000000", "#ffffff", "#0f8b8d"]);
  });

  it("normalizes the written form of a color so equal colors compare equal", () => {
    const written = [
      { name: "accent1", value: "FFF" },
      { name: "accent2", value: "#ffffff" },
    ];
    expect(paletteSwatches(written)).toEqual(["#ffffff"]);
  });

  it("skips a color the field cannot use", () => {
    const broken = [
      { name: "dk1", value: "rgb(0, 0, 0)" },
      { name: "lt1", value: "#FFFFFF" },
    ];
    expect(paletteSwatches(broken)).toEqual(["#ffffff"]);
  });

  it("falls back to the default colors for a deck without a theme", () => {
    expect(paletteSwatches(undefined)).toEqual(DEFAULT_PALETTE);
    expect(paletteSwatches([])).toEqual(DEFAULT_PALETTE);
  });

  it("stops at the size of a scheme even when every name is new", () => {
    const nameless = Array.from({ length: 40 }, (_item, index) => ({
      name: `color${index}`,
      value: `#${(index * 6).toString(16).padStart(2, "0").repeat(3)}`,
    }));
    expect(paletteSwatches(nameless)).toHaveLength(12);
  });
});
