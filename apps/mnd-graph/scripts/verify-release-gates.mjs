import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const graphRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(graphRoot, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(graphRoot, 'release-manifest.json'), 'utf8'));
const npm = process.execPath;
const npmCli = process.env.npm_execpath
  || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmArgs = args => [npmCli, ...args];
const cargoCandidate = process.env.CARGO
  || (process.platform === 'win32' ? path.join(os.homedir(), '.cargo', 'bin', 'cargo.exe') : 'cargo');
const cargo = fs.existsSync(cargoCandidate) ? cargoCandidate : 'cargo';

function execute(id, executable, args, cwd, timeoutMs = 180_000, environment = {}) {
  const started = Date.now();
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: timeoutMs,
    env: { ...process.env, ...environment },
  });
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const evidence = {
    id,
    executable,
    args,
    cwd: path.relative(repositoryRoot, cwd).replaceAll('\\', '/') || '.',
    exitCode,
    durationMs: Date.now() - started,
    timedOut: result.signal === 'SIGTERM' && result.error?.code === 'ETIMEDOUT',
    stdout: (result.stdout ?? '').slice(-8_000),
    stderr: (result.stderr ?? '').slice(-8_000),
  };
  process.stdout.write(`${id}: exit ${exitCode} (${evidence.durationMs} ms)\n`);
  return evidence;
}

const commands = {
  graphBuild: execute('graph-build', npm, npmArgs(['run', 'build']), graphRoot),
  graphLint: execute('graph-lint', npm, npmArgs(['run', 'lint']), graphRoot),
  graphTest: execute('graph-test', npm, npmArgs(['run', 'test']), graphRoot),
  graphE2e: execute('graph-e2e', npm, npmArgs(['run', 'e2e']), graphRoot, 240_000, { CI: '1' }),
  cargoFmt: execute('cargo-fmt', cargo, ['fmt', '--check'], path.join(graphRoot, 'src-tauri')),
  cargoCheck: execute('cargo-check', cargo, ['check'], path.join(graphRoot, 'src-tauri')),
  cargoClippy: execute('cargo-clippy', cargo, ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], path.join(graphRoot, 'src-tauri'), 240_000),
  cargoTest: execute('cargo-test', cargo, ['test'], path.join(graphRoot, 'src-tauri'), 240_000),
  sourceAudit: execute('source-audit', process.execPath, ['scripts/source-audit.mjs'], graphRoot),
  performance: execute('performance', process.execPath, ['scripts/perf-benchmarks.mjs'], graphRoot),
  graphDiscovery: execute('graph-discovery', npm, npmArgs(['test', '--', '--runInBand', '--testPathPattern=graph-discovery.test']), repositoryRoot, 240_000),
};

const passed = (...ids) => ids.every(id => commands[id]?.exitCode === 0);
const bundleRoot = path.join(graphRoot, 'src-tauri', 'target', 'release', 'bundle');
const hasNativeBundle = fs.existsSync(bundleRoot)
  && fs.readdirSync(bundleRoot, { recursive: true }).some(entry => /\.(?:exe|msi|dmg|appimage|deb)$/i.test(String(entry)));

function gate(status, reason, commandIds = []) {
  return { status, reason, commandIds };
}

