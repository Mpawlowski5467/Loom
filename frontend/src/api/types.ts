/**
 * Mirror of the backend's pydantic shapes. Keep in sync with
 * ``backend/core/config.py`` and the route response models.
 */

import type { ThemeName } from "../theme/themes";

export type { ThemeName };

export interface ProviderConfigPublic {
  api_key_set: boolean;
  chat_model: string;
  embed_model: string;
  host: string;
}

export interface UIState {
  theme: ThemeName;
}

export interface OnboardingState {
  completed: boolean;
  completed_at: string | null;
  steps_done: string[];
}

export interface LoomConfigPublic {
  active_vault: string;
  default_provider: string;
  providers: Record<string, ProviderConfigPublic>;
  ui: UIState;
  onboarding: OnboardingState;
}

export interface ProvidersResponse {
  default: string;
  providers: Record<string, ProviderConfigPublic>;
  known: string[];
}

export interface ProviderUpsert {
  api_key?: string | null;
  chat_model?: string | null;
  embed_model?: string | null;
  host?: string | null;
}

export interface ProviderTestRequest {
  api_key?: string | null;
  host?: string | null;
}

export interface TestProviderResponse {
  ok: boolean;
  latency_ms: number;
  error: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: "chat" | "embed";
}

export interface ModelsResponse {
  chat: ModelInfo[];
  embed: ModelInfo[];
}

export interface VaultInfo {
  name: string;
  path: string;
  exists: boolean;
  scaffolded: boolean;
}

export interface VaultExistsResponse {
  name: string;
  exists: boolean;
  scaffolded: boolean;
}

export interface VaultCreateRequest {
  name: string;
  overwrite?: boolean;
}

export interface OnboardingProviderPayload {
  name: string;
  api_key?: string | null;
  chat_model?: string | null;
  embed_model?: string | null;
  host?: string | null;
}

export interface OnboardingCompleteRequest {
  theme: ThemeName;
  vault_name: string;
  overwrite_existing_vault?: boolean;
  provider: OnboardingProviderPayload | null;
  steps_done: string[];
}

export interface ConfigPatch {
  theme?: ThemeName;
  active_vault?: string;
  default_provider?: string;
}
