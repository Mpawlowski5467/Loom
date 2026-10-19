export type DangerAction = "reset" | "cache" | "archive" | "delete";

/** The typed phrase, confirm label and body for each danger-zone action. */
export function dangerActionConfig(action: DangerAction, vaultName: string) {
  if (action === "reset") {
    return {
      phrase: "RESET ONBOARDING",
      label: "Reset onboarding",
      body: "Existing vaults and provider settings are kept intact.",
    };
  }
  if (action === "cache") {
    return {
      phrase: "CLEAR CACHE",
      label: "Clear cache",
      body: "This clears local browser storage and reloads Loom.",
    };
  }
  if (action === "delete") {
    return {
      phrase: vaultName,
      label: "Permanently delete",
      body:
        `This permanently erases ${vaultName} from disk. ` +
        "Nothing is recoverable. Type the vault name to confirm.",
    };
  }
  return {
    phrase: `ARCHIVE ${vaultName}`,
    label: "Archive vault",
    body: "The vault folder moves to an archived directory.",
  };
}
