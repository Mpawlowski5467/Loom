import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { TAB_PATHS } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { useIsDesktop, useIsWide } from "@/lib/useIsDesktop";
import { ActivityChart } from "./threads/ActivityChart";
import { ThreadList } from "./threads/ThreadList";
import { ThreadReader } from "./threads/ThreadReader";
import { useThreads } from "./threads/useThreads";
import { VaultStatsCard } from "./threads/VaultStatsCard";

/**
 * Threads: daily logs, Standups and Council chats | the open thread (max
 * 720px) | this week's agent actions and vault stats. The rail stacks
 * under the thread below 1280px; the list and thread swap below 1024px.
 */
export function ThreadsView(): ReactNode {
  const { id } = useParams();
  const t = useThreads(id);
  const desktop = useIsDesktop();
  const wide = useIsWide();
  const rail = (
    <>
      <ActivityChart days={t.week} capped={t.capped} />
      <VaultStatsCard stats={t.stats} />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {(desktop || !id) && (
        <aside
          aria-label="Threads list"
          className="w-full shrink-0 overflow-y-auto border-r border-border bg-sidebar lg:w-[260px]"
        >
          <ThreadList
            daily={t.daily}
            standups={t.standups}
            councils={t.councils}
            councilError={t.councilError}
            selectedId={desktop || id ? (t.selected?.id ?? null) : null}
          />
        </aside>
      )}
      {(desktop || id) && (
        <section aria-label="Thread" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-6 py-8">
            {!desktop && (
              <Button
                variant="ghost"
                size="sm"
                className="-mt-4 self-start"
                asChild
              >
                <Link to={TAB_PATHS.threads}>
                  <ArrowLeft aria-hidden="true" />
                  All threads
                </Link>
              </Button>
            )}
            <ThreadReader
              selected={t.selected}
              digest={t.digest}
              loading={t.loading}
              requested={!!id}
            />
            {!wide && (
              <div className="grid gap-8 border-t border-border pt-6 sm:grid-cols-2">
                {rail}
              </div>
            )}
          </div>
        </section>
      )}
      {wide && (
        <aside
          aria-label="This week"
          className="flex w-[280px] shrink-0 flex-col gap-8 overflow-y-auto border-l border-border px-5 py-8"
        >
          {rail}
        </aside>
      )}
    </div>
  );
}
