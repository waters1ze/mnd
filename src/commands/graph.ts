import chalk from 'chalk';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { discoverGraphExecutable } from './graph-discovery.js';

export async function handleGraph(subcommand?: string, args?: string | string[]) {
  const sub = subcommand || 'current';
  const argArr: string[] = Array.isArray(args) ? args : [];
  const isDev = process.env.NODE_ENV === 'development';
  const executable = discoverGraphExecutable(isDev).path;

  if (!executable) {
    console.error(chalk.red('executable_not_found'));
    return;
  }

  const vaultPath = process.env.MND_VAULT_PATH || '';

  if (!vaultPath && sub !== 'all') {
    console.error(chalk.red('vault_not_configured'));
    return;
  }

  const spawnArgs: string[] = [vaultPath, '--cmd', sub];
  if (sub === 'node') {
    const nodeId = argArr[0];
    if (!nodeId) {
      console.error(chalk.red('invalid_node_id'));
      return;
    }
    spawnArgs.push('--node', nodeId);
  }

  if (sub === 'rebuild' || sub === 'status' || sub === 'node') {
    await new Promise<void>((resolve, reject) => {
      execFile(executable, spawnArgs, { shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr.trim() || error.message));
        if (stdout.trim()) console.log(stdout.trim());
        resolve();
      });
    });
    return;
  }

  try {
    const child = spawn(executable, spawnArgs, { shell: false, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (_err) {
    console.error(chalk.red('invalid_executable'));
  }
}
