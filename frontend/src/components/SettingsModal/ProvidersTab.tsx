import { AddProviderForm } from "./AddProviderForm";
import { ProviderCard } from "./ProviderCard";
import styles from "./SettingsModal.module.css";
import type { ProviderConfig, TestStatus } from "./types";

interface ProvidersTabProps {
  providers: ProviderConfig[];
  testStates: Record<string, TestStatus>;
  showAddForm: boolean;
  newProvider: ProviderConfig;
  onUpdate: (index: number, field: keyof ProviderConfig, value: string | boolean) => void;
  onRemove: (index: number) => void;
  onTest: (provider: ProviderConfig) => void;
  onShowAddForm: () => void;
  onNewProviderChange: (provider: ProviderConfig) => void;
  onCancelAdd: () => void;
  onAdd: () => void;
}

export function ProvidersTab({
  providers,
  testStates,
  showAddForm,
  newProvider,
  onUpdate,
  onRemove,
  onTest,
  onShowAddForm,
  onNewProviderChange,
  onCancelAdd,
  onAdd,
}: ProvidersTabProps) {
  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Configured Providers</div>
        <p className={styles.sectionHint}>
          Add cloud APIs (OpenAI, Anthropic, xAI) or local models (Ollama, LM Studio). Chat
          and embedding models are independent -- mix and match across providers.
        </p>
      </div>

      <div className={styles.providerList}>
        {providers.map((provider, i) => (
          <ProviderCard
            key={`${provider.name}-${i}`}
            provider={provider}
            index={i}
            test={testStates[provider.name] ?? { status: "idle" }}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onTest={onTest}
          />
        ))}
      </div>

      {!showAddForm ? (
        <button className={styles.addBtn} onClick={onShowAddForm}>
          + Add Provider
        </button>
      ) : (
        <AddProviderForm
          provider={newProvider}
          onChange={onNewProviderChange}
          onCancel={onCancelAdd}
          onAdd={onAdd}
        />
      )}
    </>
  );
}
