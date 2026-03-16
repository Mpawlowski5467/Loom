import { X } from "lucide-react";
import { useState } from "react";
import type { Theme } from "../../lib/useTheme";
import { useApp } from "../../lib/context/useApp";
import styles from "./SettingsModal.module.css";

type SettingsTab = "providers" | "general";

interface ProviderConfig {
  name: string;
  type: "cloud" | "local";
  apiKey: string;
  host: string;
  chatModel: string;
  embedModel: string;
  isDefault: boolean;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: "openai",
    type: "cloud",
    apiKey: "",
    host: "",
    chatModel: "gpt-4o",
    embedModel: "text-embedding-3-small",
    isDefault: true,
  },
  {
    name: "anthropic",
    type: "cloud",
    apiKey: "",
    host: "",
    chatModel: "claude-sonnet-4-20250514",
    embedModel: "",
    isDefault: false,
  },
  {
    name: "ollama",
    type: "local",
    apiKey: "",
    host: "http://localhost:11434",
    chatModel: "llama3",
    embedModel: "nomic-embed-text",
    isDefault: false,
  },
];

interface SettingsModalProps {
  onClose: () => void;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { theme, setTheme } = useApp();
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderConfig>({
    name: "",
    type: "cloud",
    apiKey: "",
    host: "",
    chatModel: "",
    embedModel: "",
    isDefault: false,
  });

  function handleUpdateProvider(index: number, field: keyof ProviderConfig, value: string | boolean) {
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
    setProviders((prev) => [...prev, { ...newProvider, name: newProvider.name.trim().toLowerCase() }]);
    setNewProvider({
      name: "",
      type: "cloud",
      apiKey: "",
      host: "",
      chatModel: "",
      embedModel: "",
      isDefault: false,
    });
    setShowAddForm(false);
  }

