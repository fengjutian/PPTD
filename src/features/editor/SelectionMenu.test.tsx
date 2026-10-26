import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SelectionMenu } from "./SelectionMenu";

function trigger(markup: string): string {
  return markup.match(/<button[^>]*aria-label="选择"[^>]*>/)?.[0] ?? "";
}

describe("selection menu", () => {
  it("opens from a labelled select button", () => {
    const markup = renderToStaticMarkup(
      <SelectionMenu
        canSelectAll
        hasSelection
        selectionPaneOpen={false}
        onSelectAll={() => undefined}
        onClearSelection={() => undefined}
        onOpenSelectionPane={() => undefined}
      />,
    );
    expect(trigger(markup)).toContain('aria-haspopup="menu"');
    expect(trigger(markup)).toContain('aria-expanded="false"');
  });

  it("shows the pane as pressed while the layer panel is open", () => {
    const markup = renderToStaticMarkup(
      <SelectionMenu
        canSelectAll
        hasSelection={false}
        selectionPaneOpen
        onSelectAll={() => undefined}
        onClearSelection={() => undefined}
        onOpenSelectionPane={() => undefined}
      />,
    );
    expect(trigger(markup)).toContain('aria-pressed="true"');
  });
});
