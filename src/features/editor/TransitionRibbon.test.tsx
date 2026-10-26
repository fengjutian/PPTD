import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SlideId } from "../../core/document-model";
import { TransitionRibbon } from "./TransitionRibbon";

const slideId = "aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa" as SlideId;

describe("transition ribbon", () => {
  it("offers the transition kinds and hides timing when there is none", () => {
    const markup = renderToStaticMarkup(
      <TransitionRibbon slideId={slideId} transition={undefined} onCommand={() => undefined} />,
    );
    expect(markup).toContain("页面切换效果");
    expect(markup).toContain("淡入淡出");
    expect(markup).toContain("推进");
    expect(markup).not.toContain("页面切换速度");
    expect(markup).not.toContain("页面切换方向");
  });

  it("shows speed and direction for a directional transition", () => {
    const markup = renderToStaticMarkup(
      <TransitionRibbon
        slideId={slideId}
        transition={{ kind: "push", speed: "slow", direction: "right" }}
        onCommand={() => undefined}
      />,
    );
    expect(markup).toContain("页面切换速度");
    expect(markup).toContain("页面切换方向");
    expect(markup).toContain("慢速");
    expect(markup).toContain("右");
  });
});
