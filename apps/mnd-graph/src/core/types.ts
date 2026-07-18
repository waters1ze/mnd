export type NodeType =
  | 'home'
  | 'project'
  | 'source_video'
  | 'source_audio'
  | 'transcript'
  | 'transcript_segment'
  | 'scene'
  | 'edit_plan'
  | 'cut'
  | 'overlay'
  | 'asset'
  | 'image'
  | 'thumbnail'
  | 'audio_asset'
  | 'broll'
  | 'style'
  | 'global_rule'
  | 'prompt'
  | 'ai_model'
  | 'export'
  | 'fcpxml'
  | 'drive_file'
  | 'unknown';

export interface GraphNode {
  id: string; // mnd_id or derived stable id
  type: NodeType;
  title: string;
  created?: string;
  updated?: string;
  tags: string[];
  path: string; // relative to vault root
  properties: Record<string, any>; // parsed frontmatter
  links: string[]; // outgoing wikilinks (raw link text)
  content: string; // markdown body
  isUnresolved: boolean; // true if this is just a stub from a link
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string; // 'references', 'contains', 'source', etc.
}

export interface VaultConfig {
  schemaVersion: number;
  vaultId: string;
  createdAt: string;
  updatedAt: string;
  generator: string;
}

export interface IndexResult {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  unresolved: Set<string>;
  duplicates: Set<string>;
  diagnostics: Array<{ path: string; message: string; severity: 'error' | 'warn' }>;
}
