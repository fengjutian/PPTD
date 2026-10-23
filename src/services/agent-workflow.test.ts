import { describe, expect, it } from "vitest";
import { initialAgentWorkflow, startAgentWorkflow, transitionAgentWorkflow } from "./agent-workflow";

describe("agent workflow state machine", () => {
  it("tracks content review, design, review repair and export as explicit stages", () => {
    let state = startAgentWorkflow(initialAgentWorkflow(1), 2);
    state = transitionAgentWorkflow(state, "planning", { now: 3 });
    state = transitionAgentWorkflow(state, "generating-content", { now: 4 });
    state = transitionAgentWorkflow(state, "reviewing-content", { now: 5 });
    state = transitionAgentWorkflow(state, "generating-design", { now: 6 });
    state = transitionAgentWorkflow(state, "visual-review", { now: 7 });
    state = transitionAgentWorkflow(state, "repairing", { now: 8 });
    state = transitionAgentWorkflow(state, "visual-review", { now: 9 });
    state = transitionAgentWorkflow(state, "ready-to-export", { now: 10 });
    expect(state.stage).toBe("ready-to-export");
    expect(state.runId).toBe(1);
  });

  it("rejects a stage skip that would hide required review", () => {
    const state = startAgentWorkflow(initialAgentWorkflow());
    expect(() => transitionAgentWorkflow(state, "complete")).toThrow("AGENT_WORKFLOW_INVALID_TRANSITION");
  });

  it("allows a manually edited document to enter the export branch after checks", () => {
    let state = startAgentWorkflow(initialAgentWorkflow());
    state = transitionAgentWorkflow(state, "ready-to-export");
    state = transitionAgentWorkflow(state, "exporting");
    state = transitionAgentWorkflow(state, "complete");
    expect(state.stage).toBe("complete");
  });
});
