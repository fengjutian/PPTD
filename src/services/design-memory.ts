/**
 * Local design memory.
 *
 * It remembers two things and nothing else: the look of recent decks (palette,
 * font pair, concept, page count) and the user's own words about taste. It never
 * stores reviewed copy, notes, images or model responses. Everything stays in
 * the local SQLite database; there is no upload path.
 *
 * The memory only biases the direction proposal (avoid repeating a look) and is
 * never allowed to silently change a theme or an applied design.
 */

import type { PresentationDocument } from "../core/document-model";
import type { DesignDirectionRecord } from "../core/document-model";
import {
  clearStoredDesignMemory,
  loadStoredDesignMemory,
  removeStoredDesignMemory,
  saveStoredDesignMemory,
  type StoredDesignMemoryEntry,
} from "./app-database";

export interface DesignLook {
  themePresetId?: string;
  palette: string[];
  fonts: { major: string; minor: string };
  concept: string;
  pageCount: number;
  createdAt: number;
}

export interface DesignPreference {
  id: string;
  text: string;
  scope: string;
  createdAt: number;
}

export interface DesignMemorySummary {
  decks: number;
  preferences: number;
}

/** The look of a deck, derived from its design state only. */
export function designLookFromDocument(
  document: PresentationDocument,
  direction?: DesignDirectionRecord,
  themePresetId?: string,
): Omit<DesignLook, "createdAt"> {
  const selected = direction?.proposals.find((proposal) => proposal.id === direction.selectedProposalId);
  const colors = (document.theme?.colors ?? [])
    .map((color) => color.value)
    .filter((value) => /^#[0-9a-f]{6}$/i.test(value));
  return {
    ...(themePresetId ? { themePresetId } : {}),
    palette: [...new Set(colors)].slice(0, 8),
    fonts: {
      major: document.theme?.majorFont ?? "",
      minor: document.theme?.minorFont ?? "",
    },
    concept: selected?.preset ?? "editorial",
    pageCount: document.slides.length,
  };
}

export async function recordDesignLook(input: {
  document: PresentationDocument;
  direction?: DesignDirectionRecord;
  themePresetId?: string;
}): Promise<void> {
  const look = designLookFromDocument(input.document, input.direction, input.themePresetId);
  await saveStoredDesignMemory({
    id: crypto.randomUUID(),
    kind: "deck",
    scope: "deck",
    payload: { ...look },
    createdAt: Date.now(),
  });
}

export async function recordDesignPreference(text: string, scope = "deck"): Promise<void> {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;
  await saveStoredDesignMemory({
    id: crypto.randomUUID(),
    kind: "preference",
    scope: scope.slice(0, 64) || "deck",
    payload: { text: trimmed },
    createdAt: Date.now(),
  });
}

/** Recent looks, most recent first. Empty on a browser preview or a read error. */
export async function loadRecentLooks(limit = 3): Promise<DesignLook[]> {
  let entries: StoredDesignMemoryEntry[];
  try {
    entries = await loadStoredDesignMemory();
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.kind === "deck")
    .slice(0, limit)
    .map((entry) => ({
      ...(typeof entry.payload.themePresetId === "string" ? { themePresetId: entry.payload.themePresetId } : {}),
      palette: stringArray(entry.payload.palette).slice(0, 8),
      fonts: {
        major:
          typeof entry.payload.fonts === "object" && entry.payload.fonts
            ? String((entry.payload.fonts as { major?: unknown }).major ?? "")
            : "",
        minor:
          typeof entry.payload.fonts === "object" && entry.payload.fonts
            ? String((entry.payload.fonts as { minor?: unknown }).minor ?? "")
            : "",
      },
      concept: typeof entry.payload.concept === "string" ? entry.payload.concept : "editorial",
      pageCount: typeof entry.payload.pageCount === "number" ? entry.payload.pageCount : 0,
      createdAt: entry.createdAt,
    }));
}

export async function loadDesignPreferences(limit = 20): Promise<DesignPreference[]> {
  let entries: StoredDesignMemoryEntry[];
  try {
    entries = await loadStoredDesignMemory();
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.kind === "preference")
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      text: typeof entry.payload.text === "string" ? entry.payload.text : "",
      scope: entry.scope,
      createdAt: entry.createdAt,
    }))
    .filter((preference) => preference.text.length > 0);
}

export async function designMemorySummary(): Promise<DesignMemorySummary> {
  try {
    const entries = await loadStoredDesignMemory();
    return {
      decks: entries.filter((entry) => entry.kind === "deck").length,
      preferences: entries.filter((entry) => entry.kind === "preference").length,
    };
  } catch {
    return { decks: 0, preferences: 0 };
  }
}

/**
 * The direction this user has chosen most often in recent decks.
 *
 * Two picks are the minimum: a single deck is an anecdote, not a habit. Ties
 * return undefined so the gate does not pretend to know.
 */
export async function recommendedConceptPreset(): Promise<"editorial" | "documentary" | undefined> {
  const looks = await loadRecentLooks(5);
  const counts = new Map<"editorial" | "documentary", number>();
  for (const look of looks) {
    if (look.concept !== "editorial" && look.concept !== "documentary") continue;
    counts.set(look.concept, (counts.get(look.concept) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].filter(([, count]) => count >= 2).sort((left, right) => right[1] - left[1]);
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return undefined;
  return ranked[0]![0];
}

export async function removeDesignMemory(id: string): Promise<void> {
  await removeStoredDesignMemory(id);
}

export async function clearDesignMemory(): Promise<void> {
  await clearStoredDesignMemory();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
