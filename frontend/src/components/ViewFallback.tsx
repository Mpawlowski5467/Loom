import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton shown while a view's code chunk loads. */
export function ViewFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading view"
      className="flex flex-1 flex-col gap-4 p-6"
    >
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="min-h-40 flex-1" />
    </div>
  );
}
