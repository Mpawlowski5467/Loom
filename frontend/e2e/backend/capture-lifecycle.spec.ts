import { expect, test } from "@playwright/test";

async function openInbox(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Inbox" }).click();
  await expect(page.getByRole("tab", { name: /Captures/ })).toBeVisible();
}

async function createCapture(
  page: import("@playwright/test").Page,
  title: string,
  body: string,
) {
  await page.getByRole("button", { name: "Quick capture" }).click();
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
  await expect(page.getByRole("button", { name: title })).toBeVisible();
  await page.getByRole("button", { name: title }).click();
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
  await expect(page.getByRole("tab", { name: "Inbox" })).toBeVisible();
  await page.getByRole("tab", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await page.screenshot({
    path: "/tmp/loom-review-today.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Quick capture" }).click();
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
  await expect(page.getByText("Weaver suggestion")).toBeVisible();
  await page.getByRole("button", { name: "edit suggestion" }).click();
  const editDialog = page.getByRole("dialog", { name: /Edit suggestion/i });
  await expect(editDialog).toBeVisible();
  await editDialog
    .getByRole("textbox")
    .first()
    .fill("Browser lifecycle edited");
  await editDialog
    .getByRole("button", { name: /accept|save|file/i })
    .last()
    .click();

  await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText("Browser lifecycle edited", { exact: true }),
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
    page.getByText("Browser lifecycle filed edit", { exact: true }),
  ).toBeVisible();

  // Leave a dirty draft while moving through Graph and back. The editor
  // persists that draft locally, so this also covers accidental navigation.
  await page.getByRole("button", { name: /✎ edit/ }).click();
  const bodyInput = page.getByRole("textbox", { name: "Note body" });
  const draftMarker = "\n\nDraft survives Graph navigation.";
  await bodyInput.fill(`${await bodyInput.inputValue()}${draftMarker}`);
  await page.getByRole("tab", { name: "Graph" }).click();
  await page.getByRole("tab", { name: "Thread" }).click();
  // Editing state is held by AppContext while Thread is unmounted for the
  // Graph hop, so the editor is already open on return.
  await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(
    /Draft survives Graph navigation\./,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /✎ edit/ }).click();
  await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(
    /Draft survives Graph navigation\./,
  );
  await page.getByRole("button", { name: /Save note/ }).click();
  await expect(
    page.getByText(/Saved .*Browser lifecycle filed edit/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive note" }).click();
  const archiveDialog = page.getByRole("dialog", { name: /Archive .*\?/i });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("tab", { name: "Graph" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Open settings" }).click();

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await expect(
    page.getByText("Browser lifecycle filed edit", { exact: true }),
  ).toBeVisible();
  await page
    .locator("article.settings-vault-card")
    .filter({ hasText: "Browser lifecycle filed edit" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(
    page.getByText(/Restored .*Browser lifecycle filed edit.*topics\//),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Graph" }).click();
  await page.getByRole("tab", { name: "Thread" }).click();
  await expect(
    page.getByText("Browser lifecycle filed edit", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/loom-review-browser.png",
    fullPage: true,
  });
  expect(requests.some((url) => url.includes("/api/notes?"))).toBe(true);
  expect(requests.some((url) => url.includes("/api/notes/bulk"))).toBe(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Browser lifecycle filed edit", { exact: true }),
  ).toBeVisible();
});

test("provider failure leaves the original capture reviewable", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Inbox" })).toBeVisible();
  await createCapture(
    page,
    "Provider failure capture",
    "BROWSER_PROVIDER_FAILURE — preserve this source for review.",
  );
  await expect(page.getByText("Weaver suggestion")).toBeVisible();
  await page.getByRole("button", { name: "accept & file" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Needs review" }),
  ).toBeVisible();
  await expect(page.getByText(/provider|validation/i).first()).toBeVisible();
  await expect(
    page.getByText(/BROWSER_PROVIDER_FAILURE/).first(),
  ).toBeVisible();
});
