import { beforeEach, describe, expect, it } from "vitest";
import { useFormatPainterStore } from "./format-painter";

describe("format painter store", () => {
  beforeEach(() => {
    useFormatPainterStore.setState({ style: undefined, locked: false });
  });

  it("clears a single-use brush after one application", () => {
    useFormatPainterStore.getState().copy({ italic: true, fontSizePt: 20 });
    expect(useFormatPainterStore.getState().style).toMatchObject({ italic: true });
    useFormatPainterStore.getState().consume();
    expect(useFormatPainterStore.getState().style).toBeUndefined();
  });

  it("keeps a locked brush until it is cancelled", () => {
    useFormatPainterStore.getState().copy({ italic: true }, true);
    useFormatPainterStore.getState().consume();
    expect(useFormatPainterStore.getState().style).toMatchObject({ italic: true });
    useFormatPainterStore.getState().cancel();
    expect(useFormatPainterStore.getState().style).toBeUndefined();
    expect(useFormatPainterStore.getState().locked).toBe(false);
  });
});
