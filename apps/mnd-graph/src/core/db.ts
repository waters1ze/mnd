import { IndexResult } from './types';

let dbInstance: any = null;

export async function initDb() {
  if (dbInstance) return dbInstance;
  
  if (typeof window !== 'undefined' && (window as any).__TAURI__) {
    // We are in Tauri
    const sql = await import('@tauri-apps/plugin-sql');
    dbInstance = await sql.default.load('sqlite:mnd-graph.db');
    
    // Initialize schema
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT,
        title TEXT,
        path TEXT,
        properties TEXT,
        isUnresolved INTEGER,
        x REAL,
        y REAL
      )
    `);
    
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source TEXT,
        target TEXT,
        relation TEXT
      )
    `);
  } else {
    // We are in Node / Testing - mock implementation or in-memory fallback
    dbInstance = {
      execute: async () => {},
      select: async () => []
    };
  }
  
  return dbInstance;
}

export async function saveIndexToDb(index: IndexResult) {
  const db = await initDb();
  
  // Clear old index (in a real app we might update instead of clear, but for now clear is safe)
  await db.execute('DELETE FROM nodes');
  await db.execute('DELETE FROM edges');
  
  for (const node of index.nodes.values()) {
    await db.execute(
      'INSERT INTO nodes (id, type, title, path, properties, isUnresolved) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        node.id, 
        node.type, 
        node.title || '', 
        node.path, 
        JSON.stringify(node.properties),
        node.isUnresolved ? 1 : 0
      ]
    );
  }
  
  // Insert edges
  for (const edge of index.edges) {
    await db.execute(
      'INSERT INTO edges (id, source, target, relation) VALUES ($1, $2, $3, $4)',
      [edge.id, edge.source, edge.target, edge.relation]
    );
  }
}

export async function loadLayoutFromDb(): Promise<Record<string, { x: number, y: number }>> {
  const db = await initDb();
  const rows = await db.select('SELECT id, x, y FROM nodes WHERE x IS NOT NULL AND y IS NOT NULL');
  const layout: Record<string, { x: number, y: number }> = {};
  for (const row of rows as any[]) {
    layout[row.id] = { x: row.x, y: row.y };
  }
  return layout;
}

export async function saveLayoutToDb(layout: Record<string, { x: number, y: number }>) {
  const db = await initDb();
  for (const [id, pos] of Object.entries(layout)) {
    await db.execute('UPDATE nodes SET x = $1, y = $2 WHERE id = $3', [pos.x, pos.y, id]);
  }
}
