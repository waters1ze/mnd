import { test, expect } from '@playwright/test';

test('App displays Onboarding screen first', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Welcome to MND Graph Vault');
  await expect(page.getByRole('button', { name: /Select Folder/i })).toBeVisible();
});

// Since Tauri APIs for dialogs will not work in standard browser E2E, we can mock localStorage to simulate a selected vault.
test('App displays Graph View if vault is selected', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mnd-vault-path', '/fake/path');
  });
  await page.goto('/');
  // Because graph needs fs-adapter, the mock will fail inside GraphView without Tauri. 
  // We check for "Error loading graph." as an indicator that the component mounted and tried to load.
  await expect(page.locator('text=Error loading graph.').first()).toBeVisible();
});
