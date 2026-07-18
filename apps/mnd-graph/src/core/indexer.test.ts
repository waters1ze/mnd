import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Indexer } from './indexer';
import { nodeFsAdapter } from './fs-node';
import { setAdapter } from './fs-adapter';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Indexer (G06, G07)', () => {
  let tmpDir: string;

  beforeEach(() => {
    setAdapter(nodeFsAdapter);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('G06: Parses Markdown and frontmatter correctly', async () => {
    const filePath = path.join(tmpDir, 'TestNote.md');
    fs.writeFileSync(filePath, `---\nmnd_id: test-id\ntitle: Test Title\nmnd_type: project\n---\nHello [[World]]`);
    
    const indexer = new Indexer(tmpDir);
    const result = await indexer.build();
    
    expect(result.nodes.has('test-id')).toBe(true);
    const node = result.nodes.get('test-id')!;
    expect(node.title).toBe('Test Title');
    expect(node.type).toBe('project');
    expect(node.links).toContain('World');
    expect(node.content.trim()).toBe('Hello [[World]]');
  });

  it('G07: Wikilink graph indexer resolves edges', async () => {
    fs.writeFileSync(path.join(tmpDir, 'NodeA.md'), `---\nmnd_id: A\n---\nLink to [[B]]`);
    fs.writeFileSync(path.join(tmpDir, 'NodeB.md'), `---\nmnd_id: B\ntitle: B\n---\nLink to A`);

    const indexer = new Indexer(tmpDir);
    const result = await indexer.build();
    
    expect(result.nodes.size).toBe(2);
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].source).toBe('A');
    expect(result.edges[0].target).toBe('B');
  });

  it('Handles duplicates safely', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Dup1.md'), `---\nmnd_id: dup\n---\n`);
    fs.writeFileSync(path.join(tmpDir, 'Dup2.md'), `---\nmnd_id: dup\n---\n`);

    const indexer = new Indexer(tmpDir);
    const result = await indexer.build();
    
    expect(result.duplicates.has('dup')).toBe(true);
    expect(result.nodes.size).toBe(2);
  });
});
