import { describe, expect, it } from "vitest";

import { shouldAutoDismissPageMessage, type PageMessage } from "./app-shared";

function message(kind: PageMessage["kind"]): PageMessage {
  return { id: 1, text: "测试消息", kind };
}

describe("page message lifetime", () => {
  it("keeps errors visible until the user closes them", () => {
    expect(shouldAutoDismissPageMessage(message("error"))).toBe(false);
  });

  it.each(["info", "success"] as const)("allows %s messages to expire", (kind) => {
    expect(shouldAutoDismissPageMessage(message(kind))).toBe(true);
  });
});
