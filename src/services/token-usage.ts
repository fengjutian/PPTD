import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TokenUsageStats {
  requestCount: number;
  reportedRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const emptyTokenUsageStats = (): TokenUsageStats => ({
  requestCount: 0,
  reportedRequestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

export async function loadTokenUsageStats(): Promise<TokenUsageStats> {
  if (!isTauri()) return emptyTokenUsageStats();
  return invoke<TokenUsageStats>("token_usage_stats");
}

export async function clearTokenUsageStats(): Promise<TokenUsageStats> {
  if (!isTauri()) return emptyTokenUsageStats();
  return invoke<TokenUsageStats>("clear_token_usage_stats");
}
