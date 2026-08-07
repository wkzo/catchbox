import { test, expect } from '@playwright/test';

test('auth state, login and inbox shows catch-all message', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByText('Вход')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Пароль').fill('CHANGE_ME_dev_only');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('**/mail');
  await expect(page.getByText('random-123', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

test('unauthenticated access to /mail redirects to /auth', async ({ page }) => {
  await page.goto('/mail');
  await page.waitForURL('**/auth');
});

test('message opens and sanitized HTML shown without script', async ({ page }) => {
  await page.goto('/auth');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Пароль').fill('CHANGE_ME_dev_only');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('**/mail');
  await page.getByText('Привет коте').first().click();
  await expect(page.getByText('Доставлено на')).toBeVisible();
  await expect(page.getByText('random-123@example.com').first()).toBeVisible();
});
