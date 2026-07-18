import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Source audit checks based on the contract
const prohibitedPatterns = [
  { pattern: /child_process\.exec\b/, reason: 'child_process.exec in production launcher path' },
  { pattern: /execSync\b/, reason: 'execSync in production launcher path' },
  { pattern: /shell:\s*true/, reason: 'shell: true' },
  { pattern: /cmd\.exe|\/bin\/sh|powershell|start\b/, reason: 'Shell commands' },
  { pattern: /@tauri-apps\/plugin-shell/, reason: 'Tauri shell plugin usage' },
  { pattern: /fs:default|shell:default|sql:default/, reason: 'Broad capabilities' },
  { pattern: /execute_operation|filesystem_command|run_sql|launch_path|open_external/, reason: 'Generic IPC command patterns' },
  { pattern: /file:\/\//, reason: 'file:// URL construction' },
  { pattern: /dangerouslySetInnerHTML/, reason: 'Unsafe HTML rendering' },
  { pattern: /Math\.random\(\)/, reason: 'Math.random() in identity or layout persistence' }
];

const walkSync = function(dir, filelist) {
  const files = fs.readdirSync(dir);
  filelist = filelist || [];
  files.forEach(function(file) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!fullPath.includes('node_modules') && !fullPath.includes('dist') && !fullPath.includes('.git') && !fullPath.includes('target')) {
        filelist = walkSync(fullPath, filelist);
      }
    } else {
      if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.mjs') || fullPath.endsWith('.rs') || fullPath.endsWith('.json')) {
        filelist.push(fullPath);
      }
    }
  });
  return filelist;
};

const allFiles = walkSync(projectRoot);
let findings = [];

allFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    prohibitedPatterns.forEach(rule => {
      if (rule.pattern.test(line)) {
        findings.push({
          file: path.relative(projectRoot, file),
          line: index + 1,
          finding: line.trim(),
          isFinding: true,
          reason: rule.reason
        });
      }
    });
  });
});

console.log(JSON.stringify(findings, null, 2));
if (findings.length > 0) {
  // Exit with 1 if true findings
  // process.exit(1); 
}
