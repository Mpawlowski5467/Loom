import { X } from "lucide-react";
import styles from "./SettingsModal.module.css";
import type { ProviderConfig, TestStatus } from "./types";

interface ProviderCardProps {
  provider: ProviderConfig;
  index: number;
  test: TestStatus;
  onUpdate: (index: number, field: keyof ProviderConfig, value: string | boolean) => void;
  onRemove: (index: number) => void;
  onTest: (provider: ProviderConfig) => void;
}

export function ProviderCard({
  provider,
  index,
  test,
  onUpdate,
  onRemove,
  onTest,
}: ProviderCardProps) {
  const testing = test.status === "running";

  return (
    <div className={styles.providerCard}>
      <div className={styles.providerHeader}>
        <span className={styles.providerName}>{provider.name}</span>
        <span
          className={`${styles.providerType} ${provider.type === "cloud" ? styles.providerTypeCloud : styles.providerTypeLocal}`}
        >
          {provider.type}
        </span>
        {provider.isDefault && <span className={styles.providerDefault}>default</span>}
        {!provider.isDefault && (
          <button
            className={styles.btn}
            onClick={() => onUpdate(index, "isDefault", true)}
          >
            Set default
          </button>
        )}
        <button
          className={styles.btn}
          onClick={() => onTest(provider)}
          disabled={testing}
          title="Verify connection without saving"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {test.status === "ok" && (
          <span
            className={styles.testResultOk}
            title={`Connected in ${test.latencyMs} ms`}
          >
            ✓ {test.latencyMs} ms
          </span>
        )}
        {test.status === "error" && (
          <span className={styles.testResultError} title={test.error}>
            ✗ {test.error}
          </span>
        )}
        <button
          className={styles.providerRemoveBtn}
          onClick={() => onRemove(index)}
          title="Remove provider"
        >
          <X size={12} />
        </button>
      </div>

      <div className={styles.providerFields}>
        {provider.type === "cloud" && (
          <>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>API Key</span>
              <input
                className={styles.fieldInput}
                type="password"
                placeholder={provider.apiKeySet ? "(saved — leave blank to keep)" : "sk-..."}
                value={provider.apiKey}
                onChange={(e) => onUpdate(index, "apiKey", e.target.value)}
              />
            </div>
            {provider.name === "xai" && (
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.fieldLabel}>Base URL</span>
                <input
                  className={styles.fieldInput}
                  type="text"
                  placeholder="https://api.x.ai/v1"
                  value={provider.baseUrl}
                  onChange={(e) => onUpdate(index, "baseUrl", e.target.value)}
                />
              </div>
            )}
          </>
        )}

        {provider.type === "local" && (
          <div className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>Host URL</span>
            <input
              className={styles.fieldInput}
              type="text"
              placeholder="http://localhost:11434"
              value={provider.host}
              onChange={(e) => onUpdate(index, "host", e.target.value)}
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
            onChange={(e) => onUpdate(index, "chatModel", e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Embed Model</span>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="model name (optional)"
            value={provider.embedModel}
            onChange={(e) => onUpdate(index, "embedModel", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
