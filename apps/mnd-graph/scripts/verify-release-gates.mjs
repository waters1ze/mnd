import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../release-manifest.json');
const reportPath = path.resolve(__dirname, '../../../graph-release-report.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const report = {
  timestamp: new Date().toISOString(),
  results: []
};

let hasFailure = false;

for (const [gateId, gateInfo] of Object.entries(manifest.gates)) {
  let status = 'NOT RUN';
  // Here we would check test reports and determine actual status.
  // For now, per the economy rules and contract, without independent tests all gates are NOT RUN.
  report.results.push({
    id: gateId,
    name: gateInfo.description,
    status: status,
    details: 'Not executed in this verifier stub.'
  });
  if (status === 'FAIL' || status === 'PARTIAL' || status === 'NOT RUN') {
    hasFailure = true;
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nVerification complete. Report saved to ${reportPath}`);

if (hasFailure) {
  process.exit(1);
}
