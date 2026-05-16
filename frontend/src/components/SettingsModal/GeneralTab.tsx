import styles from "./SettingsModal.module.css";

interface GeneralTabProps {
  activeVault: string;
}

export function GeneralTab({ activeVault }: GeneralTabProps) {
  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Vault</div>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>Active Vault</div>
            <div className={styles.settingDesc}>Current vault directory</div>
          </div>
          <span className={styles.settingValue}>~/.loom/vaults/{activeVault}</span>
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
            <div className={styles.settingDesc}>
              Require agents to read context before writing
            </div>
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
  );
}
