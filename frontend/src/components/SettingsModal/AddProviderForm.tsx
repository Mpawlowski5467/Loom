import styles from "./SettingsModal.module.css";
import type { ProviderConfig } from "./types";

interface AddProviderFormProps {
  provider: ProviderConfig;
  onChange: (provider: ProviderConfig) => void;
  onCancel: () => void;
  onAdd: () => void;
}

export function AddProviderForm({ provider, onChange, onCancel, onAdd }: AddProviderFormProps) {
  return (
    <div className={styles.addForm}>
      <span className={styles.addFormTitle}>New Provider</span>
      <div className={styles.addFormFields}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="e.g. openai, ollama"
            value={provider.name}
            onChange={(e) => onChange({ ...provider, name: e.target.value })}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            className={styles.fieldSelect}
            value={provider.type}
            onChange={(e) =>
              onChange({ ...provider, type: e.target.value as "cloud" | "local" })
            }
          >
            <option value="cloud">Cloud (API key)</option>
            <option value="local">Local (host URL)</option>
          </select>
        </div>

        {provider.type === "cloud" && (
          <div className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>API Key</span>
            <input
              className={styles.fieldInput}
              type="password"
              placeholder="sk-..."
              value={provider.apiKey}
              onChange={(e) => onChange({ ...provider, apiKey: e.target.value })}
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
              onChange={(e) => onChange({ ...provider, host: e.target.value })}
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
            onChange={(e) => onChange({ ...provider, chatModel: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Embed Model</span>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="optional"
            value={provider.embedModel}
            onChange={(e) => onChange({ ...provider, embedModel: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.addFormActions}>
        <button className={styles.btn} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onAdd}
          disabled={!provider.name.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}
