import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlideId } from "../../core/document-model";
import { TransitionControls } from "./TransitionControls";

const slideId = "cccccccc-cccc-9ccc-8ccc-cccccccccccc" as SlideId;

describe("transition controls", () => {
  it("offers the transition kinds and hides direction when there is none", () => {
    const markup = renderToStaticMarkup(
      <TransitionControls slideId={slideId} transition={undefined} onCommand={() => undefined} />,
    );
    expect(markup).toContain("切换效果");
    expect(markup).toContain("淡入淡出");
    expect(markup).toContain("推进");
    expect(markup).not.toContain("方向");
    expect(markup).not.toContain("速度");
  });

  it("shows speed and direction for a directional transition", () => {
    const markup = renderToStaticMarkup(
      <TransitionControls
        slideId={slideId}
        transition={{ kind: "push", speed: "slow", direction: "right" }}
        onCommand={() => undefined}
      />,
    );
    expect(markup).toContain("速度");
    expect(markup).toContain("方向");
    expect(markup).toContain("慢速");
    expect(markup).toContain("右");
  });
});
