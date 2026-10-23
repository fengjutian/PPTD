import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument } from "../document-model";

describe("set-slide-transition", () => {
  it("sets a page transition as a design change without touching content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const contentBefore = JSON.stringify(slide.content);

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-slide-transition",
        slideId: slide.id,
        transition: { kind: "push", speed: "medium", direction: "left" },
      }),
    );

    expect(result.slides[0]!.transition).toEqual({ kind: "push", speed: "medium", direction: "left" });
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(commandDomain({ type: "set-slide-transition", slideId: slide.id, transition: null })).toBe("design");
  });

  it("clears a transition with null", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    slide.transition = { kind: "fade", speed: "fast" };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-slide-transition", slideId: slide.id, transition: null }),
    );
    expect(result.slides[0]!.transition).toBeUndefined();
  });

  it("rejects an invalid transition instead of writing it", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-slide-transition",
          slideId: slide.id,
          transition: { kind: "spin" as never, speed: "medium" },
        }),
      ),
    ).toThrow("INVALID_SLIDE_TRANSITION");
  });
});
