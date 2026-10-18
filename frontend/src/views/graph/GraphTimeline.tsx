import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { dayCount, dayToTime, timeToDay, type TimelineRange } from "./timeline";

/** Playback length for the whole range. */
const PLAY_MS = 8000;

function label(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

interface GraphTimelineProps {
  range: TimelineRange;
  /** Show notes created up to this instant; null = everything (today). */
  cutoff: number | null;
  onCutoffChange: (cutoff: number | null) => void;
}

/** Scrub or play the vault's growth by creation date. */
export function GraphTimeline({
  range,
  cutoff,
  onCutoffChange,
}: GraphTimelineProps) {
  const days = dayCount(range);
  const day =
    cutoff === null
      ? days
      : Math.min(days, Math.max(0, timeToDay(range, cutoff)));
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const from = day >= days ? 0 : day;
    const started = performance.now() - (from / days) * PLAY_MS;
    const tick = (now: number) => {
      const next = Math.min(
        days,
        Math.round(((now - started) / PLAY_MS) * days),
      );
      if (next >= days) {
        onCutoffChange(null);
        setPlaying(false);
        return;
      }
      onCutoffChange(dayToTime(range, next));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // Restart only when play is toggled; `day` is read once as the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, range, days]);

  const current = cutoff === null ? "Today" : label(cutoff);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-popover/95 px-3 py-2 shadow-overlay backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={playing ? "Pause timeline" : "Play timeline"}
        onClick={() => setPlaying((p) => !p)}
      >
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {label(range.start)}
      </span>
      <Slider
        className="min-w-32 flex-1"
        min={0}
        max={days}
        step={1}
        value={[day]}
        aria-label="Show notes created up to"
        aria-valuetext={current}
        onValueChange={([v]) => {
          setPlaying(false);
          onCutoffChange(v! >= days ? null : dayToTime(range, v!));
        }}
      />
      <span className="w-20 text-right font-mono text-xs text-foreground tabular-nums">
        {current}
      </span>
    </div>
  );
}
