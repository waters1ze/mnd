import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const graphRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionRoots = [
  path.join(graphRoot, 'src'),
  path.join(graphRoot, 'src-tauri', 'src'),
];
const explicitFiles = [
  path.join(graphRoot, 'package.json'),
  path.join(graphRoot, 'src-tauri', 'tauri.conf.json'),
  path.join(graphRoot, 'src-tauri', 'capabilities', 'default.json'),
];
const rules = [
  { pattern: /\b(?:exec|execSync)\s*\(/, reason: 'shell-string process execution' },
  { pattern: /shell\s*:\s*true/, reason: 'shell-enabled process execution' },
  { pattern: /Command::new\("(?:cmd|cmd\.exe|powershell|pwsh|sh|bash)"\)/, reason: 'shell executable launch' },
  { pattern: /@tauri-apps\/plugin-(?:fs|shell|sql)/, reason: 'broad frontend capability plugin' },
  { pattern: /(?:fs|shell|sql):default/, reason: 'broad Tauri capability' },
  { pattern: /\b(?:execute_operation|filesystem_command|run_sql|launch_path|open_external)\b/, reason: 'generic privileged IPC command' },
  { pattern: /dangerouslySetInnerHTML/, reason: 'unsafe HTML rendering' },
  { pattern: /Math\.random\(\)/, reason: 'nondeterministic identity or layout seed' },
];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (/\.(?:ts|tsx|js|mjs|rs|json)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const findings = [];
const files = [...productionRoots.flatMap(walk), ...explicitFiles];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: path.relative(graphRoot, file).replaceAll('\\', '/'),
          line: index + 1,
          reason: rule.reason,
          evidence: line.trim(),
        });
      }
    }
  }
}

const report = {
  status: findings.length === 0 ? 'PASS' : 'FAIL',
  checkedAt: new Date().toISOString(),
  filesChecked: files.length,
  findingCount: findings.length,
  findings,
};
fs.writeFileSync(path.join(graphRoot, 'source-audit-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
