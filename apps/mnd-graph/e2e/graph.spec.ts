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
      if (command === 'get_antigravity_info') {
        return {
          status: 'ready',
          executablePath: 'C:/Users/test/AppData/Local/agy/bin/agy.exe',
          version: '1.1.4',
          models: ['Gemini 3.5 Flash (Medium)', 'Claude Sonnet 4.6 (Thinking)'],
        };
      }
      if (command === 'scan_vault_inventory') {
        return { totalFiles: 3, mediaFiles: 2, markdownFiles: 1, totalBytes: 4096, byKind: { video: 1, audio: 1, markdown: 1 } };
      }
      if (command === 'run_auto_edit') {
        return {
          projectId: 'project-test',
          projectSlug: 'test-edit',
          model: 'Gemini 3.5 Flash (Medium)',
          sourceCount: 2,
          fcpxmlPath: '/fake/vault/Projects/test-edit/exports/MND_Export/final-timeline.fcpxml',
          fcpxmlRelativePath: 'Projects/test-edit/exports/MND_Export/final-timeline.fcpxml',
          exportBundlePath: '/fake/vault/Projects/test-edit/exports/MND_Export',
          validationPath: '/fake/vault/Projects/test-edit/exports/MND_Export/validation-report.json',
        };
      }
      if (command === 'rebuild_vault_index') return 'Rebuilt 1 notes';
      if (command === 'start_vault_watcher' || command === 'stop_vault_watcher' || command === 'reveal_vault_entry' || command === 'open_vault_in_obsidian') return undefined;
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
  await expect(page.getByRole('button', { name: 'Открыть папку' })).toBeVisible();
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
  await expect(page.getByText('Antigravity CLI')).toBeVisible();
  await expect(page.getByLabel('Модель для разговора и монтажа')).toHaveValue('Gemini 3.5 Flash (Medium)');
});

test('AI studio turns a prompt into a DaVinci timeline result', async ({ page }) => {
  await installTauriMock(page, true);
  await page.goto('/');
  await page.getByLabel('Что должно получиться').fill('Собери динамичный ролик на 60 секунд без длинных пауз.');
  await expect(page.getByRole('button', { name: 'Создать монтаж' })).toBeEnabled();
  await page.getByRole('button', { name: 'Создать монтаж' }).click();
  await expect(page.getByText('Монтаж готов')).toBeVisible();
  await expect(page.getByText(/final-timeline\.fcpxml/)).toBeVisible();
});
