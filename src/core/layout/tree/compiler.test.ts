import { describe, expect, it } from "vitest";
import { layoutRect } from "../geometry/coordinate-system";
import { compileLayoutTree } from "./compiler";
import { parseLayoutTreeDraft } from "./schema";

const ids = {
  root: "11111111-1111-4111-8111-111111111111",
  row: "22222222-2222-4222-8222-222222222222",
  left: "33333333-3333-4333-8333-333333333333",
  right: "44444444-4444-4444-8444-444444444444",
};

const fill = { mode: "fill" as const };

function splitTree(options: { contentSized?: boolean; duplicateId?: boolean; grid?: boolean } = {}): unknown {
  return {
    coordinateSpace: "normalized-1000",
    registryVersion: 1,
    root: {
      id: ids.root,
      type: "canvas",
      width: fill,
      height: fill,
      layoutState: "managed",
      children: [
        {
          id: ids.row,
          type: options.grid ? "grid" : "row",
          width: fill,
          height: fill,
          layoutState: "managed",
          gap: "md",
          ...(options.grid ? { columns: 2 } : {}),
          children: [
            {
              id: ids.left,
              type: "slot",
              role: "body",
              width: options.contentSized ? { mode: "content", min: 100, max: 400 } : { mode: "fraction", weight: 2 },
              height: fill,
              layoutState: "managed",
            },
            {
              id: options.duplicateId ? ids.left : ids.right,
              type: "slot",
              role: "image",
              width: { mode: "fraction", weight: 3 },
              height: fill,
              layoutState: "managed",
            },
          ],
        },
      ],
    },
  };
}

describe("declarative layout tree", () => {
  it("compiles a deterministic 40/60 split with an integer gap", () => {
    const first = compileLayoutTree(splitTree(), layoutRect(0, 0, 1000, 1000));
    const second = compileLayoutTree(splitTree(), layoutRect(0, 0, 1000, 1000));
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) return;
    expect(first.compiled.slots.get(ids.left)).toEqual(layoutRect(0, 0, 390, 1000));
    expect(first.compiled.slots.get(ids.right)).toEqual(layoutRect(414, 0, 586, 1000));
  });

  it("rejects duplicate stable node ids", () => {
    const parsed = parseLayoutTreeDraft(splitTree({ duplicateId: true }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0]?.code).toBe("INVALID_NODE_REFERENCE");
  });

  it("requires a measurement for content-sized children", () => {
    const result = compileLayoutTree(splitTree({ contentSized: true }), layoutRect(0, 0, 1000, 1000));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("MEASURE_UNAVAILABLE");
  });

  it("uses a versioned measurement snapshot for content sizing", () => {
    const result = compileLayoutTree(splitTree({ contentSized: true }), layoutRect(0, 0, 1000, 1000), {
      version: 1,
      measurerId: "test-measurer-v1",
      measurements: { [ids.left]: { width: 280, height: 120 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.slots.get(ids.left)?.width).toBe(280);
    expect(result.compiled.slots.get(ids.right)?.width).toBe(696);
  });

  it("compiles an equal grid without overlap", () => {
    const result = compileLayoutTree(splitTree({ grid: true }), layoutRect(100, 100, 800, 800));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.slots.get(ids.left)).toEqual(layoutRect(100, 100, 388, 800));
    expect(result.compiled.slots.get(ids.right)).toEqual(layoutRect(512, 100, 388, 800));
  });
});
