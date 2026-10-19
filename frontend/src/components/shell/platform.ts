/** True on macOS/iOS, where shortcuts use ⌘ rather than Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

/** The label for the primary modifier: "⌘" or "Ctrl". */
export function modKeyLabel(): string {
  return isApplePlatform() ? "⌘" : "Ctrl";
}
