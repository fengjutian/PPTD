export interface WorkbenchToolDefinition<TName extends string = string> {
  readonly name: TName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface WorkbenchIssue {
  readonly code: string;
  readonly paths: readonly string[];
  readonly message: string;
}

export type WorkbenchCallResult<TWorkbench, TValue = unknown> =
  | { readonly ok: true; readonly workbench: TWorkbench; readonly value: TValue }
  | { readonly ok: false; readonly workbench: TWorkbench; readonly issues: readonly WorkbenchIssue[] };
