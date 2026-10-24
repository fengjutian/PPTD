/**
 * Prompt regression fixtures.
 *
 * These are recorded model-shaped outputs, not live calls. They lock the
 * contract around the prompts: when a schema, normalizer or prompt version
 * changes, one of these cases fails instead of silently accepting a different
 * product behavior.
 *
 * Add a fixture whenever a real model output exposes a new failure mode; keep
 * the input in the model's shape, not in the normalized shape.
 */

import { describe, expect, it } from "vitest";
import directionFixtures from "./__fixtures__/prompt-regression/direction.json";
import designFixtures from "./__fixtures__/prompt-regression/design.json";
import relationFixtures from "./__fixtures__/prompt-regression/data-relation.json";
import reviewFixtures from "./__fixtures__/prompt-regression/visual-review.json";
import { DESIGN_DIRECTIONS_PROMPT_VERSION, aiDeckDirectionsSchema, aiPresentationDesignSchema } from "./ai-service";
import { normalizeVisualReview } from "./visual-alignment";
import { resolveChartKind, type DataRelation } from "../core/design/data-relation";
import type { ChartKind } from "../core/document-model";

describe("prompt regression fixtures", () => {
  it("pins the direction prompt version", () => {
    // A prompt edit must bump DESIGN_DIRECTIONS_PROMPT_VERSION and the fixture
    // together. Otherwise recorded outputs no longer describe the prompt.
    expect(directionFixtures.promptVersion).toBe(DESIGN_DIRECTIONS_PROMPT_VERSION);
  });

  it.each(directionFixtures.cases)("direction case: $name", (fixture) => {
    const result = aiDeckDirectionsSchema.safeParse(fixture.output);
    expect(result.success).toBe(fixture.expect === "accepted");
  });

  it.each(reviewFixtures.cases)("review case: $name", (fixture) => {
    const result = normalizeVisualReview(fixture.input, [0]);
    expect(result.overallScore).toBe(fixture.expected.overallScore);
    expect(result.conceptCapApplied).toBe(fixture.expected.conceptCapApplied);
  });

  it.each(designFixtures.cases)("design case: $name", (fixture) => {
    const result = aiPresentationDesignSchema.safeParse(fixture.output);
    expect(result.success).toBe(fixture.expect === "accepted");
  });

  it.each(relationFixtures.cases)("data relation case: $name", (fixture) => {
    const kind = resolveChartKind({
      relation: fixture.relation as DataRelation | undefined,
      requestedKind: fixture.requestedKind as ChartKind | undefined,
      pointCount: fixture.pointCount,
    });
    expect(kind).toBe(fixture.expectedKind);
  });
});
