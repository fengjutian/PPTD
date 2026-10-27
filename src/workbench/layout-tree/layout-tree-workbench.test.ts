import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/document-model";
import { callLayoutTreeWorkbench, createLayoutTreeWorkbench } from "./layout-tree-workbench";

describe("layout tree workbench", () => {
  it("keeps repeated calls idempotent and rejects stale draft revisions", () => {
    const created = createLayoutTreeWorkbench(createDocument());
    const body = created.definition.tree.root.children[1]!;
    const input = { callId: "call-1", draftRevision: 0, nodeId: body.id, patch: { height: { mode: "fraction", weight: 5 } } };
    const first = callLayoutTreeWorkbench(created, "layout.node.update", input);
    expect(first.ok).toBe(true);
    const repeated = callLayoutTreeWorkbench(first.workbench, "layout.node.update", input);
    expect(repeated.ok).toBe(true);
    expect(repeated.workbench.draftRevision).toBe(1);
    const stale = callLayoutTreeWorkbench(first.workbench, "layout.node.update", { ...input, callId: "call-2" });
    expect(stale).toMatchObject({ ok: false, issues: [{ code: "DRAFT_REVISION_CONFLICT" }] });
  });

  it("returns a proposal that requires an explicit confirmation", () => {
    const created = createLayoutTreeWorkbench(createDocument());
    const result = callLayoutTreeWorkbench(created, "layout.plan.inspect", {});
    expect(result).toMatchObject({ ok: true, value: { baseline: { document: 0 }, unresolvedIssues: [] } });
  });
});
