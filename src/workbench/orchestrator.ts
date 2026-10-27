import { callPptWorkbench, type PptWorkbench } from "./ppt-workbench";
import type { WorkbenchIssue, WorkbenchToolDefinition } from "./contracts";
import type { AiLayoutProgram } from "./layout/layout-program";

export interface WorkbenchTranscriptEntry {
  readonly name: string;
  readonly input: unknown;
  readonly result:
    { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly WorkbenchIssue[] };
}

export type WorkbenchModelTurn =
  | { readonly kind: "tool-call"; readonly name: string; readonly input: unknown }
  | { readonly kind: "final"; readonly output: unknown };

export interface WorkbenchTurnRequest {
  readonly tools: readonly WorkbenchToolDefinition[];
  readonly transcript: readonly WorkbenchTranscriptEntry[];
  /** Current validated program, not a reconstruction from the transcript. */
  readonly layoutProgram: AiLayoutProgram;
  readonly turn: number;
}

export type WorkbenchTurnTransport = (request: WorkbenchTurnRequest) => Promise<WorkbenchModelTurn>;

export interface WorkbenchLoopResult {
  readonly workbench: PptWorkbench;
  readonly output: unknown;
  readonly transcript: readonly WorkbenchTranscriptEntry[];
}

export async function runPptWorkbenchLoop(input: {
  workbench: PptWorkbench;
  tools: readonly WorkbenchToolDefinition[];
  transport: WorkbenchTurnTransport;
  maxTurns?: number;
  isCancelled?: () => boolean;
}): Promise<WorkbenchLoopResult> {
  const maxTurns = input.maxTurns ?? 12;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 24) throw new Error("AI_WORKBENCH_TURN_LIMIT_INVALID");

  let workbench = input.workbench;
  const transcript: WorkbenchTranscriptEntry[] = [];
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (input.isCancelled?.()) throw new Error("AI_GENERATION_CANCELLED");
    const action = await input.transport({
      tools: input.tools,
      transcript,
      layoutProgram: workbench.layout.program,
      turn,
    });
    if (action.kind === "final") return { workbench, output: action.output, transcript };

    const called = callPptWorkbench(workbench, action.name, action.input);
    workbench = called.workbench;
    transcript.push({
      name: action.name,
      input: action.input,
      result: called.ok ? { ok: true, value: called.value } : { ok: false, issues: called.issues },
    });
  }
  throw new Error("AI_WORKBENCH_TURN_LIMIT_EXCEEDED");
}
