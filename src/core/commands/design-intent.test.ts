import { describe, expect, it } from "vitest";
import { DENSITY_FACTORS, EMPHASIS_FACTORS, autoComposition, detectPullQuote, isCompositionLegal, resolvePageDesign, type CompositionFacts } from "./design-intent";
import { LAYOUT_CAPACITY } from "./layout-capacity";

const facts = (overrides: Partial<CompositionFacts> = {}): CompositionFacts => ({
  itemCount: 4,
  shortItems: true,
  longestItemLength: 20,
  bodyLength: 80,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "title-body",
  ...overrides,
});

describe("composition intent", () => {
  it("draws the page the renderer used to draw when the model chooses nothing", () => {
    // A title page with short points became a card grid.
    expect(autoComposition(facts())).toBe("grid");
    // A title page with long points became a single numbered column.
    expect(autoComposition(facts({ shortItems: false }))).toBe("stacked");
    // A page with two points stayed a single column.
    expect(autoComposition(facts({ itemCount: 2 }))).toBe("stacked");
    // A split page with three short points became an editorial page.
    expect(autoComposition(facts({ itemCount: 3, layout: "split" }))).toBe("editorial");
    // A split page with two points stayed a two column page.
    expect(autoComposition(facts({ itemCount: 2, layout: "split" }))).toBe("columns");
    // A split page with six short points became a card grid.
    expect(autoComposition(facts({ itemCount: 6, layout: "split" }))).toBe("grid");
    // A card page always became a grid, even with long points.
    expect(autoComposition(facts({ itemCount: 4, shortItems: false, layout: "cards" }))).toBe("grid");
    // A card page with more points than a grid can carry became two columns.
    expect(autoComposition(facts({ itemCount: 7, layout: "cards" }))).toBe("columns");
  });

  it("falls back to the composition of the layout when an editorial page does not fit", () => {
    expect(autoComposition(facts({ itemCount: 3, layout: "split" }), { allowEditorial: false })).toBe("columns");
    expect(autoComposition(facts({ itemCount: 3, layout: "summary" }), { allowEditorial: false })).toBe("grid");
    expect(autoComposition(facts({ itemCount: 3, layout: "cards" }), { allowEditorial: false })).toBe("grid");
  });

  it("applies a composition the content can carry", () => {
    const resolved = resolvePageDesign({ composition: "editorial", facts: facts({ itemCount: 4 }) });
    expect(resolved.composition).toBe("editorial");
    expect(resolved.conflicts).toHaveLength(0);
  });

  it("refuses a composition the content cannot carry and says why", () => {
    const resolved = resolvePageDesign({ composition: "grid", facts: facts({ itemCount: 8, longestItemLength: 20 }) });
    expect(resolved.composition).not.toBe("grid");
    expect(resolved.conflicts).toHaveLength(1);
    expect(resolved.conflicts[0]!.intent).toBe("composition=grid");
    expect(resolved.conflicts[0]!.reason).toContain(String(LAYOUT_CAPACITY.cardsMaxItems));
  });

  it("refuses a composition that would drop points of the page", () => {
    const resolved = resolvePageDesign({ composition: "editorial", facts: facts({ itemCount: 2 }) });
    expect(resolved.composition).not.toBe("editorial");
    expect(resolved.conflicts[0]!.reason).toContain("2");
  });

  it("refuses every composition on a page that carries a structured block", () => {
    expect(isCompositionLegal("grid", facts({ hasRowBlock: true }))).toBe(false);
    expect(isCompositionLegal("auto", facts({ hasComparison: true }))).toBe(true);
    const resolved = resolvePageDesign({ composition: "grid", facts: facts({ hasRowBlock: true }) });
    expect(resolved.conflicts).toHaveLength(1);
  });

  it("keeps the emphasis and the density the model asked for", () => {
    const resolved = resolvePageDesign({ emphasis: "title-dominant", densityTarget: "airy", facts: facts() });
    expect(resolved.emphasis).toBe("title-dominant");
    expect(resolved.density).toBe("airy");
  });
});

describe("hierarchy and density factors", () => {
  it("scales the title up and the body down for a title dominant page", () => {
    expect(EMPHASIS_FACTORS["title-dominant"].title).toBeGreaterThan(1);
    expect(EMPHASIS_FACTORS["title-dominant"].body).toBeLessThan(1);
  });

  it("scales the title down and the body up for a body dominant page", () => {
    expect(EMPHASIS_FACTORS["body-dominant"].title).toBeLessThan(1);
    expect(EMPHASIS_FACTORS["body-dominant"].body).toBeGreaterThan(1);
  });

  it("leaves a balanced page alone", () => {
    expect(EMPHASIS_FACTORS.balanced).toEqual({ title: 1, body: 1 });
    expect(DENSITY_FACTORS.balanced.gap).toBe(1);
  });

  it("spends more space on an airy page than on a compact one", () => {
    expect(DENSITY_FACTORS.airy.gap).toBeGreaterThan(DENSITY_FACTORS.balanced.gap);
    expect(DENSITY_FACTORS.compact.gap).toBeLessThan(DENSITY_FACTORS.balanced.gap);
  });
});

describe("pull quote detection", () => {
  it("prefers the quote block of the page", () => {
    expect(detectPullQuote({ quoteText: "这是一段足够长的引文", items: ["短要点"] })).toBe("这是一段足够长的引文");
  });

  it("falls back to a quoted line of the reviewed copy", () => {
    expect(detectPullQuote({ items: ["短要点", "“被引用的这句话足够长”"] })).toBe("“被引用的这句话足够长”");
  });

  it("invents nothing when the page carries no quotation", () => {
    expect(detectPullQuote({ items: ["普通要点", "另一条普通要点"] })).toBeUndefined();
  });

  it("ignores a quote that is too short to carry a panel", () => {
    expect(detectPullQuote({ quoteText: "短", items: [] })).toBeUndefined();
  });
});
