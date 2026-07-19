import { spawnSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

console.log("Starting release verification...");

const spec = JSON.parse(readFileSync('release-gates.spec.json', 'utf8'));
const report = {
  timestamp: new Date().toISOString(),
  sha: execSync('git rev-parse HEAD').toString().trim(),
  gates: {},
  commands: []
};

function run(cmd, opts = {}) {
  const start = Date.now();
  console.log(`Running: ${cmd}`);
  try {
    const cp = spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
    const output = (cp.stdout || '') + '\n' + (cp.stderr || '');
    if (cp.status !== 0) throw { status: cp.status, output };
    report.commands.push({ cmd, exitCode: 0, duration: Date.now() - start });
    return { success: true, output };
  } catch (err) {
    report.commands.push({ cmd, exitCode: err.status ?? 1, duration: Date.now() - start });
    return { success: false, output: err.output || (err.stdout + "\n" + err.stderr) };
  }
}

// 1. git status
const gitStatus = run('git status --short');
if (gitStatus.success && gitStatus.output.trim() !== '') {
  console.error("Working tree is dirty!");
  process.exit(1);
}

// 2. git diff --check
const gitDiff = run('git diff --check');
if (!gitDiff.success) {
  console.error("Git diff check failed!");
  process.exit(1);
}

// 3. npm run build
const build = run('npm run build');
if (!build.success) {
  console.error("Build failed!", build.output);
  process.exit(1);
}

// 4. npm run lint
const lint = run('npm run lint');
if (!lint.success) {
  console.error("Lint failed!", lint.output);
  process.exit(1);
}

// 5. npm test. Jest 30 does not include individual test titles in its
// human-readable verbose output, so use its machine-readable result file.
const jestResultsPath = '.release-jest-results.json';
if (existsSync(jestResultsPath)) rmSync(jestResultsPath);
const test = run(`npm test -- --runInBand --json --outputFile=${jestResultsPath}`);
if (!test.success) {
  console.error("Tests failed!", test.output);
  process.exit(1);
}

// 6. open handles
const openHandles = run('node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --detectOpenHandles');
if (!openHandles.success) {
  console.error("Open handles test failed!", openHandles.output);
  process.exit(1);
}

// 7. CLI Help
const cli = run('node dist/index.js --help', [], { timeout: 5000 });
if (!cli.success || !cli.output.includes("Usage:")) {
  console.error("CLI help failed or timed out!", cli.output);
  process.exit(1);
}

// Check assertions by parsing Jest verbose output
const foundAssertions = JSON.parse(readFileSync(jestResultsPath, 'utf8')).testResults
  .flatMap((suite) => suite.assertionResults)
  .filter((assertion) => assertion.status === 'passed')
  .flatMap((assertion) => {
    const match = assertion.fullName.match(/RELEASE_ASSERTION:\s*(R\d{2}[^\s(]+)/);
    return match ? [match[1]] : [];
  });
const regex = /(?:√|✓|\bPASS\b)\s*RELEASE_ASSERTION:\s*(R\d{2}[^\s\(]+)/g;
let match;
while ((match = regex.exec(test.output)) !== null) {
  foundAssertions.push(match[1]);
}
// Fallback check against source is removed to prevent comments passing as assertions.

let allGatesPass = true;
for (const gate of spec.gates) {
  let pass = true;
  let missing = [];
  
  for (const assertion of gate.requiredAssertionIds) {
    const id = assertion.replace("RELEASE_ASSERTION: ", "");
    if (!foundAssertions.includes(id)) {
      pass = false;
      missing.push(assertion);
    }
  }

  let status = "PASS";
  let reason = "Verified";

  if (!pass) {
    status = "FAIL";
    reason = `Missing assertions: ${missing.join(", ")}`;
    console.error(`Gate ${gate.id} failed: ${reason}`);
    allGatesPass = false;
  } else if (gate.realExternalEvidenceRequired) {
    status = "NOT RUN";
    reason = "Automated local checks passed, external manual verification required";
    // We don't fail the CI for NOT RUN, it's just recorded in the report
  }

  // Check forbidden test patterns
  if (pass) {
    const forbiddenRes = run('git grep "expect(true).toBe(true)" -- "*.ts"');
    if (forbiddenRes.output.trim() !== "") {
       status = "FAIL";
       reason = "Forbidden test pattern found!";
       allGatesPass = false;
    }
  }

  report.gates[gate.id] = {
    status,
    reason
  };
}

if (existsSync(jestResultsPath)) rmSync(jestResultsPath);
writeFileSync('release-report.json', JSON.stringify(report, null, 2));

if (!allGatesPass) {
  console.error("Release verification failed! See release-report.json");
  process.exit(1);
}

console.log("Release verification passed.");
