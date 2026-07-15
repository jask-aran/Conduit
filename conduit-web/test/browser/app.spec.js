import { expect, test } from "@playwright/test";

const projects = [{
  id: "project_chat",
  slug: "chat",
  name: "Chats",
  sessions: [],
}];

test.beforeEach(async ({ page }) => {
  await page.route("**/v0/projects", async (route) => {
    await route.fulfill({ json: { projects } });
  });
  await page.route("**/v0/models?**", async (route) => {
    await route.fulfill({
      json: {
        models: [],
        defaultModel: "",
        defaultThinkingLevel: "off",
        requiresAuthentication: false,
      },
    });
  });
});

test("renders the primary chat surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What are we working on?" })).toBeVisible();
  await expect(page.getByPlaceholder("Message Pi in Chats")).toBeVisible();
});

test("opens and dismisses the new folder dialog", async ({ page }, testInfo) => {
  await page.goto("/");

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create folder" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
