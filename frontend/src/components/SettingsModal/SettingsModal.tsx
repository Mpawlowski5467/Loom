import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadProviderSettings,
  saveProviderSettings,
  testProviderConnection,
} from "../../lib/api";
import { GeneralTab } from "./GeneralTab";
import { ProvidersTab } from "./ProvidersTab";
import styles from "./SettingsModal.module.css";
import {
  DEFAULT_PROVIDERS,
  EMPTY_PROVIDER,
  type ProviderConfig,
  type SettingsTab,
  type TestStatus,
} from "./types";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [activeVault, setActiveVault] = useState<string>("default");
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderConfig>(EMPTY_PROVIDER);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testStates, setTestStates] = useState<Record<string, TestStatus>>({});

  useEffect(() => {
    let cancelled = false;
    loadProviderSettings()
      .then((data) => {
        if (cancelled) return;
        setActiveVault(data.activeVault);
        if (data.providers.length > 0) {
          setProviders(
            data.providers.map((p) => ({
              name: p.name,
              type: p.type,
              apiKey: "",
              apiKeySet: p.apiKeySet,
              host: p.host,
              baseUrl: p.baseUrl,
              chatModel: p.chatModel,
              embedModel: p.embedModel,
              isDefault: p.isDefaultChat || p.isDefaultEmbed,
            })),
          );
        }
      })
      .catch((err) => console.error("Failed to load settings:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUpdateProvider(
    index: number,
    field: keyof ProviderConfig,
    value: string | boolean,
  ) {
    setProviders((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === "isDefault" && value === true) {
        for (let i = 0; i < next.length; i++) {
          if (i !== index) next[i] = { ...next[i], isDefault: false };
        }
      }
      return next;
    });
  }

  function handleRemoveProvider(index: number) {
    setProviders((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddProvider() {
    if (!newProvider.name.trim()) return;
    setProviders((prev) => [
      ...prev,
      { ...newProvider, name: newProvider.name.trim().toLowerCase() },
    ]);
    setNewProvider(EMPTY_PROVIDER);
    setShowAddForm(false);
  }

  async function handleTestProvider(provider: ProviderConfig) {
    const key = provider.name;
    setTestStates((prev) => ({ ...prev, [key]: { status: "running" } }));
    try {
      const result = await testProviderConnection({
        name: provider.name,
        type: provider.type,
        apiKey: provider.apiKey,
        host: provider.host,
        baseUrl: provider.baseUrl,
        chatModel: provider.chatModel,
        embedModel: provider.embedModel,
        isDefault: provider.isDefault,
      });
      setTestStates((prev) => ({
        ...prev,
        [key]: result.ok
          ? { status: "ok", latencyMs: result.latencyMs }
          : { status: "error", error: result.error || "Test failed" },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [key]: {
          status: "error",
          error: err instanceof Error ? err.message : "Test failed",
        },
      }));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveProviderSettings(providers);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "providers" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("providers")}
          >
            LLM Providers
          </button>
          <button
            className={`${styles.tab} ${activeTab === "general" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
        </div>

        <div className={styles.body}>
          {activeTab === "providers" && (
            <ProvidersTab
              providers={providers}
              testStates={testStates}
              showAddForm={showAddForm}
              newProvider={newProvider}
              onUpdate={handleUpdateProvider}
              onRemove={handleRemoveProvider}
              onTest={handleTestProvider}
              onShowAddForm={() => setShowAddForm(true)}
              onNewProviderChange={setNewProvider}
              onCancelAdd={() => setShowAddForm(false)}
              onAdd={handleAddProvider}
            />
          )}

          {activeTab === "general" && <GeneralTab activeVault={activeVault} />}
        </div>

        <div className={styles.footer}>
          {saveError && <span className={styles.saveError}>{saveError}</span>}
          <button className={styles.btn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : loading ? "Loading..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
