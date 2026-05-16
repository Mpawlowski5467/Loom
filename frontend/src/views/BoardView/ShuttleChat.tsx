import type { ChatMessage } from "../../lib/api";
import styles from "./BoardView.module.css";
import { getInitials } from "./helpers";
import { SHUTTLE_TABS, type ShuttleTab } from "./types";

interface ShuttleChatProps {
  tab: ShuttleTab;
  messages: Record<string, ChatMessage[]>;
  input: string;
  sending: boolean;
  allAgentNames: string[];
  onTabChange: (tab: ShuttleTab) => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function ShuttleChat({
  tab,
  messages,
  input,
  sending,
  allAgentNames,
  onTabChange,
  onInputChange,
  onSend,
}: ShuttleChatProps) {
  const tabMessages = messages[tab] || [];
  const nameSource = allAgentNames.length ? allAgentNames : [...SHUTTLE_TABS];

  return (
    <section className={styles.chatSection}>
      <div className={styles.chatHeader}>
        <div className={styles.chatTabs}>
          {SHUTTLE_TABS.map((name) => (
            <button
              key={name}
              className={`${styles.chatTab} ${tab === name ? styles.chatTabActive : ""}`}
              onClick={() => onTabChange(name)}
            >
              {getInitials(name, nameSource)} {name}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chatBody}>
        {tabMessages.length === 0 ? (
          <p className={styles.chatEmpty}>Chat with {tab} directly.</p>
        ) : (
          <div className={styles.chatMessages}>
            {tabMessages.map((m, i) => (
              <div
                key={i}
                className={`${styles.chatMsg} ${m.role === "user" ? styles.chatMsgUser : styles.chatMsgAgent}`}
              >
                <span className={styles.chatMsgRole}>
                  {m.role === "user" ? "You" : tab}
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
          placeholder={`Ask ${tab}...`}
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
