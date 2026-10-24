import { describe, expect, it } from "vitest";
import { emu, inches } from "../document-model";
import { planPageChrome } from "./page-chrome";

const page = { width: inches(13.333), height: inches(7.5) };

describe("page chrome", () => {
  it("puts the rule below a preset title and above the content", () => {
    const chrome = planPageChrome({
      page,
      title: { x: inches(0.93), y: inches(0.675), width: inches(11.47), height: inches(1.125) },
      content: { x: inches(0.93), y: inches(2.55), width: inches(11.47), height: inches(4.125) },
      safe: { x: 0.07, y: 0.09, width: 0.86, height: 0.8 },
    });
    expect(chrome.title.y).toBeCloseTo(0.09, 3);
    expect(chrome.contentTop).toBeCloseTo(0.34, 3);
    expect(chrome.rule.y).toBeGreaterThan(chrome.title.y + chrome.title.height);
    expect(chrome.rule.y).toBeLessThan(chrome.contentTop);
    expect(chrome.contentBottom).toBeCloseTo(0.89, 3);
  });

  it("keeps the rule inside a short template title bar", () => {
    const chrome = planPageChrome({
      page,
      title: { x: inches(0.63), y: inches(0.2), width: inches(9.7), height: inches(0.4) },
      content: { x: inches(0.63), y: inches(1.52), width: inches(10.9), height: inches(4.26) },
    });
    expect(chrome.title.height).toBeCloseTo(0.053, 3);
    expect(chrome.rule.y).toBeGreaterThan(chrome.title.y);
    expect(chrome.rule.y + chrome.rule.height).toBeLessThanOrEqual(chrome.contentTop);
  });

  it("clips the content region to the safe area", () => {
    const chrome = planPageChrome({
      page,
      title: { x: emu(0), y: emu(0), width: page.width, height: inches(1) },
      content: { x: emu(0), y: inches(1.5), width: page.width, height: inches(6) },
      safe: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
    });
    expect(chrome.content.x).toBeCloseTo(0.1, 3);
    expect(chrome.content.y).toBeCloseTo(0.2, 3);
    expect(chrome.content.x + chrome.content.width).toBeCloseTo(0.8, 3);
    expect(chrome.content.y + chrome.content.height).toBeCloseTo(0.7, 3);
  });

  it("marks the header rule visible unless the template owns it", () => {
    const input = {
      page,
      title: { x: inches(0.93), y: inches(0.675), width: inches(11.47), height: inches(1.125) },
      content: { x: inches(0.93), y: inches(2.55), width: inches(11.47), height: inches(4.125) },
    };
    expect(planPageChrome(input).showRule).toBe(true);
    expect(planPageChrome({ ...input, showRule: false }).showRule).toBe(false);
  });

  it("is deterministic", () => {
    const input = {
      page,
      title: { x: inches(0.93), y: inches(0.675), width: inches(11.47), height: inches(1.125) },
      content: { x: inches(0.93), y: inches(2.55), width: inches(11.47), height: inches(4.125) },
    };
    expect(planPageChrome(input)).toEqual(planPageChrome(input));
  });
});
