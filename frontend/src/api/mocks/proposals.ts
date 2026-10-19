import type { Capture } from "@/data/types";
import type { CaptureProposal } from "../proposals";
import { mockDelay } from "./index";

/** Every waiting capture has a proposal; checks follow from its content. */
export function mockCaptureProposals(
  captures: readonly Capture[],
): Promise<Map<string, CaptureProposal>> {
  const rows = captures
    .filter((c) => c.status === "pending")
    .map(
      (c): CaptureProposal => ({
        capture_id: c.id,
        ready: true,
        precheck: [
          {
            rule: "Frontmatter",
            status: "pass",
            message: "id, type, tags and dates are set.",
          },
          {
            rule: "Wikilinks",
            status: c.body.includes("[[") ? "pass" : "warn",
            message: c.body.includes("[[")
              ? "Every link resolves."
              : "No links yet; Spider will suggest some.",
          },
          {
            rule: "Size",
            status: c.body.length > 4000 ? "warn" : "pass",
            message:
              c.body.length > 4000
                ? "Long capture; consider splitting it."
                : "Within one atomic note.",
          },
        ],
      }),
    );
  return mockDelay(new Map(rows.map((r) => [r.capture_id, r])));
}
