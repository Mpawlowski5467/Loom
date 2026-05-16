import styles from "./BoardView.module.css";
import { formatTime } from "./helpers";
import type { ActivityEntry } from "./types";

interface ActivityLogProps {
  activity: ActivityEntry[];
}

export function ActivityLog({ activity }: ActivityLogProps) {
  return (
    <section className={styles.activitySection}>
      <h2 className={styles.activityTitle}>Recent Activity</h2>
      <div className={styles.activityTable}>
        <div className={styles.activityHeader}>
          <span>Time</span>
          <span>Agent</span>
          <span>Action</span>
          <span>Status</span>
        </div>
        {activity.length === 0 ? (
          <div className={styles.activityEmpty}>No agent activity yet</div>
        ) : (
          activity.map((entry, i) => (
            <div key={i} className={styles.activityRow}>
              <span className={styles.activityTime}>{formatTime(entry.time)}</span>
              <span className={styles.activityAgent}>{entry.agent}</span>
              <span className={styles.activityAction}>{entry.details || entry.action}</span>
              <span className={styles.activityStatus}>
                <span className={styles.statusDot} />
                done
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
