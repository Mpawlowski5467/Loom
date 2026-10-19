import type { CapturePreview } from "@/api/captures";
import { notePathOf } from "@/api/notes";
import { CommunityDot } from "@/components/CommunityDot";
import { Badge } from "@/components/ui/badge";
import type { Community } from "@/graph/communities";
import { cn } from "@/lib/utils";

const row = "grid grid-cols-[6rem_1fr] items-start gap-2 text-sm";
const key = "font-mono text-[11px] text-muted-foreground uppercase pt-0.5";

/** Where the note files, its frontmatter, and the links Spider would add. */
export function ProposalFields({
  preview,
  community,
}: {
  preview: CapturePreview;
  community: Community | undefined;
}) {
  return (
    <dl className="flex flex-col gap-2">
      <div className={row}>
        <dt className={key}>File as</dt>
        <dd className="min-w-0">
          <span className="block font-medium text-foreground">
            {preview.title}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {notePathOf({ folder: preview.folder, title: preview.title })}
          </span>
        </dd>
      </div>
      <div className={row}>
        <dt className={key}>Type</dt>
        <dd>
          <Badge variant="outline">
            {preview.note_type === "person" ? "people" : preview.note_type}
          </Badge>
        </dd>
      </div>
      <div className={row}>
        <dt className={key}>Tags</dt>
        <dd className="flex flex-wrap gap-1">
          {preview.tags.length === 0 && (
            <span className="text-muted-foreground">None</span>
          )}
          {preview.tags.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="font-mono text-[11px]"
            >
              #{t}
            </Badge>
          ))}
        </dd>
      </div>
      <div className={row}>
        <dt className={key}>Community</dt>
        <dd className="flex items-center gap-1.5">
          {community ? (
            <>
              <CommunityDot slot={community.slot} />
              {community.label}
            </>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          )}
        </dd>
      </div>
      <div className={row}>
        <dt className={key}>Links</dt>
        <dd className="flex flex-wrap gap-1">
          {preview.links.length === 0 && (
            <span className="text-muted-foreground">Spider found none</span>
          )}
          {preview.links.map((l) => (
            <span
              key={l.note_id || l.title}
              title={
                l.decision === "suggested"
                  ? "Suggested: Spider won't link it without you"
                  : "Spider will link it"
              }
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-xs text-chip-foreground",
                l.decision === "suggested"
                  ? "border border-dashed border-chip-foreground/50"
                  : "bg-chip",
              )}
            >
              {l.title}
              {l.decision === "suggested" && (
                <span className="sr-only"> (suggested)</span>
              )}
            </span>
          ))}
        </dd>
      </div>
    </dl>
  );
}