  function handleSave() {
    // TODO: POST to /api/settings/providers
    onClose();
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
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Configured Providers</div>
                <p className={styles.sectionHint}>
                  Add cloud APIs (OpenAI, Anthropic, xAI) or local models (Ollama, LM Studio).
                  Chat and embedding models are independent -- mix and match across providers.
                </p>
              </div>

              <div className={styles.providerList}>
                {providers.map((provider, i) => (
                  <div key={`${provider.name}-${i}`} className={styles.providerCard}>
                    <div className={styles.providerHeader}>
                      <span className={styles.providerName}>{provider.name}</span>
                      <span className={`${styles.providerType} ${provider.type === "cloud" ? styles.providerTypeCloud : styles.providerTypeLocal}`}>
                        {provider.type}
                      </span>
                      {provider.isDefault && (
                        <span className={styles.providerDefault}>default</span>
                      )}
                      {!provider.isDefault && (
                        <button
                          className={styles.btn}
                          onClick={() => handleUpdateProvider(i, "isDefault", true)}
                        >
                          Set default
                        </button>
                      )}
                      <button
                        className={styles.providerRemoveBtn}
                        onClick={() => handleRemoveProvider(i)}
                        title="Remove provider"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    <div className={styles.providerFields}>
                      {provider.type === "cloud" && (
                        <div className={`${styles.field} ${styles.fieldFull}`}>
                          <span className={styles.fieldLabel}>API Key</span>
                          <input
                            className={styles.fieldInput}
                            type="password"
                            placeholder="sk-..."
                            value={provider.apiKey}
                            onChange={(e) => handleUpdateProvider(i, "apiKey", e.target.value)}
                          />
                        </div>
                      )}

                      {provider.type === "local" && (
                        <div className={`${styles.field} ${styles.fieldFull}`}>
                          <span className={styles.fieldLabel}>Host URL</span>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="http://localhost:11434"
                            value={provider.host}
                            onChange={(e) => handleUpdateProvider(i, "host", e.target.value)}
                          />
                        </div>
                      )}

                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Chat Model</span>
                        <input
                          className={styles.fieldInput}
                          type="text"
                          placeholder="model name"
                          value={provider.chatModel}
                          onChange={(e) => handleUpdateProvider(i, "chatModel", e.target.value)}
                        />
                      </div>

                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Embed Model</span>
                        <input
                          className={styles.fieldInput}
                          type="text"
                          placeholder="model name (optional)"
                          value={provider.embedModel}
                          onChange={(e) => handleUpdateProvider(i, "embedModel", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!showAddForm ? (
                <button className={styles.addBtn} onClick={() => setShowAddForm(true)}>
                  + Add Provider
                </button>
              ) : (
                <div className={styles.addForm}>
                  <span className={styles.addFormTitle}>New Provider</span>
                  <div className={styles.addFormFields}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Name</span>
                      <input
                        className={styles.fieldInput}
                        type="text"
                        placeholder="e.g. openai, ollama"
                        value={newProvider.name}
                        onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                        autoFocus
                      />
                    </div>

                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Type</span>
                      <select
                        className={styles.fieldSelect}
                        value={newProvider.type}
                        onChange={(e) => setNewProvider({ ...newProvider, type: e.target.value as "cloud" | "local" })}
                      >
                        <option value="cloud">Cloud (API key)</option>
                        <option value="local">Local (host URL)</option>
                      </select>
                    </div>

                    {newProvider.type === "cloud" && (
                      <div className={`${styles.field} ${styles.fieldFull}`}>
                        <span className={styles.fieldLabel}>API Key</span>
                        <input
                          className={styles.fieldInput}
                          type="password"
                          placeholder="sk-..."
                          value={newProvider.apiKey}
                          onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                        />
                      </div>
                    )}

                    {newProvider.type === "local" && (
                      <div className={`${styles.field} ${styles.fieldFull}`}>
                        <span className={styles.fieldLabel}>Host URL</span>
                        <input
                          className={styles.fieldInput}
                          type="text"
                          placeholder="http://localhost:11434"
                          value={newProvider.host}
                          onChange={(e) => setNewProvider({ ...newProvider, host: e.target.value })}
                        />
                      </div>
                    )}

                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Chat Model</span>
                      <input
                        className={styles.fieldInput}
                        type="text"
                        placeholder="model name"
                        value={newProvider.chatModel}
                        onChange={(e) => setNewProvider({ ...newProvider, chatModel: e.target.value })}
                      />
                    </div>

                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Embed Model</span>
                      <input
                        className={styles.fieldInput}
                        type="text"
                        placeholder="optional"
                        value={newProvider.embedModel}
                        onChange={(e) => setNewProvider({ ...newProvider, embedModel: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.addFormActions}>
                    <button className={styles.btn} onClick={() => setShowAddForm(false)}>
                      Cancel
                    </button>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={handleAddProvider}
                      disabled={!newProvider.name.trim()}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "general" && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Appearance</div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Theme</div>
                    <div className={styles.settingDesc}>Switch between dark and light mode</div>
                  </div>
                  <div className={styles.themeToggle}>
                    {THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`${styles.themeBtn}${theme === opt.value ? ` ${styles.themeBtnActive}` : ""}`}
                        onClick={() => setTheme(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Vault</div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Active Vault</div>
                    <div className={styles.settingDesc}>Current vault directory</div>
                  </div>
                  <span className={styles.settingValue}>~/.loom/vaults/default</span>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Index</div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Vector Database</div>
                    <div className={styles.settingDesc}>LanceDB local storage</div>
                  </div>
                  <span className={styles.settingValue}>LanceDB</span>
                </div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Embedding Dimensions</div>
                    <div className={styles.settingDesc}>Vector size for search index</div>
                  </div>
                  <span className={styles.settingValue}>1536</span>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Agents</div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Read-Before-Write</div>
                    <div className={styles.settingDesc}>Require agents to read context before writing</div>
                  </div>
                  <span className={styles.settingValue}>Enabled</span>
                </div>
                <div className={styles.settingRow}>
                  <div>
                    <div className={styles.settingLabel}>Memory Summary Interval</div>
                    <div className={styles.settingDesc}>Summarize agent memory every N actions</div>
                  </div>
                  <span className={styles.settingValue}>20</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
