import { test, expect } from "@playwright/test"

test.describe("Higsi V2 - Page rendering", () => {
  test("login page loads and shows branding", async ({ page }) => {
    await page.goto("/login")
    await expect(page.locator("text=Higsi")).toBeVisible()
    await expect(page.locator("text=Compliance Platform")).toBeVisible()
    await expect(page.locator("text=Sign in")).toBeVisible()
  })

  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/login/)
  })

  test("login form has email and password fields", async ({ page }) => {
    await page.goto("/login")
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })
})
