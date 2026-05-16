import styles from "./GraphView.module.css";

interface GraphControlsProps {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function GraphControls({ onFit, onZoomIn, onZoomOut }: GraphControlsProps) {
  return (
    <div className={styles.controls}>
      <button className={styles.controlBtn} title="Zoom to fit" onClick={onFit}>
        Fit
      </button>
      <button className={styles.controlBtn} title="Zoom in" onClick={onZoomIn}>
        +
      </button>
      <button className={styles.controlBtn} title="Zoom out" onClick={onZoomOut}>
        -
      </button>
    </div>
  );
}
