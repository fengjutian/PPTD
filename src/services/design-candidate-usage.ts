/**
 * Local usage counters for the session-only “换一版” prototype.
 *
 * The point of the prototype is to decide whether a persisted design snapshot
 * is worth the schema work. That decision needs a number, not a feeling, so the
 * entry point records how often it opens, how often a candidate is kept, and
 * how often it is closed without a pick.
 *
 * Only counts and recipe ids are stored. No titles, body copy, page ids or
 * document content ever enter this store; it belongs to the window, not to the
 * project, and it must remain safe to inspect or clear.
 */
export interface DesignCandidateUsage {
  opened: number;
  picked: number;
  abandoned: number;
  noContext: number;
  edited: number;
  noPlan: number;
  /** How often each recipe was actually kept. */
  recipes: Record<string, number>;
}

const STORAGE_KEY = "pptd.design-candidate-usage.v1";

const EMPTY: DesignCandidateUsage = {
  opened: 0,
  picked: 0,
  abandoned: 0,
  noContext: 0,
  edited: 0,
  noPlan: 0,
  recipes: {},
};

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function parseUsage(raw: string | null): DesignCandidateUsage {
  if (!raw) return { ...EMPTY, recipes: {} };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return { ...EMPTY, recipes: {} };
    const record = value as Record<string, unknown>;
    const recipes: Record<string, number> = {};
    if (typeof record.recipes === "object" && record.recipes !== null) {
      for (const [recipe, count] of Object.entries(record.recipes)) {
        const pages = nonNegative(count);
        if (pages > 0) recipes[recipe] = pages;
      }
    }
    return {
      opened: nonNegative(record.opened),
      picked: nonNegative(record.picked),
      abandoned: nonNegative(record.abandoned),
      noContext: nonNegative(record.noContext),
      edited: nonNegative(record.edited),
      noPlan: nonNegative(record.noPlan),
      recipes,
    };
  } catch {
    // A corrupt counter is disposable; losing it must never break the picker.
    return { ...EMPTY, recipes: {} };
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadDesignCandidateUsage(): DesignCandidateUsage {
  const store = storage();
  if (!store) return { ...EMPTY, recipes: {} };
  try {
    return parseUsage(store.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY, recipes: {} };
  }
}

export type DesignCandidateUsageEvent =
  | { kind: "opened" }
  | { kind: "picked"; recipe: string }
  | { kind: "abandoned" }
  | { kind: "no-context" }
  | { kind: "edited" }
  | { kind: "no-plan" };

/**
 * Updates one counter and returns the new totals.
 *
 * Storage failures are swallowed: usage is diagnostic evidence, never a
 * precondition for opening or applying a candidate.
 */
export function recordDesignCandidateEvent(event: DesignCandidateUsageEvent): DesignCandidateUsage {
  const usage = loadDesignCandidateUsage();
  switch (event.kind) {
    case "opened":
      usage.opened += 1;
      break;
    case "picked":
      usage.picked += 1;
      usage.recipes[event.recipe] = (usage.recipes[event.recipe] ?? 0) + 1;
      break;
    case "abandoned":
      usage.abandoned += 1;
      break;
    case "no-context":
      usage.noContext += 1;
      break;
    case "edited":
      usage.edited += 1;
      break;
    case "no-plan":
      usage.noPlan += 1;
      break;
  }
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(usage));
    } catch {
      // Private mode or a full quota: the in-memory result is still returned.
    }
  }
  return usage;
}