const gates = {
  G01: hasNativeBundle && passed('graphBuild', 'cargoCheck')
    ? gate('PASS', 'Web build, Rust check, and native bundle artifact verified', ['graphBuild', 'cargoCheck'])
    : gate('PARTIAL', 'Web/Rust build verified; no native bundle artifact was found', ['graphBuild', 'cargoCheck']),
  G02: gate('PARTIAL', 'Typed picker/classification/preview implementation compiled; browser test uses a Tauri bridge double', ['graphE2e', 'cargoTest']),
  G03: passed('cargoTest') ? gate('PASS', 'Filesystem classification cases executed in Rust tests', ['cargoTest']) : gate('FAIL', 'Rust classification tests failed', ['cargoTest']),
  G04: gate('PARTIAL', 'Destination mutation fingerprint is tested; injected rollback failures are not covered', ['cargoTest']),
  G05: gate('PARTIAL', 'Initialization structure is implemented but exact fixture equivalence was not executed', ['cargoTest']),
  G06: gate('PARTIAL', 'Frontmatter and wikilink parsing executed; full byte-preserving editor matrix is incomplete', ['cargoTest']),
  G07: passed('cargoTest') ? gate('PASS', 'Real SQLite rebuild resolved wikilinks and recorded duplicate IDs', ['cargoTest']) : gate('FAIL', 'Graph indexer tests failed', ['cargoTest']),
  G08: gate('PARTIAL', 'Native SQLite schema and transactional rebuild executed; corruption recovery is not covered', ['cargoTest']),
  G09: gate('PARTIAL', 'Sigma workspace browser flow passed with a bridge double; native drag persistence was not exercised', ['graphE2e']),
  G10: gate('PARTIAL', 'Component interactions passed; full production component E2E matrix is incomplete', ['graphTest']),
  G11: gate('NOT RUN', 'MIME-verified native media viewers were not exercised'),
  G12: gate('PARTIAL', 'Typed explorer bridge and containment compiled; full CRUD E2E matrix is incomplete', ['graphBuild', 'cargoTest']),
  G13: passed('cargoTest') ? gate('PARTIAL', 'Atomic replacement/hash tests passed; injected failure and full conflict UI matrix are incomplete', ['cargoTest']) : gate('FAIL', 'Atomic write tests failed', ['cargoTest']),
  G14: gate('PARTIAL', 'Native watcher emits typed create/modify/rename/delete/rescan events; debounce is frontend-driven and watcher tests are incomplete', ['cargoCheck']),
  G15: gate('PARTIAL', 'Search/backlink native queries compile; filter UI evidence is incomplete', ['graphBuild', 'cargoCheck']),
  G16: passed('sourceAudit') ? gate('PARTIAL', 'Source audit proves no shell wrapper; installed/not-installed Obsidian outcomes were not executed', ['sourceAudit']) : gate('FAIL', 'Privileged source audit failed', ['sourceAudit']),
  G17: gate('NOT RUN', 'Byte-for-byte .base preservation matrix was not executed'),
  G18: passed('graphDiscovery') ? gate('PARTIAL', 'Executable discovery tests passed; packaged Graph command matrix is incomplete', ['graphDiscovery']) : gate('FAIL', 'Graph discovery tests failed', ['graphDiscovery']),
  G19: gate('PARTIAL', 'Persistent recent-vault config and safe staging copy compile; failure-injection matrix is incomplete', ['cargoCheck']),
  G20: hasNativeBundle && passed('graphBuild', 'graphLint', 'graphTest', 'graphE2e', 'cargoFmt', 'cargoCheck', 'cargoClippy', 'cargoTest', 'sourceAudit', 'performance')
    ? gate('PASS', 'All automated security/build/test/performance commands passed and native bundle exists', Object.keys(commands).filter(id => id !== 'graphDiscovery'))
    : gate('PARTIAL', 'Automated commands and/or native bundle requirement are incomplete', Object.keys(commands).filter(id => id !== 'graphDiscovery')),
};

for (const gateId of Object.keys(manifest.gates)) {
  if (!gates[gateId]) gates[gateId] = gate('NOT RUN', 'No verifier mapping exists');
}
const statuses = Object.values(gates).map(result => result.status);
const overallStatus = statuses.includes('FAIL') ? 'FAIL' : statuses.every(status => status === 'PASS') ? 'PASS' : 'PARTIAL';
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  overallStatus,
  nativeBundleFound: hasNativeBundle,
  gates,
  commands: Object.values(commands),
};
const reportPath = path.join(repositoryRoot, 'graph-release-report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Graph verification ${overallStatus}; report: ${reportPath}\n`);
if (overallStatus !== 'PASS') process.exitCode = 1;
