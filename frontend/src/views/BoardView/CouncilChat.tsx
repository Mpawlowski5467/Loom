import type { ChatMessage } from "../../lib/api";
import styles from "./BoardView.module.css";

interface CouncilChatProps {
  messages: ChatMessage[];
  input: string;
  sending: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function CouncilChat({
  messages,
  input,
  sending,
  onInputChange,
  onSend,
}: CouncilChatProps) {
  return (
    <section className={styles.chatSection}>
      <div className={styles.chatHeader}>
        <span>Loom Council</span>
      </div>
      <div className={styles.chatBody}>
        {messages.length === 0 ? (
          <p className={styles.chatEmpty}>Ask the Loom Council a question about your vault.</p>
        ) : (
          <div className={styles.chatMessages}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.chatMsg} ${m.role === "user" ? styles.chatMsgUser : styles.chatMsgAgent}`}
              >
                <span className={styles.chatMsgRole}>
                  {m.role === "user" ? "You" : "Council"}
                </span>
                <span className={styles.chatMsgText}>{m.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.chatInputRow}>
        <input
          className={styles.chatInput}
          type="text"
          placeholder="Ask the council..."
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          disabled={sending}
        />
        <button className={styles.chatSend} onClick={onSend} disabled={sending}>
          {sending ? "..." : "Send"}
        </button>
      </div>
    </section>
  );
}
