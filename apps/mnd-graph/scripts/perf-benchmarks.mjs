import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Graph from 'graphology';

const graphRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function measure(name, thresholdMs, operation) {
  const started = performance.now();
  const evidence = operation();
  const durationMs = performance.now() - started;
  return {
    name,
    thresholdMs,
    durationMs: Number(durationMs.toFixed(3)),
    status: durationMs <= thresholdMs ? 'PASS' : 'FAIL',
    evidence,
  };
}

function buildGraph(size) {
  const graph = new Graph();
  for (let index = 0; index < size; index += 1) {
    graph.addNode(`node-${index}`, {
      label: `Project scene ${index}`,
      nodeType: index % 7 === 0 ? 'project' : 'scene',
      tags: index % 3 === 0 ? ['highlight'] : [],
      x: Math.cos(index) * (index % 100),
      y: Math.sin(index) * (index % 100),
    });
    if (index > 0) graph.addEdge(`node-${index - 1}`, `node-${index}`);
  }
  return graph;
}

const graphs = new Map();
const results = [];
for (const [size, threshold] of [[100, 500], [1_000, 2_000], [10_000, 15_000]]) {
  results.push(measure(`Graphology construction (${size} nodes)`, threshold, () => {
    const graph = buildGraph(size);
    graphs.set(size, graph);
    return { nodes: graph.order, edges: graph.size };
  }));
}

const largeGraph = graphs.get(10_000);
results.push(measure('Graph traversal (10,000 nodes)', 1_000, () => {
  let checksum = 0;
  largeGraph.forEachNode((node, attributes) => {
    checksum += node.length + attributes.label.length;
  });
  return { checksum };
}));
results.push(measure('Case-insensitive search (10,000 nodes)', 100, () => {
  const matches = [];
  largeGraph.forEachNode((node, attributes) => {
    if (attributes.label.toLowerCase().includes('scene 99')) matches.push(node);
  });
  return { matches: matches.length };
}));
results.push(measure('Type/tag filter (10,000 nodes)', 250, () => {
  let matches = 0;
  largeGraph.forEachNode((_node, attributes) => {
    if (attributes.nodeType === 'scene' && attributes.tags.includes('highlight')) matches += 1;
  });
  return { matches };
}));

const failed = results.filter(result => result.status === 'FAIL');
const report = {
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  scope: 'Graphology construction, traversal, search, and filter hot paths',
  results,
};
fs.writeFileSync(path.join(graphRoot, 'perf-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
