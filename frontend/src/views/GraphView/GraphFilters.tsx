import { TYPE_LABELS } from "../../lib/constants";
import styles from "./GraphView.module.css";

interface GraphFiltersProps {
  filterType: string;
  onFilterChange: (type: string) => void;
}

export function GraphFilters({ filterType, onFilterChange }: GraphFiltersProps) {
  return (
    <div className={styles.filters}>
      {TYPE_LABELS.map((t) => (
        <button
          key={t.id}
          className={`${styles.chip}${filterType === t.id ? ` ${styles.chipActive}` : ""}`}
          onClick={() => onFilterChange(t.id)}
        >
          {t.color && <span className={styles.chipDot} style={{ backgroundColor: t.color }} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
