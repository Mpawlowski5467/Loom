import type { NodePaint } from "@/graph/graphModel";
import type { ThemeColors } from "@/theme/useThemeColors";

/**
 * Node fill: the community's theme color for the four largest communities,
 * a neutral tone for the rest — or for everything when communities are off.
 */
export function makeNodePaint(
  colors: ThemeColors,
  slotOf: ReadonlyMap<string, number | null>,
  communitiesOn: boolean,
): NodePaint {
  const neutral = colors.mutedForeground;
  if (!communitiesOn) return () => neutral;
  return (id) => {
    const slot = slotOf.get(id);
    return slot === null || slot === undefined
      ? neutral
      : colors.community[slot]!;
  };
}

/** Changes whenever makeNodePaint's output could. */
export function paintKey(
  colors: ThemeColors,
  communityKey: string,
  communitiesOn: boolean,
): string {
  return `${colors.key}|${communitiesOn ? communityKey : "off"}`;
}
