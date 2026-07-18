import { getFS } from './fs-adapter';
import { IndexResult, GraphNode, GraphEdge } from './types';
import { parseMarkdownNote } from './parser';
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export class Indexer {
  private vaultPath: string;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private unresolved: Set<string> = new Set();
  private duplicates: Set<string> = new Set();
  private diagnostics: Array<{ path: string; message: string; severity: 'error' | 'warn' }> = [];

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  async build(): Promise<IndexResult> {
    this.nodes.clear();
    this.edges = [];
    this.unresolved.clear();
    this.duplicates.clear();
    this.diagnostics = [];

    await this.traverseDirectory('');

    this.resolveEdges();

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolved: this.unresolved,
      duplicates: this.duplicates,
      diagnostics: this.diagnostics,
    };
  }

  private async traverseDirectory(relativePath: string) {
    const fs = getFS();
    const fullPath = fs.join(this.vaultPath, relativePath);
    let entries;
    try {
      entries = await fs.readDir(fullPath);
      entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      this.diagnostics.push({ path: relativePath, message: `Failed to read dir: ${String(e)}`, severity: 'error' });
      return;
    }

    for (const entry of entries) {
      const entryRelativePath = fs.join(relativePath, entry.name);
      
      // Ignore internal mnd and obsidian folders
      if (entry.name === '.mnd' || entry.name === '.obsidian' || entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory) {
        await this.traverseDirectory(entryRelativePath);
      } else {
        await this.indexFile(entryRelativePath);
      }
    }
  }

  private async indexFile(relativePath: string) {
    const fs = getFS();
    const fullPath = fs.join(this.vaultPath, relativePath);
    const ext = fs.extname(fullPath).toLowerCase();

    if (ext === '.md') {
      try {
        const content = await fs.readTextFile(fullPath);
        const parsed = parseMarkdownNote(relativePath, content);
        
        let id = parsed.properties?.mnd_id;
        
        if (!id) {
          // If no stable ID, use the path as derived ID to remain stable
          id = relativePath;
        }

        if (this.nodes.has(id)) {
          this.duplicates.add(id);
          this.diagnostics.push({ path: relativePath, message: `Duplicate ID: ${id}`, severity: 'warn' });
          // append a suffix to still index it deterministically
          id = `${id}-${hashCode(relativePath)}`;
        }

        const node = parsed as GraphNode;
        node.id = id;
        node.isUnresolved = false;
        
        this.nodes.set(id, node);
      } catch (e) {
        this.diagnostics.push({ path: relativePath, message: `Failed to index file: ${String(e)}`, severity: 'error' });
      }
    } else {
      // It's an asset or other file type, could also be added as a node if required
      // The prompt says "Supported node types: ... asset, image, video ... "
      // We will index them as basic nodes
      const id = relativePath;
      let type: any = 'asset';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) type = 'image';
      if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) type = 'source_video';
      if (['.wav', '.mp3', '.m4a'].includes(ext)) type = 'source_audio';
      if (['.fcpxml'].includes(ext)) type = 'fcpxml';
      
      this.nodes.set(id, {
        id,
        type,
        title: fs.basename(relativePath),
        path: relativePath,
        properties: {},
        links: [],
        content: '',
        tags: [],
        isUnresolved: false
      });
    }
  }

  private resolveEdges() {
    let edgeIdCounter = 0;
    
    // First pass: title-to-id mapping for wikilinks
    const titleToId = new Map<string, string>();
    for (const [id, node] of this.nodes.entries()) {
      if (node.title) {
        titleToId.set(node.title, id);
      }
      // Also alias by basename without extension
      const parts = node.path.split(/[/\\]/);
      const basename = parts[parts.length - 1];
      const name = basename.substring(0, basename.lastIndexOf('.')) || basename;
      titleToId.set(name, id);
    }

    for (const [id, node] of this.nodes.entries()) {
      // Parent folder relation
      const parts = node.path.split(/[/\\]/);
      if (parts.length > 1) {
        // const parentPath = parts.slice(0, -1).join('/');
        // We could link to a folder node if we created folder nodes, but for now just basic edges.
      }

      // Wikilinks
      for (const link of node.links) {
        let targetId = link;
        
        if (this.nodes.has(link)) {
          targetId = link;
        } else if (titleToId.has(link)) {
          targetId = titleToId.get(link)!;
        } else {
          // Unresolved link
          this.unresolved.add(link);
          targetId = `unresolved-${link}`;
          if (!this.nodes.has(targetId)) {
            this.nodes.set(targetId, {
              id: targetId,
              type: 'unknown',
              title: link,
              path: '',
              properties: {},
              links: [],
              content: '',
              tags: [],
              isUnresolved: true
            });
          }
        }

        this.edges.push({
          id: `e${edgeIdCounter++}`,
          source: id,
          target: targetId,
          relation: 'references'
        });
      }

      // Specific properties that map to edges
      // E.g. sources, edit_plans, style, etc.
      const propKeys = ['sources', 'edit_plans', 'exports', 'style'];
      for (const key of propKeys) {
        if (node.properties[key]) {
          const val = node.properties[key];
          const links = Array.isArray(val) ? val : [val];
          for (let l of links) {
            // Strip brackets if they exist
            if (typeof l === 'string' && l.startsWith('[[') && l.endsWith(']]')) {
               l = l.slice(2, -2).split('|')[0].trim();
            }
            if (typeof l === 'string') {
              let tId = titleToId.get(l) || l;
              this.edges.push({
                id: `e${edgeIdCounter++}`,
                source: id,
                target: tId,
                relation: key === 'sources' ? 'source' :
                          key === 'edit_plans' ? 'contains' :
                          key === 'exports' ? 'exports' :
                          key === 'style' ? 'uses_style' : 'related_to'
              });
            }
          }
        }
      }
    }
  }
}
