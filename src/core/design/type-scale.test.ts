import { describe, expect, it } from "vitest";
import { DEFAULT_TYPE_SCALE, resolveTypeScale } from "./type-scale";
import type { DocumentTheme } from "../document-model";

const theme = (textStyles: DocumentTheme["textStyles"]): DocumentTheme => ({
  name: "测试",
  majorFont: "微软雅黑",
  minorFont: "微软雅黑",
  colors: [],
  textStyles,
});

describe("theme type scale", () => {
  it("falls back to the generator defaults when the theme has no tokens", () => {
    expect(resolveTypeScale(undefined)).toEqual(DEFAULT_TYPE_SCALE);
    expect(resolveTypeScale(theme(undefined))).toEqual(DEFAULT_TYPE_SCALE);
  });

  it("reads the levels the theme declares and derives the section title", () => {
    const scale = resolveTypeScale(theme({
      display: { fontSizePt: 48 },
      title: { fontSizePt: 32 },
      body: { fontSizePt: 16 },
      caption: { fontSizePt: 10 },
    }));
    expect(scale.display).toBe(48);
    expect(scale.title).toBe(32);
    expect(scale.body).toBe(16);
    expect(scale.caption).toBe(10);
    expect(scale.section).toBe(42);
    expect(scale.subtitle).toBe(DEFAULT_TYPE_SCALE.subtitle);
  });

  it("ignores a token outside the printable range", () => {
    const scale = resolveTypeScale(theme({ title: { fontSizePt: 4 }, body: { fontSizePt: 500 } }));
    expect(scale.title).toBe(DEFAULT_TYPE_SCALE.title);
    expect(scale.body).toBe(DEFAULT_TYPE_SCALE.body);
  });
});
