import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let ledger;
try {
  const content = readFileSync('release-gates.json', 'utf8');
  ledger = JSON.parse(content);
} catch (e) {
  console.error('Failed to parse release-gates.json:', e.message);
  process.exit(1);
}

if (!ledger.baseline || !ledger.gates || !Array.isArray(ledger.gates)) {
  console.error('Malformed release-gates.json: missing baseline or gates array.');
  process.exit(1);
}

const requiredGates = Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
const gateIds = new Set(ledger.gates.map(g => g.id));
for (const req of requiredGates) {
  if (!gateIds.has(req)) {
    console.error(`Missing required gate: ${req}`);
    process.exit(1);
  }
}

let hasError = false;

for (const gate of ledger.gates) {
  if (!['pending', 'pass', 'fail', 'not_run'].includes(gate.status)) {
    console.error(`Invalid status '${gate.status}' for gate ${gate.id}`);
    hasError = true;
  }
  
  if (gate.status === 'pending' || gate.status === 'fail') {
    console.error(`Gate ${gate.id} is ${gate.status}`);
    hasError = true;
  }
  
  if (gate.status === 'not_run' && !['R03', 'R06', 'R07', 'R09', 'R13', 'R14', 'R15', 'R16'].includes(gate.id)) {
    console.error(`Gate ${gate.id} cannot be 'not_run' as it requires production/automated evidence.`);
    hasError = true;
  }
  
  const allEvidence = [...(gate.productionEvidence || []), ...(gate.automatedEvidence || []), ...(gate.realEvidence || [])];
  for (const item of allEvidence) {
    if (item.file && !existsSync(item.file)) {
      console.error(`Gate ${gate.id} references missing file: ${item.file}`);
      hasError = true;
    }
  }
}

function checkFiles(p, forbiddenRegexes) {
  if (!existsSync(p)) return;
  const stat = statSync(p);
  if (stat.isDirectory()) {
    const files = readdirSync(p);
    for (const file of files) {
      checkFiles(join(p, file), forbiddenRegexes);
    }
  } else if (p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.json')) {
    const content = readFileSync(p, 'utf8');
    for (const rx of forbiddenRegexes) {
      if (rx.test(content)) {
        console.error(`Forbidden pattern ${rx.source} found in ${p}`);
        hasError = true;
      }
    }
  }
}

console.log("Checking for forbidden test patterns...");
checkFiles('test', [/expect\(true\)\.toBe\(true\)/, /--forceExit/]);
checkFiles('package.json', [/--forceExit/]);

if (hasError) {
  console.error('Release verification failed.');
  process.exit(1);
}

console.log('Release verification passed.');
process.exit(0);
