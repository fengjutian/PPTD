import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument } from "../document-model";

function animation(effect: "fade" | "pulse" | "disappear") {
  return {
    effect,
    start: "on-click" as const,
    durationMs: 600,
    delayMs: 0,
    direction: "none" as const,
  };
}

describe("animation effects and phases", () => {
  it("derives the phase from the effect instead of trusting the caller", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const elementId = slide.elements[0]!.id;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId,
      animation: animation("pulse"),
    });
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId,
      animation: animation("disappear"),
    });
    expect(slide.animations!.map((item) => item.phase)).toEqual(["emphasis", "exit"]);
  });

  it("updates the phase when the effect changes", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const elementId = slide.elements[0]!.id;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId,
      animation: animation("pulse"),
    });
    const animationId = slide.animations![0]!.id;
    applyCommand(document, {
      type: "set-animation",
      slideId: slide.id,
      animationId,
      changes: { effect: "fade" },
    });
    expect(slide.animations![0]).toMatchObject({ effect: "fade", phase: "entrance" });
  });

  it("duplicates an animation right after its source with a fresh id", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const elementId = slide.elements[0]!.id;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId,
      animation: animation("fade"),
    });
    const source = slide.animations![0]!;
    applyCommand(document, { type: "duplicate-animation", slideId: slide.id, animationId: source.id });
    expect(slide.animations).toHaveLength(2);
    expect(slide.animations![1]!.id).not.toBe(source.id);
    expect(slide.animations![1]).toMatchObject({ effect: "fade", phase: "entrance", elementId });
    expect(commandDomain({ type: "duplicate-animation", slideId: slide.id, animationId: source.id })).toBe("design");
  });

  it("refuses to duplicate an animation on a locked object", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const elementId = slide.elements[0]!.id;
    applyCommand(document, {
      type: "add-animation",
      slideId: slide.id,
      elementId,
      animation: animation("fade"),
    });
    const animationId = slide.animations![0]!.id;
    slide.elements[0]!.locked = true;
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, { type: "duplicate-animation", slideId: slide.id, animationId }),
      ),
    ).toThrow("ELEMENT_LOCKED");
  });
});
