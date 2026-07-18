import fs from 'fs';
import path from 'path';

// Stub for perf-benchmarks
const thresholds = [
  { fixture: '100 nodes', operation: 'Initial index', thresholdMs: 500 },
  { fixture: '1000 nodes', operation: 'Initial index', thresholdMs: 2000 },
  { fixture: '10000 nodes', operation: 'Initial index', thresholdMs: 15000 },
  { fixture: '1000 nodes', operation: 'SQLite read', thresholdMs: 200 },
  { fixture: '10000 nodes', operation: 'SQLite read', thresholdMs: 1000 },
  { fixture: '1000 nodes', operation: 'Search query', thresholdMs: 100 },
  { fixture: '10000 nodes', operation: 'Graph render init', thresholdMs: 5000 },
  { fixture: '10000 nodes', operation: 'No main-thread task post-mount', thresholdMs: 500 },
  { fixture: '10000 nodes', operation: 'Search input response', thresholdMs: 150 },
  { fixture: '10000 nodes', operation: 'Filter application', thresholdMs: 250 }
];

console.log('Performance Benchmarks stub');
console.log('Thresholds to enforce:');
thresholds.forEach(t => {
  console.log(`- [${t.fixture}] ${t.operation}: < ${t.thresholdMs} ms`);
});

// DO NOT run if no data
console.log('No benchmark data collected. Exiting.');
process.exit(0);
