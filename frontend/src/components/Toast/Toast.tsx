import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../lib/context/useApp";
import styles from "./Toast.module.css";

const AUTO_DISMISS_MS = 4000;
const FADE_MS = 300;

export function ToastContainer() {
  const { toasts, removeToast } = useApp();

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          variant={toast.variant}
          onDismiss={removeToast}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  message,
  variant,
  onDismiss,
}: {
  id: number;
  message: string;
  variant: "success" | "info" | "danger";
  onDismiss: (id: number) => void;
}) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), AUTO_DISMISS_MS - FADE_MS);
    const removeTimer = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [id, onDismiss]);

  const borderClass =
    variant === "danger"
      ? styles.borderDanger
      : variant === "info"
        ? styles.borderInfo
        : styles.borderSuccess;

  return (
    <div
      className={`${styles.toast} ${borderClass} ${fading ? styles.toastFading : ""}`}
    >
      <span className={styles.message}>{message}</span>
      <button className={styles.close} onClick={() => onDismiss(id)}>
        <X size={14} />
      </button>
    </div>
  );
}
