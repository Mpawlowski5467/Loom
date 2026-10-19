import { AlertLine } from "./AlertLine";
import { NOTE } from "./styles";
import type { ServiceStatusLine } from "./types";

/** When a polling bridge last ran, and its last error. */
export function PollStatus({
  status,
}: {
  status: ServiceStatusLine | undefined;
}) {
  return (
    <>
      {status?.last_run && (
        <p className={NOTE}>
          Last polled {new Date(status.last_run).toLocaleString()} —{" "}
          {status.last_created} new capture
          {status.last_created === 1 ? "" : "s"}
        </p>
      )}
      {status?.last_error && (
        <AlertLine>Last run: {status.last_error}</AlertLine>
      )}
    </>
  );
}
