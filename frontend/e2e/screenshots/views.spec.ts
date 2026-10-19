import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const THEMES = [
  "graphite",
  "paper",
  "midnight",
  "forest",
  "linen",
  "high-contrast",
] as const;

const CONFIG = {
  active_vault: "demo",
  default_provider: "openai",
  providers: { openai: { api_key_set: true, chat_model: "gpt-4o-mini" } },
  ui: { theme: "graphite" },
  onboarding: {
    completed: true,
    completed_at: "2026-05-01T09:00:00Z",
    steps_done: ["welcome", "vault", "theme", "provider"],
  },
};

interface View {
  name: string;
  path: string;
  /** Waits until the view has settled, and opens anything worth showing. */
  ready: (page: Page) => Promise<void>;
}

const VIEWS: View[] = [
  {
    name: "graph",
    path: "/graph",
    ready: async (page) => {
      await expect(page.locator("canvas").first()).toBeVisible();
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "notes",
    path: "/notes/topics/thr_t001",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Caching" }),
      ).toBeVisible();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "palette",
    path: "/graph",
    ready: async (page) => {
      await expect(page.locator("canvas").first()).toBeVisible();
      await page
        .getByRole("button", { name: /Search notes or capture/ })
        .click();
      await page.getByRole("combobox").fill("cach");
      await expect(page.getByRole("option").first()).toBeVisible();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "board",
    path: "/board",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Board" }),
      ).toBeVisible();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "inbox",
    path: "/inbox",
    ready: async (page) => {
      await page
        .getByRole("list", { name: "Captures" })
        .getByRole("button")
        .first()
        .click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "threads",
    path: "/threads",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "settings",
    path: "/settings/appearance",
    ready: async (page) => {
      await expect(
        page.getByRole("radiogroup", { name: /theme/i }).first(),
      ).toBeVisible();
    },
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("loom.splash.seen", "1");
  });
  await page.route("http://127.0.0.1:9/api/config", (route) =>
    route.fulfill({ json: CONFIG }),
  );
});

for (const theme of THEMES)
  for (const view of VIEWS)
    test(`${view.name} in ${theme}`, async ({ page }) => {
      await page.goto(`${view.path}?demo=1&theme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await view.ready(page);
      await page.screenshot({
        path: `../docs/screenshots/${view.name}-${theme}.png`,
      });
      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations
        .filter(({ impact }) => ["serious", "critical"].includes(impact ?? ""))
        .map((v) => ({
          id: v.id,
          nodes: v.nodes
            .slice(0, 3)
            .map((n) => `${n.target.join(" ")} ${n.html.slice(0, 160)}`),
        }));
      expect(serious).toEqual([]);
    });
