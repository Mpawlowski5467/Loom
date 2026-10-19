import { useEffect, useMemo, useState } from "react";
import { listChatSessions, loadChatDay } from "@/api/chat";
import { useApp } from "@/context/app-ctx";
import { historyToCouncil } from "@/context/useCouncil";
import { readDemoMode } from "@/data/demoMode";
import type { CouncilMessage } from "@/data/types";
import { localDate } from "./threadModel";

interface Sessions {
  dates: string[];
  error: boolean;
}

/** Days with a saved Council chat, newest first (demo: from the seed). */
export function useCouncilSessions(): Sessions {
  const { council } = useApp();
  const [demo] = useState(readDemoMode);
  const [state, setState] = useState<Sessions>({ dates: [], error: false });
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    listChatSessions("_council", controller.signal)
      .then((dates) => setState({ dates, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ dates: [], error: true });
      });
    return () => controller.abort();
  }, [demo]);
  const demoDates = useMemo(
    () =>
      [...new Set(council.map((m) => localDate(m.at)).filter(Boolean))]
        .sort()
        .reverse(),
    [council],
  );
  return demo ? { dates: demoDates, error: false } : state;
}

interface Day {
  date: string;
  messages: CouncilMessage[] | null;
  error: string | null;
}

/** One day's saved Council chat; `messages` is null while it loads. */
export function useCouncilDay(date: string): Omit<Day, "date"> {
  const { council } = useApp();
  const [demo] = useState(readDemoMode);
  const [state, setState] = useState<Day | null>(null);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    loadChatDay(date, "_council", controller.signal)
      .then((res) =>
        setState({
          date,
          messages: historyToCouncil(res.messages),
          error: null,
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error =
          err instanceof Error ? err.message : "Couldn't load this chat.";
        setState({ date, messages: null, error });
      });
    return () => controller.abort();
  }, [demo, date]);
  if (demo)
    return {
      messages: council.filter((m) => localDate(m.at) === date),
      error: null,
    };
  return state?.date === date ? state : { messages: null, error: null };
}
