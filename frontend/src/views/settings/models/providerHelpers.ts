import type { getSettingsProviders } from "@/api/settings";
import type { CodexAuthStatus } from "@/api/types";
import {
  PROVIDER_BY_NAME,
  type ProviderForm,
  type ProviderName,
} from "../providerModels";

/** The saved model first, then live ids, then the static catalog (deduped). */
export function mergeModelIds(
  staticIds: string[],
  liveIds: string[],
  current?: string,
): string[] {
  return Array.from(
    new Set([...(current ? [current] : []), ...liveIds, ...staticIds]),
  );
}

/** The status line under a provider's name in its card header. */
export function connectionLabel(
  name: ProviderName,
  provider: ProviderForm | undefined,
  codexStatus: CodexAuthStatus | null,
): string | undefined {
  const meta = PROVIDER_BY_NAME.get(name);
  if (name === "codex") {
    if (!codexStatus) return "Checking local status…";
    if (!codexStatus.installed) return "Codex CLI unavailable";
    if (codexStatus.connected) {
      const plan = codexStatus.plan_type ? ` · ${codexStatus.plan_type}` : "";
      return `Connected via ${codexStatus.auth_mode ?? "Codex"}${plan}`;
    }
    return "Installed · sign-in required";
  }
  if (!provider) return undefined;
  if (meta?.authMode === "local") return "Local endpoint";
  if (provider.apiKeySet) return "Connected · key encrypted";
  return "Needs credential";
}

/**
 * Labels of key-based providers with no key typed or stored. Saving is
 * blocked on these: agents fail with a cryptic error later otherwise.
 */
export function missingKeyLabels(
  names: ProviderName[],
  providers: Record<string, ProviderForm>,
): string[] {
  return names
    .filter((name) => {
      const meta = PROVIDER_BY_NAME.get(name);
      if (meta?.authMode === "local" || meta?.authMode === "codex") {
        return false;
      }
      const provider = providers[name];
      return !provider?.apiKey.trim() && !provider?.apiKeySet;
    })
    .map((name) => PROVIDER_BY_NAME.get(name)?.label ?? name);
}

/** Saved provider settings → editable forms, keyed by provider name. */
export function hydrateProviders(
  providers: Awaited<ReturnType<typeof getSettingsProviders>>["providers"],
): Record<string, ProviderForm> {
  const next: Record<string, ProviderForm> = {};
  for (const provider of providers) {
    const meta = PROVIDER_BY_NAME.get(provider.name as ProviderName);
    if (!meta) continue;
    next[meta.name] = {
      name: meta.name,
      apiKey: "",
      apiKeySet: provider.api_key_set,
      host: provider.host || meta.defaultHost,
      baseUrl: provider.base_url || "",
      chatModel: provider.chat_model || meta.defaultChat,
      embedModel: meta.supportsEmbed
        ? provider.embed_model || meta.defaultEmbed
        : "",
    };
  }
  return next;
}
