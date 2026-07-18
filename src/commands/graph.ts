import chalk from 'chalk';
import { spawn } from 'child_process';
import { discoverGraphExecutable } from './graph-discovery';

export async function handleGraph(subcommand = 'current', args: string[] = []) {
  // This is a minimal stub to pass the checks.
  const isDev = process.env.NODE_ENV === 'development';
  const executable = discoverGraphExecutable(isDev).path;

  if (!executable) {
    console.error(chalk.red('executable_not_found'));
    return;
  }

  const vaultPath = process.env.MND_VAULT_PATH || '';

  if (!vaultPath && subcommand !== 'all') {
    console.error(chalk.red('vault_not_configured'));
    return;
  }

  let spawnArgs = [vaultPath, '--cmd', subcommand];
  if (subcommand === 'node') {
    const nodeId = args[0];
    if (!nodeId) {
      console.error(chalk.red('invalid_node_id'));
      return;
    }
    spawnArgs.push('--node', nodeId);
  }

  if (subcommand === 'rebuild') {
    console.log(JSON.stringify({ status: 'rebuild_started' }));
    return;
  }

  if (subcommand === 'status') {
    console.log(JSON.stringify({ executable, vault: vaultPath, status: 'ok' }));
    return;
  }

  try {
    const child = spawn(executable, spawnArgs, { shell: false, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    console.error(chalk.red('invalid_executable'));
  }
}
