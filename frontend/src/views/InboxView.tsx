import { ArrowLeft, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditSuggestionModal } from "./EditSuggestionModal";
import { AutomationControl } from "./inbox/AutomationControl";
import { isDemoCapture } from "./inbox/captureHelpers";
import { DetailPane } from "./inbox/DetailPane";
import { InboxList } from "./inbox/InboxList";
import { JobHistory } from "./inbox/JobHistory";
import { useInbox } from "./inbox/useInbox";

/**
 * Inbox: quick capture and the triage list | the selected capture with
 * Weaver's proposal. The Jobs tab shows the durable processing ledger.
 */
export function InboxView(): ReactNode {
  const {
    captures,
    selectCapture,
    openNote,
    pushToast,
    demoMode,
    jobs,
    policy,
    proposals,
    desktop,
    surface,
    setSurface,
    filter,
    setFilter,
    search,
    setSearch,
    editing,
    setEditing,
    selectable,
    queueable,
    count,
    visible,
    selection,
    remove,
    actions,
    jobActions,
    selected,
    selectedJob,
    retry,
    preview,
    ready,
    draftId,
    approve,
    statusOf,
  } = useInbox();
  const showList = desktop || !selected;
  const showDetail = desktop || !!selected;

  return (
    <Tabs
      value={surface}
      onValueChange={setSurface}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold text-foreground">Inbox</h1>
        <TabsList aria-label="Inbox views">
          <TabsTrigger value="captures" className="gap-1.5 text-xs">
            Captures
            <span className="font-mono text-[10px] text-muted-foreground">
              {captures.filter((c) => c.status !== "done").length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-1.5 text-xs">
            Jobs
            <span className="font-mono text-[10px] text-muted-foreground">
              {jobs.jobs.length}
            </span>
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto">
          <AutomationControl policy={policy} demoMode={demoMode} />
        </div>
      </header>
      <TabsContent value="captures" className="mt-0 flex min-h-0 flex-1">
        {showList && (
          <aside
            aria-label="Captures list"
            className="flex w-full shrink-0 flex-col border-r border-border bg-sidebar lg:w-[380px]"
          >
            <InboxList
              visible={visible}
              counts={{
                all: count("all"),
                review: count("review"),
                filed: count("filed"),
              }}
              filter={filter}
              onFilterChange={setFilter}
              search={search}
              onSearchChange={setSearch}
              statusOf={statusOf}
              selectable={selectable}
              selection={selection}
              selectedId={selected?.id ?? null}
              onSelect={selectCapture}
              onSkipSelected={() => {
                const targets = selection.selected;
                selection.clear();
                void actions.skipMany(targets);
              }}
              onQueueSelected={() => {
                const targets = captures.filter(
                  (c) => selection.ids.has(c.id) && queueable(c),
                );
                selection.clear();
                void jobActions.queueMany(targets);
              }}
              jobsError={jobs.error}
            />
          </aside>
        )}
        {showDetail && (
          <section
            aria-label="Capture"
            className="flex min-w-0 flex-1 flex-col"
          >
            {!desktop && selected && (
              <Button
                variant="ghost"
                size="sm"
                className="m-2 self-start"
                onClick={() => selectCapture(null)}
              >
                <ArrowLeft aria-hidden="true" />
                All captures
              </Button>
            )}
            {selected ? (
              <DetailPane
                key={selected.id}
                capture={selected}
                job={selectedJob}
                jobBusy={jobActions.busy.has(selected.id)}
                canQueue={!demoMode && !isDemoCapture(selected)}
                preview={preview}
                proposal={proposals?.get(selected.id)}
                onApprove={approve}
                onEdit={() => setEditing(true)}
                onDiscard={() => void actions.skipOne(selected)}
                onRetryPreview={() => retry(selected.id)}
                onEnqueue={() => void jobActions.queue(selected)}
                onRetryJob={() => void jobActions.queue(selected, true)}
                onCancelJob={() =>
                  selectedJob &&
                  void jobActions.cancelFor(selected, selectedJob)
                }
                onOpenDraft={draftId ? () => openNote(draftId) : undefined}
                onMerged={() => {
                  remove(selected.id);
                  pushToast({
                    icon: "✓",
                    agent: "weaver",
                    body: "Capture merge completed.",
                  });
                }}
              />
            ) : (
              <EmptyState
                icon={<Inbox />}
                title="Pick a capture"
                description="Weaver's proposal, the links Spider would add and Sentinel's checks appear here."
              />
            )}
          </section>
        )}
      </TabsContent>
      <TabsContent value="jobs" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <JobHistory
          jobs={jobs.jobs}
          captures={captures}
          loaded={jobs.loaded}
          error={jobs.error}
          onOpenNote={openNote}
          onCancel={jobActions.cancelJob}
          onRetry={jobActions.retryJob}
          onPruneHistory={jobActions.prune}
        />
      </TabsContent>
      {editing && selected && (
        <EditSuggestionModal
          capture={selected}
          preview={ready}
          onClose={() => setEditing(false)}
          onAccepted={(result) => {
            actions.onCommitted(selected, result);
            setEditing(false);
          }}
        />
      )}
    </Tabs>
  );
}
