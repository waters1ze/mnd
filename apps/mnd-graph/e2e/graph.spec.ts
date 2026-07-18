import { test, expect, type Page } from '@playwright/test';

async function installTauriMock(page: Page, activeVault = false): Promise<void> {
  await page.addInitScript(({ hasActiveVault }) => {
    const invoke = async (command: string): Promise<unknown> => {
      if (command === 'get_app_config') {
        return {
          schemaVersion: 1,
          activeVaultId: hasActiveVault ? 'vault-test' : null,
          activeVaultPath: hasActiveVault ? '/fake/vault' : '',
          recentVaults: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      }
      if (command === 'load_graph') {
        return {
          nodes: {
            welcome: {
              id: 'welcome',
              type: 'mnd',
              title: 'Welcome',
              path: 'Welcome.md',
              tags: [],
              properties: {},
              links: [],
              content: '',
              isUnresolved: false,
            },
          },
          edges: [],
        };
      }
      if (command === 'load_graph_layout') return { welcome: { x: 0, y: 0 } };
      if (command === 'list_vault_directory') return [];
      if (command === 'rebuild_vault_index') return 'Rebuilt 1 notes';
      if (command === 'start_vault_watcher' || command === 'stop_vault_watcher') return undefined;
      if (command === 'save_graph_layout') return undefined;
      throw new Error(`Unexpected Tauri command in E2E test: ${command}`);
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke },
    });
  }, { hasActiveVault: activeVault });
}

test('App displays onboarding when no vault is active', async ({ page }) => {
  await installTauriMock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MND Graph Vault');
  await expect(page.getByRole('button', { name: /Browse for Vault Folder/i })).toBeVisible();
});

test('App displays the graph workspace when a vault is active', async ({ page }) => {
  await installTauriMock(page, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Explorer' })).toBeVisible();
  await expect(page.getByText('Empty vault.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Depth' })).toBeVisible();
  await expect(page.getByText('Nodes').locator('..').getByText('1')).toBeVisible();
});
