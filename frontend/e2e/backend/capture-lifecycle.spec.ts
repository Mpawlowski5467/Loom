import { expect, test } from "@playwright/test";
import { expectView, openSettings, viewTab } from "../nav";

async function openInbox(page: import("@playwright/test").Page) {
  await viewTab(page, "Inbox").click();
  await expect(page.getByRole("tab", { name: /Captures/ })).toBeVisible();
}

async function createCapture(
  page: import("@playwright/test").Page,
  title: string,
  body: string,
) {
  // The header has no capture button; ⌘⇧C (Ctrl+Shift+C) opens it anywhere.
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.getByLabel("Capture content").fill(body);
  await page.getByLabel("Capture title").fill(title);
  await page
    .getByRole("dialog", { name: "Quick capture" })
    .getByRole("button", { name: "Capture" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Quick capture" }),
  ).toBeHidden();
  await openInbox(page);
  const row = page
    .getByRole("list", { name: "Captures" })
    .getByRole("button", { name: new RegExp(title) });
  await expect(row).toBeVisible();
  await row.click();
}

test("real backend capture preview, edit, file, archive, restore, and reload", async ({
  page,
}) => {
  const requests: string[] = [];
  let committedNoteId = "";
  let commitPayload: {
    note?: { id?: string; extra?: Record<string, unknown> };
    outcome?: string;
    capture_archived?: boolean;
  } = {};
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", async (response) => {
    if (response.url().includes("/api/captures/commit")) {
      const payload = (await response.json()) as {
        note?: { id?: string; extra?: Record<string, unknown> };
        outcome?: string;
        capture_archived?: boolean;
      };
      commitPayload = payload;
      committedNoteId = payload.note?.id ?? "";
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(viewTab(page, "Inbox")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await expect(
    page.getByRole("dialog", { name: "Quick capture" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/loom-review-quick-capture.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  await createCapture(
    page,
    "Browser lifecycle capture",
    "A real backend fixture capture for lifecycle smoke testing.",
  );
  await expect(
    page.getByRole("region", { name: "Weaver's proposal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit first" }).click();
  const editDialog = page.getByRole("dialog", { name: /Edit the proposal/i });
  await expect(editDialog).toBeVisible();
  await editDialog
    .getByRole("textbox")
    .first()
    .fill("Browser lifecycle edited");
  await editDialog
    .getByRole("button", { name: /accept|save|file/i })
    .last()
    .click();

  await expectView(page, "Notes");
  await expect(
    page.getByRole("heading", { level: 1, name: "Browser lifecycle edited" }),
  ).toBeVisible();

  await expect.poll(() => committedNoteId, { timeout: 5_000 }).toMatch(/^thr_/);
  expect(commitPayload.outcome).toBe("filed");
  expect(commitPayload.capture_archived).toBe(true);
  expect(commitPayload.note?.extra?.publication_state).toBe("published");
  await page
    .getByRole("button", { name: "Browser lifecycle edited", exact: true })
    .click();
  const titleInput = page.getByLabel("Note title");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("Browser lifecycle filed edit");
  await titleInput.press("Enter");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Browser lifecycle filed edit",
    }),
  ).toBeVisible();

  // Leave a dirty draft while moving through Graph and back. The editor
  // persists that draft locally, so this also covers accidental navigation.
  // Markdown mode gives a plain textarea; the choice persists across views.
  await page.getByRole("button", { name: "Edit as markdown" }).click();
  const bodyInput = page.getByRole("textbox", { name: "Note body (markdown)" });
  const draftMarker = "\n\nDraft survives Graph navigation.";
  await bodyInput.fill(`${await bodyInput.inputValue()}${draftMarker}`);
  await viewTab(page, "Graph").click();
  await viewTab(page, "Notes").click();
  await expect(bodyInput).toHaveValue(/Draft survives Graph navigation\./);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectView(page, "Notes");
  await expect(bodyInput).toHaveValue(/Draft survives Graph navigation\./);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText(/Saved .*Browser lifecycle filed edit/),
  ).toBeVisible();

  // Find the note again from the palette, against the real search API.
  await viewTab(page, "Graph").click();
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Search" });
  await palette
    .getByRole("combobox", { name: "Search notes, actions and agents" })
    .fill("lifecycle filed");
  await expect(palette.getByText(/^(hybrid|keyword) · \d+ ms$/)).toBeVisible();
  await expect(
    palette.getByRole("option", { name: /^Browser lifecycle filed edit/ }),
  ).toBeVisible();
  await expect(
    palette.getByRole("complementary", { name: "Preview" }),
  ).toContainText("Why it matched");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expectView(page, "Notes");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Browser lifecycle filed edit",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More note actions" }).click();
  await page.getByRole("menuitem", { name: "Archive note" }).click();
  const archiveDialog = page.getByRole("dialog", { name: /Archive .*\?/i });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archive" }).click();
  await expectView(page, "Graph");
  await openSettings(page, "Vault");
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await expect(
    page.getByText("Browser lifecycle filed edit", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Browser lifecycle filed edit" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(
    page.getByText(/Restored .*Browser lifecycle filed edit.*topics\//),
  ).toBeVisible();

  await viewTab(page, "Graph").click();
  await viewTab(page, "Notes").click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Browser lifecycle filed edit",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/loom-review-browser.png",
    fullPage: true,
  });
  expect(requests.some((url) => url.includes("/api/notes?"))).toBe(true);
  expect(requests.some((url) => url.includes("/api/notes/bulk"))).toBe(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Browser lifecycle filed edit",
    }),
  ).toBeVisible();

  // The Board reflects the agent work this lifecycle produced.
  await viewTab(page, "Board").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Board" }),
  ).toBeVisible();
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity.getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByRole("article", { name: "Weaver" })).toContainText(
    /actions? this week/,
  );
  await expect(
    page.getByRole("complementary", { name: "Loom Council" }),
  ).toBeVisible();

  // Threads counts the same week of agent actions.
  await viewTab(page, "Threads").click();
  await expectView(page, "Threads");
  await expect(page.getByRole("navigation", { name: "Threads" })).toBeVisible();
  await expect(page.getByText(/^[1-9]\d*\+? this week$/)).toBeVisible();
});

test("provider failure leaves the original capture reviewable", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(viewTab(page, "Inbox")).toBeVisible();
  await createCapture(
    page,
    "Provider failure capture",
    "BROWSER_PROVIDER_FAILURE — preserve this source for review.",
  );
  await expect(
    page.getByRole("region", { name: "Weaver's proposal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve and file" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Needs review" }),
  ).toBeVisible();
  await expect(page.getByText(/provider|validation/i).first()).toBeVisible();
  await expect(
    page.getByText(/BROWSER_PROVIDER_FAILURE/).first(),
  ).toBeVisible();
});
