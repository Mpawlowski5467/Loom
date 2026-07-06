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
  base_url?: string | null;
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
  is_active: boolean;
}

export interface ActiveVaultResponse {
  name: string;
}

export interface VaultListResponse {
  vaults: VaultInfo[];
  active: string;
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

export interface ArchiveVaultResponse {
  archived_name: string;
  archived_path: string;
  new_active: string | null;
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
  /** Seed a brand-new vault from the bundled demo template. */
  seed_demo?: boolean;
  /** Legacy single-provider shape — keep null when sending ``providers``. */
  provider?: OnboardingProviderPayload | null;
  providers?: OnboardingProviderPayload[];
  chat_provider?: string | null;
  embed_provider?: string | null;
  steps_done: string[];
}

export interface ConfigPatch {
  theme?: ThemeName;
  active_vault?: string;
  default_provider?: string;
}

/** Mirrors ``core.hardware.HardwareProfile``. */
export interface HardwareProfile {
  scanned_at: string;
  os: string;
  cpu_model: string;
  cpu_cores: number;
  ram_gb: number;
  gpu_name: string | null;
  vram_gb: number | null;
  unified_memory: boolean;
  notes: string[];
}

export interface HardwareResponse {
  profile: HardwareProfile;
  saved: HardwareProfile | null;
}

export interface SaveHardwareResponse {
  saved: HardwareProfile;
}

export type ModelRating = "good" | "okay" | "heavy";

export interface ModelRecommendation {
  name: string;
  installed: boolean;
  est_ram_gb: number;
  rating: ModelRating;
  recommended_for: string[];
  size_bytes: number | null;
}

export interface RecommendationsResponse {
  profile: HardwareProfile;
  models: ModelRecommendation[];
}

export interface BenchmarkRequest {
  provider: string;
  model: string;
}

export interface BenchmarkResponse {
  ok: boolean;
  latency_ms: number;
  chars: number;
  chars_per_sec: number;
  error: string | null;
}

/** Mirrors ``api.routers.agent_models.AgentModelEntry``. */
export interface AgentModelEntry {
  id: string;
  name: string;
  icon: string;
  layer: string;
  system: boolean;
  provider: string;
  chat_model: string;
}

export interface AgentModelsResponse {
  agents: AgentModelEntry[];
  default_provider: string;
}

export interface AgentModelOverrideInput {
  provider?: string | null;
  chat_model?: string | null;
}

export interface PutAgentModelsRequest {
  overrides: Record<string, AgentModelOverrideInput>;
}
