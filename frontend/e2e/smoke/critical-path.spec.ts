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
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });

  await page.addInitScript(() => {
    localStorage.setItem("loom.demoMode", "1");
    sessionStorage.setItem("loom.splash.seen", "1");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Welcome to Loom" })).toBeVisible();
  await page.getByRole("button", { name: "Begin →" }).click();
  await page.getByRole("button", { name: "Try the demo vault" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("dialog", { name: "Skip provider setup?" })).toBeVisible();
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
  await expect(page.getByText("Sigma reducer pattern", { exact: true })).toBeVisible();
  await page.waitForTimeout(600);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousViolations = accessibility.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );
  expect(seriousViolations).toEqual([]);
});
