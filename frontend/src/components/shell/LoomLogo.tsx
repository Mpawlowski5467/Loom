import { cn } from "@/lib/utils";

/** Loom's mark: three woven threads, drawn in the brand color. */
export function LoomLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn("size-5 text-brand", className)}
    >
      <path d="M3 7c3-3 6 3 9 0s6 3 9 0" />
      <path d="M3 12c3 3 6-3 9 0s6-3 9 0" opacity="0.8" />
      <path d="M3 17c3-3 6 3 9 0s6 3 9 0" opacity="0.6" />
    </svg>
  );
}
