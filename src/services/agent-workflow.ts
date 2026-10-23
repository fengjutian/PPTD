export type AgentWorkflowStage =
  | "idle"
  | "checking"
  | "planning"
  | "generating-content"
  | "reviewing-content"
  | "generating-design"
  | "deterministic-quality"
  | "visual-review"
  | "repairing"
  | "ready-to-export"
  | "exporting"
  | "complete"
  | "cancelled"
  | "failed";

export interface AgentWorkflowState {
  runId: number;
  stage: AgentWorkflowStage;
  label: string;
  startedAt?: number;
  updatedAt: number;
  error?: string;
}

const transitions: Readonly<Record<AgentWorkflowStage, readonly AgentWorkflowStage[]>> = {
  idle: ["checking"],
  checking: ["planning", "cancelled", "failed"],
  planning: ["generating-content", "generating-design", "cancelled", "failed"],
  "generating-content": ["reviewing-content", "cancelled", "failed"],
  "reviewing-content": ["generating-design", "cancelled"],
  "generating-design": ["deterministic-quality", "visual-review", "cancelled", "failed"],
  "deterministic-quality": ["visual-review", "ready-to-export", "cancelled", "failed"],
  "visual-review": ["repairing", "deterministic-quality", "ready-to-export", "cancelled", "failed"],
  repairing: ["visual-review", "deterministic-quality", "cancelled", "failed"],
  "ready-to-export": ["exporting", "checking"],
  exporting: ["complete", "cancelled", "failed"],
  complete: ["checking"],
  cancelled: ["checking"],
  failed: ["checking"],
};

const labels: Readonly<Record<AgentWorkflowStage, string>> = {
  idle: "等待开始",
  checking: "检查运行条件",
  planning: "解析输入并规划任务",
  "generating-content": "生成结构化内容",
  "reviewing-content": "等待内容审核",
  "generating-design": "生成视觉设计",
  "deterministic-quality": "执行确定性质检",
  "visual-review": "执行整册与逐页视觉评审",
  repairing: "修复已授权的问题页",
  "ready-to-export": "文稿可编辑、可导出",
  exporting: "导出不可变文档快照",
  complete: "工作流完成",
  cancelled: "工作流已取消",
  failed: "工作流失败",
};

export function initialAgentWorkflow(now = Date.now()): AgentWorkflowState {
  return { runId: 0, stage: "idle", label: labels.idle, updatedAt: now };
}

export function startAgentWorkflow(previous: AgentWorkflowState, now = Date.now()): AgentWorkflowState {
  return { runId: previous.runId + 1, stage: "checking", label: labels.checking, startedAt: now, updatedAt: now };
}

export function transitionAgentWorkflow(
  previous: AgentWorkflowState,
  stage: AgentWorkflowStage,
  options: { label?: string; error?: string; now?: number } = {},
): AgentWorkflowState {
  if (previous.stage !== stage && !transitions[previous.stage].includes(stage)) {
    throw new Error(`AGENT_WORKFLOW_INVALID_TRANSITION:${previous.stage}->${stage}`);
  }
  const now = options.now ?? Date.now();
  return {
    ...previous,
    stage,
    label: options.label ?? labels[stage],
    updatedAt: now,
    ...(options.error ? { error: options.error } : { error: undefined }),
  };
}

export function canTransitionAgentWorkflow(from: AgentWorkflowStage, to: AgentWorkflowStage): boolean {
  return from === to || transitions[from].includes(to);
}
