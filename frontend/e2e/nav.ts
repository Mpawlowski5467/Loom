import { expect, type Page } from "@playwright/test";

/** A view tab in the app header (Graph, Notes, Board, Inbox, Threads). */
export function viewTab(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: new RegExp(`^${name}\\b`) });
}

/** Assert which view is open. */
export async function expectView(page: Page, name: string) {
  await expect(viewTab(page, name)).toHaveAttribute("aria-current", "page");
}

/** Open Settings from the header, then a section from its nav. */
export async function openSettings(page: Page, section: string) {
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Settings" })
    .click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: section })
    .click();
}
