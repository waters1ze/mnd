import { invoke } from '@tauri-apps/api/core';

export async function selectVaultDirectory(): Promise<{ candidateId: string; displayPath: string; displayName: string }> {
  return await invoke('select_vault_directory');
}

export async function classifyVaultDestination(candidateId: string): Promise<'empty' | 'mnd_vault' | 'unknown'> {
  return await invoke('classify_vault_destination', { candidateId });
}

export async function previewVaultInitialization(candidateId: string, mode: string): Promise<{ previewToken: string; createSet: string[] }> {
  return await invoke('preview_vault_initialization', { candidateId, mode });
}

export async function initializeVault(candidateId: string, previewToken: string): Promise<string> { // returns vaultId
  return await invoke('initialize_vault', { candidateId, previewToken });
}

export async function getAppConfig(): Promise<{ schemaVersion: number; activeVaultPath: string; recentVaults: Array<{ path: string; lastOpened: string }>; updatedAt: string }> {
  return await invoke('get_app_config');
}

export async function setActiveVault(vaultId: string): Promise<void> {
  return await invoke('set_active_vault', { vaultId });
}

export async function loadGraph(): Promise<any> {
  return await invoke('load_graph');
}

export async function loadGraphLayout(): Promise<Record<string, { x: number; y: number }>> {
  return await invoke('load_graph_layout');
}

export async function saveGraphLayout(layout: Record<string, { x: number; y: number }>): Promise<void> {
  return await invoke('save_graph_layout', { layout });
}

export async function readVaultFile(vaultId: string, relativePath: string): Promise<string> {
  return await invoke('read_vault_file', { vaultId, relativePath });
}

export async function atomicWriteVaultFile(vaultId: string, relativePath: string, content: string, baseIdentity?: { mtime: number; size: number; sha256: string }): Promise<void> {
  return await invoke('atomic_write_vault_file', { vaultId, relativePath, content, baseIdentity });
}

export async function loadBacklinks(vaultId: string, nodeId: string): Promise<any[]> {
  return await invoke('load_backlinks', { vaultId, nodeId });
}

export async function loadDiagnostics(vaultId: string): Promise<any[]> {
  return await invoke('load_diagnostics', { vaultId });
}

export async function startVaultWatcher(vaultId: string): Promise<void> {
  return await invoke('start_vault_watcher', { vaultId });
}

export async function stopVaultWatcher(vaultId: string): Promise<void> {
  return await invoke('stop_vault_watcher', { vaultId });
}

export async function listVaultDirectory(vaultId: string, relativePath: string = ''): Promise<any[]> {
  return await invoke('list_vault_directory', { vaultId, relativePath });
}

export async function searchNodes(vaultId: string, query: string, filters: any = {}): Promise<any[]> {
  return await invoke('search_nodes', { vaultId, query, filters });
}

export async function createVaultEntry(vaultId: string, relativePath: string, isDir: boolean): Promise<void> {
  return await invoke('create_vault_entry', { vaultId, relativePath, isDir });
}

export async function renameVaultEntry(vaultId: string, oldRelativePath: string, newRelativePath: string): Promise<void> {
  return await invoke('rename_vault_entry', { vaultId, oldRelativePath, newRelativePath });
}

export async function moveVaultEntry(vaultId: string, relativePath: string, newParentPath: string): Promise<void> {
  return await invoke('move_vault_entry', { vaultId, relativePath, newParentPath });
}

export async function duplicateVaultEntry(vaultId: string, relativePath: string): Promise<void> {
  return await invoke('duplicate_vault_entry', { vaultId, relativePath });
}

export async function trashVaultEntry(vaultId: string, relativePath: string, permanent: boolean): Promise<void> {
  return await invoke('trash_vault_entry', { vaultId, relativePath, permanent });
}

export async function revealVaultEntry(vaultId: string, relativePath: string): Promise<void> {
  return await invoke('reveal_vault_entry', { vaultId, relativePath });
}

export async function previewVaultCopy(vaultId: string, destination: string): Promise<string> {
  return await invoke('preview_vault_copy', { vaultId, destination });
}

export async function copyVaultSafely(vaultId: string, destination: string): Promise<void> {
  return await invoke('copy_vault_safely', { vaultId, destination });
}

export async function openVaultInObsidian(vaultId: string): Promise<void> {
  return await invoke('open_vault_in_obsidian', { vaultId });
}
