import { describe, expect, it } from "vitest";
import { breakAtoms, breakIntoLines, type MeasurableAtom } from "./cjk-linebreak";

const cjk = (text: string, width = 1): MeasurableAtom[] =>
  [...text].map((character) => ({ value: character, text: character, width }));

describe("Chinese line breaking", () => {
  it("breaks a paragraph when the line is full", () => {
    const lines = breakAtoms(cjk("一二三四五"), 3);
    expect(lines.map((line) => line.map((atom) => atom.value).join(""))).toEqual(["一二三", "四五"]);
  });

  it("keeps a line that exactly fits", () => {
    const lines = breakAtoms(cjk("一二三"), 3);
    expect(lines).toHaveLength(1);
  });

  it("does not start a line with closing punctuation", () => {
    // The comma would be the first character of the second line, so it hangs
    // at the end of the line that filled up instead.
    const lines = breakAtoms(cjk("一二，三四"), 2);
    expect(lines[0]!.map((atom) => atom.value).join("")).toBe("一二，");
    expect(lines[1]!.map((atom) => atom.value).join("")).toBe("三四");
  });

  it("hangs the closing punctuation into the margin instead of pushing it down", () => {
    // The comma may not start a line, so it stays on the line that filled up
    // and overhangs the margin by its own width.
    const lines = breakAtoms(cjk("一二，三"), 2);
    expect(lines[0]!.map((atom) => atom.value).join("")).toBe("一二，");
    expect(lines[1]!.map((atom) => atom.value).join("")).toBe("三");
  });

  it("does not end a line with opening punctuation", () => {
    const lines = breakAtoms(cjk("一二（三四）"), 3);
    expect(lines[0]!.map((atom) => atom.value).join("")).toBe("一二");
    expect(lines[1]!.map((atom) => atom.value).join("")).toBe("（三四）");
  });

  it("keeps a Latin word on one line", () => {
    const atoms: MeasurableAtom[] = [
      ...cjk("见 "),
      { value: "P", text: "P", width: 0.6 },
      { value: "P", text: "P", width: 0.6 },
      { value: "T", text: "T", width: 0.6 },
    ];
    const lines = breakAtoms(atoms, 2);
    expect(lines.map((line) => line.map((atom) => atom.value).join(""))).toEqual(["见 ", "PPT"]);
  });

  it("splits a Latin word that cannot fit on a line of its own", () => {
    const atoms: MeasurableAtom[] = [
      { value: "A", text: "A", width: 0.6 },
      { value: "B", text: "B", width: 0.6 },
      { value: "C", text: "C", width: 0.6 },
    ];
    const lines = breakAtoms(atoms, 1.3);
    expect(lines.map((line) => line.map((atom) => atom.value).join(""))).toEqual(["AB", "C"]);
  });

  it("shows a character that is wider than the line", () => {
    const lines = breakAtoms(cjk("一"), 0.1);
    expect(lines.map((line) => line.map((atom) => atom.value).join(""))).toEqual(["一"]);
  });

  it("never produces an empty line", () => {
    const lines = breakAtoms(cjk("一二三四五"), 1);
    expect(lines.every((line) => line.length > 0)).toBe(true);
  });

  it("keeps the line break of the copy", () => {
    const lines = breakIntoLines("一\n二", { widthEm: 10, widthOf: () => 1 });
    expect(lines).toEqual(["一", "二"]);
  });

  it("reports an empty paragraph as one line", () => {
    const lines = breakIntoLines("一\n\n二", { widthEm: 10, widthOf: () => 1 });
    expect(lines).toEqual(["一", "", "二"]);
  });
});
