import { apiClient } from "./client";

export interface AutomationPolicy {
  paused: boolean;
  per_source_daily_capture_limit: number;
  daily_token_limit: number;
  excluded_cloud_folders: string[];
  excluded_cloud_tags: string[];
  retain_raw_traces: boolean;
  provider_prices_per_1k: Record<string, number>;
}

export interface PolicyUsage {
  day: string;
  captures_by_source: Record<string, number>;
  tokens_by_provider: Record<
    string,
    {
      tokens: number;
      estimated: boolean;
      input_tokens?: number;
      output_tokens?: number;
    }
  >;
  total_tokens: number;
  estimated_cost_by_provider?: Record<string, number>;
  priced_total?: number | null;
}

export interface PolicyResponse {
  policy: AutomationPolicy;
  usage: PolicyUsage;
}

export const getPolicy = () => apiClient.get<PolicyResponse>("/api/policy");
export const savePolicy = (policy: AutomationPolicy) =>
  apiClient.patch<PolicyResponse>("/api/policy", policy);
