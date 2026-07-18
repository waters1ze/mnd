import chalk from 'chalk';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function handleGraph() {
  console.log(chalk.cyan('Starting MND Graph Vault...'));
  
  const tauriAppPath = path.join(__dirname, '..', '..', 'apps', 'mnd-graph');
  console.log(chalk.gray(`Launching from: ${tauriAppPath}`));
  
  // For production this would launch the built executable.
  // For now, we launch the dev server.
  const child = exec('npm run tauri dev', { cwd: tauriAppPath });
  
  child.stdout?.on('data', (data) => process.stdout.write(data));
  child.stderr?.on('data', (data) => process.stderr.write(chalk.red(data)));
  
  child.on('close', (code) => {
    if (code !== 0) {
      console.log(chalk.red(`MND Graph Vault exited with code ${code}`));
    }
  });
}
