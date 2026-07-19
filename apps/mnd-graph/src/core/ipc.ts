import { invoke } from '@tauri-apps/api/core';
import type { GraphEdge, GraphNode } from './types';

export type VaultClassification =
  | 'missing'
  | 'empty_directory'
  | 'existing_mnd_vault'
  | 'existing_obsidian_vault'
  | 'compatible_existing_vault'
  | 'unknown_nonempty_directory'
  | 'file_not_directory'
  | 'drive_root'
  | 'inaccessible'
  | 'invalid';

export interface BaseIdentity {
  mtime: number;
  size: number;
  sha256: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  mediaKind: string;
}

export interface AntigravityInfo {
  status: 'ready' | 'not_found' | 'unavailable';
  executablePath: string | null;
  version: string | null;
  models: string[];
}

export interface VaultInventory {
  totalFiles: number;
  mediaFiles: number;
  markdownFiles: number;
  totalBytes: number;
  byKind: Record<string, number>;
}

export interface AutoEditResult {
  ok: boolean;
  status: string;
  projectId: string;
  projectSlug: string;
  model: string | null;
  sourceCount: number;
  fcpxmlPath: string;
  fcpxmlRelativePath?: string;
  exportBundlePath: string;
  validationPath: string;
}

export async function selectVaultDirectory(): Promise<{ candidateId: string; displayPath: string; displayName: string }> {
  return await invoke('select_vault_directory');
}

export async function classifyVaultDestination(candidateId: string): Promise<VaultClassification> {
  return await invoke('classify_vault_destination', { candidateId });
}

export async function previewVaultInitialization(candidateId: string, mode: string): Promise<{ previewToken: string; createSet: string[] }> {
  return await invoke('preview_vault_initialization', { candidateId, mode });
}

export async function initializeVault(candidateId: string, previewToken: string): Promise<string> { // returns vaultId
  return await invoke('initialize_vault', { candidateId, previewToken });
}

export async function getAppConfig(): Promise<{ schemaVersion: number; activeVaultId: string | null; activeVaultPath: string | null; recentVaults: Array<{ vaultId: string; path: string; name: string; lastOpened: string }>; updatedAt: string }> {
  return await invoke('get_app_config');
}

export async function setActiveVault(vaultId: string): Promise<void> {
  return await invoke('set_active_vault', { vaultId });
}

export async function loadGraph(): Promise<{ nodes: Record<string, GraphNode>; edges: GraphEdge[] }> {
  const data = await invoke<{ nodes: GraphNode[] | Record<string, GraphNode>; edges: GraphEdge[] }>('load_graph');
  const nodes = Array.isArray(data.nodes)
    ? Object.fromEntries(data.nodes.map(node => [node.id, node]))
    : data.nodes;
  return { nodes, edges: data.edges };
}

export async function rebuildVaultIndex(): Promise<string> {
  return await invoke('rebuild_vault_index');
}

export async function loadGraphLayout(): Promise<Record<string, { x: number; y: number }>> {
  const value = await invoke<Record<string, { x: number; y: number }> | Array<{ nodeId: string; position: { x: number; y: number } }>>('load_graph_layout');
  return Array.isArray(value)
    ? Object.fromEntries(value.map(update => [update.nodeId, update.position]))
    : value;
}

export async function saveGraphLayout(layout: Record<string, { x: number; y: number }>): Promise<void> {
  const updates = Object.entries(layout).map(([nodeId, position]) => ({ nodeId, position }));
  return await invoke('save_graph_layout', { updates });
}

export async function readVaultFile(vaultId: string, relativePath: string): Promise<{ content: string; identity: BaseIdentity }> {
  return await invoke('read_vault_file', { vaultId, relativePath });
}

export async function atomicWriteVaultFile(vaultId: string, relativePath: string, content: string, baseIdentity?: BaseIdentity): Promise<BaseIdentity> {
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

export async function listVaultDirectory(vaultId: string, relativePath: string = ''): Promise<DirectoryEntry[]> {
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

export async function getAntigravityInfo(): Promise<AntigravityInfo> {
  return await invoke('get_antigravity_info');
}

export async function scanVaultInventory(vaultId: string): Promise<VaultInventory> {
  return await invoke('scan_vault_inventory', { vaultId });
}

export async function runAutoEdit(vaultId: string, prompt: string, model: string, projectName: string): Promise<AutoEditResult> {
  return await invoke('run_auto_edit', { vaultId, prompt, model, projectName });
}
