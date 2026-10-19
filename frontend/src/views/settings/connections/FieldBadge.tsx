import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** A short state beside a field label ("token saved", "connected"). */
export function FieldBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {children}
    </Badge>
  );
}
