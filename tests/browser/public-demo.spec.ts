import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LOCAL REPLAY", { exact: true })).toBeVisible();
});

test("fits the target viewport and exposes the coherent local identity", async ({ page }) => {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.document).toBeLessThanOrEqual(0);
  await expect(page.getByText("local-replay-001", { exact: true })).toBeVisible();
  await expect(page.getByText("v2:local-replay-001:tick:0", { exact: true })).toBeVisible();
  await expect(page.getByText("NOMINAL", { exact: true }).last()).toBeVisible();
});

test("operates the module list and inspector entirely from the keyboard", async ({ page }) => {
  const command = page.getByRole("button", { name: /Command CMD-01/ });
  const crew = page.getByRole("button", { name: /Crew Habitat HAB-01/ });
  await command.focus();
  await command.press("ArrowDown");
  await expect(crew).toBeFocused();
  await crew.press("Enter");

  const inspector = page.getByRole("dialog", { name: "Crew Habitat" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("dtmi:ares7:Module;2", { exact: true })).toBeVisible();
  await expect(inspector.getByText("ares7-module-crew", { exact: true })).toBeVisible();
  await expect(inspector.getByText("ares7-airlock-main", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(crew).toBeFocused();
});

test("announces the decision boundary and supports keyboard approval", async ({ page }) => {
  await page.getByRole("button", { name: "RUN DUST STORM DRILL" }).click();
  const approval = page.getByRole("button", { name: "APPROVE PLAN" });
  await expect(approval).toBeVisible({ timeout: 45_000 });
  await expect(approval).toBeFocused();
  await approval.press("Enter");
  await expect(page.getByText("CONTAINMENT", { exact: true })).toBeVisible({ timeout: 8_000 });
});
