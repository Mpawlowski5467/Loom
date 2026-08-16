import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const initialConfig = {
  active_vault: "",
  default_provider: "openai",
  providers: {},
  ui: { theme: "paper" },
  onboarding: { completed: false, completed_at: null, steps_done: [] },
};

test("onboards without a provider and files a reviewed demo capture", async ({
  page,
}) => {
  let config = initialConfig;
  let archived = false;
  let filedTitle = "Sigma reducer pattern";
  await page.route("http://127.0.0.1:9/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/config") {
      await route.fulfill({ json: config });
      return;
    }
    if (url.pathname.endsWith("/exists")) {
      await route.fulfill({
        json: { name: "demo", exists: false, scaffolded: false },
      });
      return;
    }
    if (url.pathname === "/api/onboarding/complete") {
      config = {
        ...initialConfig,
        active_vault: "demo",
        onboarding: {
          completed: true,
          completed_at: "2026-08-14T10:00:00Z",
          steps_done: ["welcome", "vault", "theme", "provider"],
        },
      };
      await route.fulfill({ json: config });
      return;
    }
    if (url.pathname === "/api/agents/registry") {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.startsWith("/api/notes/") && request.method() === "PUT") {
      const payload = request.postDataJSON() as {
        title?: string;
        body?: string;
      };
      filedTitle = payload.title ?? filedTitle;
      await route.fulfill({
        json: {
          id: decodeURIComponent(
            url.pathname.split("/").at(-1) ?? "sigma-pattern",
          ),
          title: filedTitle,
          type: "topic",
          tags: ["sigma", "graph"],
          created: "2026-08-14T10:00:00Z",
          modified: "2026-08-14T10:05:00Z",
          author: "weaver",
          source: "capture",
          links: [],
          status: "active",
          history: [],
          file_path: "topics/sigma-reducer-pattern.md",
          body: payload.body ?? "## Summary\n\nA stable Sigma reducer pattern.",
          wikilinks: [],
        },
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/notes/") &&
      request.method() === "DELETE"
    ) {
      archived = true;
      await route.fulfill({
        json: { status: "archived", path: ".archive/sigma-reducer-pattern.md" },
      });
      return;
    }
    if (url.pathname === "/api/archive" && request.method() === "GET") {
      await route.fulfill({
        json: {
          notes: archived
            ? [
                {
                  id: "sigma-pattern",
                  title: filedTitle,
                  type: "topic",
                  original_path: "topics/sigma-reducer-pattern.md",
                  archived_at: "2026-08-14T10:06:00Z",
                },
              ]
            : [],
        },
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/archive/") &&
      url.pathname.endsWith("/restore") &&
      request.method() === "POST"
    ) {
      archived = false;
      await route.fulfill({
        json: {
          id: "sigma-pattern",
          title: filedTitle,
          type: "topic",
          tags: ["sigma", "graph"],
          created: "2026-08-14T10:00:00Z",
          modified: "2026-08-14T10:07:00Z",
          author: "weaver",
          source: "capture",
          links: [],
          status: "active",
          history: [],
          file_path: "topics/sigma-reducer-pattern.md",
          body: "## Summary\n\nA stable Sigma reducer pattern.",
          wikilinks: [],
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });

  await page.addInitScript(() => {
    localStorage.setItem("loom.demoMode", "1");
    sessionStorage.setItem("loom.splash.seen", "1");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Welcome to Loom" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Begin →" }).click();
  await page.getByRole("button", { name: "Try the demo vault" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    page.getByRole("dialog", { name: "Skip provider setup?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Skip provider setup?" })
    .getByRole("button", { name: "Skip for now" })
    .click();

  await expect(page.getByRole("tab", { name: "Inbox" })).toBeVisible();
  await page.getByRole("tab", { name: "Inbox" }).click();
  await page
    .getByRole("button", { name: /Sigma 3 nodeReducer interpolation trick/ })
    .click();
  await expect(page.getByText("Weaver suggestion")).toBeVisible();
  await page.getByRole("button", { name: "accept & file" }).click();

  await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText("Sigma reducer pattern", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Sigma reducer pattern", exact: true })
    .click();
  await page.getByLabel("Note title").fill("Sigma reducer pattern — verified");
  await page.getByLabel("Note title").press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Sigma reducer pattern — verified",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive note" }).click();
  await expect(
    page.getByRole("dialog", {
      name: 'Archive "Sigma reducer pattern — verified"?',
    }),
  ).toBeVisible();
  await page
    .getByRole("dialog", {
      name: 'Archive "Sigma reducer pattern — verified"?',
    })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByRole("tab", { name: "Graph" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await expect(
    page.getByText("Sigma reducer pattern — verified", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText(
      'Restored "Sigma reducer pattern — verified" to topics/sigma-reducer-pattern.md.',
    ),
  ).toBeVisible();
  await page.waitForTimeout(600);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousViolations = accessibility.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );
  expect(seriousViolations).toEqual([]);
});

test("surfaces an AI provider connection failure in Settings", async ({
  page,
}) => {
  const completedConfig = {
    ...initialConfig,
    active_vault: "demo",
    providers: {
      openai: {
        api_key_set: true,
        chat_model: "gpt-4o-mini",
        embed_model: "text-embedding-3-small",
      },
    },
    onboarding: {
      completed: true,
      completed_at: "2026-08-14T10:00:00Z",
      steps_done: ["welcome", "vault", "theme", "provider"],
    },
  };

  await page.route("http://127.0.0.1:9/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/config") {
      await route.fulfill({ json: completedConfig });
      return;
    }
    if (url.pathname === "/api/settings/providers") {
      await route.fulfill({
        json: {
          active_vault: "demo",
          providers: [
            {
              name: "openai",
              type: "cloud",
              api_key: "…test",
              api_key_set: true,
              host: "",
              base_url: "",
              chat_model: "gpt-4o-mini",
              embed_model: "text-embedding-3-small",
              is_default_chat: true,
              is_default_embed: true,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === "/api/providers/codex/auth/status") {
      await route.fulfill({
        json: {
          installed: false,
          connected: false,
          auth_mode: null,
          plan_type: null,
          version: null,
          error: null,
        },
      });
      return;
    }
    if (url.pathname === "/api/providers/openai/models") {
      await route.fulfill({ json: { chat: [], embed: [] } });
      return;
    }
    if (
      url.pathname === "/api/providers/openai/test" &&
      request.method() === "POST"
    ) {
      await route.fulfill({
        json: {
          ok: false,
          latency_ms: 18,
          error: "credential rejected by provider",
        },
      });
      return;
    }
    if (url.pathname === "/api/agents/registry") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });

  await page.addInitScript(() => {
    localStorage.setItem("loom.demoMode", "1");
    sessionStorage.setItem("loom.splash.seen", "1");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Providers", exact: true }).click();

  const openAI = page.getByRole("article").filter({ hasText: "OpenAI" });
  await openAI.getByRole("button", { name: "Test", exact: true }).click();
  await expect(
    openAI.getByText("Failed — credential rejected by provider"),
  ).toBeVisible();
});
