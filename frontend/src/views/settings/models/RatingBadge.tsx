import type { ModelRating } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE: Record<ModelRating, string> = {
  good: "border-ok-foreground/40 text-ok-foreground",
  okay: "border-warning-border bg-warning text-warning-foreground",
  heavy: "border-danger-foreground/40 text-danger-foreground",
};

/** How comfortably this machine runs a model: good, okay or heavy. */
export function RatingBadge({ rating }: { rating: ModelRating }) {
  return (
    <Badge variant="outline" className={cn("font-mono", TONE[rating])}>
      {rating}
    </Badge>
  );
}
