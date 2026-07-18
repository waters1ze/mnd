import { useState, useEffect } from 'react';
import { listVaultDirectory } from '../core/ipc';
import { GraphNode } from '../core/types';
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';

export function FileExplorer({ vaultId, onNodeSelect }: { vaultId: string, onNodeSelect: (n: GraphNode) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    listVaultDirectory(vaultId, '').then(data => {
      if (isMounted) setItems(data || []);
    }).catch(err => {
      console.warn("Failed to list root directory", err);
    }).finally(() => {
      if (isMounted) setLoading(false);
    });
    return () => { isMounted = false; };
  }, [vaultId]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/50">
        <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">Explorer</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {loading ? (
          <div className="text-xs text-neutral-500 text-center py-4">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4">Empty vault.</div>
        ) : (
          <div className="space-y-0.5">
            {items.map((item, i) => (
              <FileTreeNode key={i} item={item} vaultId={vaultId} onNodeSelect={onNodeSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileTreeNode({ item, vaultId, onNodeSelect }: { item: any, vaultId: string, onNodeSelect: (n: GraphNode) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const isDir = item.isDirectory;

  const handleToggle = () => {
    if (!isDir) {
      // Mock node selection from file
      onNodeSelect({
        id: item.path,
        type: item.name.endsWith('.md') ? 'mnd' : 'asset',
        title: item.name,
        path: item.path,
        tags: [],
        properties: {},
        links: [],
        content: '',
        isUnresolved: false
      });
      return;
    }
    
    if (!expanded && children.length === 0) {
      setLoading(true);
      listVaultDirectory(vaultId, item.path).then(data => {
        setChildren(data || []);
      }).catch(err => console.error(err)).finally(() => setLoading(false));
    }
    setExpanded(!expanded);
  };

  return (
    <div className="flex flex-col">
      <div 
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-neutral-800 cursor-pointer text-sm text-neutral-300 transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {isDir ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5 text-neutral-500" /> : <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-blue-400/70" />
          )}
        </div>
        {isDir && <Folder className="w-3.5 h-3.5 text-amber-500/70 shrink-0" />}
        <span className="truncate group-hover:text-neutral-100">{item.name}</span>
      </div>
      
      {expanded && isDir && (
        <div className="pl-4 ml-2 border-l border-neutral-800/50 flex flex-col gap-0.5">
          {loading ? (
             <div className="text-xs text-neutral-600 pl-4 py-1">Loading...</div>
          ) : (
            children.map((child, i) => (
              <FileTreeNode key={i} item={child} vaultId={vaultId} onNodeSelect={onNodeSelect} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
