import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDesignCandidateUsage, recordDesignCandidateEvent } from "./design-candidate-usage";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe("design candidate usage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });

  it("starts empty and records opens without inventing a pick", () => {
    expect(loadDesignCandidateUsage()).toEqual({
      opened: 0,
      picked: 0,
      abandoned: 0,
      noContext: 0,
      edited: 0,
      noPlan: 0,
      recipes: {},
    });

    const usage = recordDesignCandidateEvent({ kind: "opened" });
    expect(usage.opened).toBe(1);
    expect(usage.picked).toBe(0);
    expect(loadDesignCandidateUsage().opened).toBe(1);
  });

  it("counts picks by recipe and keeps the histogram across calls", () => {
    recordDesignCandidateEvent({ kind: "opened" });
    recordDesignCandidateEvent({ kind: "picked", recipe: "editorial-index" });
    const usage = recordDesignCandidateEvent({ kind: "picked", recipe: "editorial-index" });

    expect(usage.picked).toBe(2);
    expect(usage.recipes).toEqual({ "editorial-index": 2 });
  });

  it("separates cancellation, missing context, edited pages and missing plans", () => {
    const usage = [
      recordDesignCandidateEvent({ kind: "abandoned" }),
      recordDesignCandidateEvent({ kind: "no-context" }),
      recordDesignCandidateEvent({ kind: "edited" }),
      recordDesignCandidateEvent({ kind: "no-plan" }),
    ].at(-1)!;

    expect(usage).toMatchObject({ abandoned: 1, noContext: 1, edited: 1, noPlan: 1 });
  });

  it("ignores corrupt or negative counters instead of failing the picker", () => {
    window.localStorage.setItem(
      "pptd.design-candidate-usage.v1",
      JSON.stringify({ opened: -3, picked: "many", recipes: { good: 2, bad: -1 } }),
    );

    expect(loadDesignCandidateUsage()).toEqual({
      opened: 0,
      picked: 0,
      abandoned: 0,
      noContext: 0,
      edited: 0,
      noPlan: 0,
      recipes: { good: 2 },
    });
  });

  it("still returns the in-memory total when storage refuses the write", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QUOTA_EXCEEDED");
        },
      },
    });

    const usage = recordDesignCandidateEvent({ kind: "opened" });
    expect(usage.opened).toBe(1);
  });
});
