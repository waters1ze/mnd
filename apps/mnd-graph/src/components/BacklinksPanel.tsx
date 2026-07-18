import { useState, useEffect } from 'react';
import { loadBacklinks } from '../core/ipc';
import { GraphNode } from '../core/types';
import { Link2, ArrowRight } from 'lucide-react';

export function BacklinksPanel({ vaultId, selectedNode, onNodeSelect }: { vaultId: string, selectedNode: GraphNode | null, onNodeSelect: (n: GraphNode) => void }) {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedNode) {
      setLinks([]);
      return;
    }
    
    let isMounted = true;
    setLoading(true);
    loadBacklinks(vaultId, selectedNode.id).then(data => {
      if (isMounted) setLinks(data || []);
    }).catch(err => {
      console.warn("Failed to load backlinks", err);
    }).finally(() => {
      if (isMounted) setLoading(false);
    });
    return () => { isMounted = false; };
  }, [vaultId, selectedNode]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/50">
        <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">Backlinks</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {!selectedNode ? (
          <div className="text-xs text-neutral-500 text-center py-4">Select a node to see its backlinks.</div>
        ) : loading ? (
          <div className="text-xs text-neutral-500 text-center py-4">Loading...</div>
        ) : links.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4">No backlinks found.</div>
        ) : (
          links.map((link, i) => (
            <div 
              key={i} 
              className="p-3 bg-neutral-800/50 border border-neutral-700/50 rounded-xl space-y-1 hover:bg-neutral-800 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Link2 className="w-3 h-3 text-blue-400" />
                <span className="text-xs font-medium text-neutral-300 truncate">{link.sourceTitle || link.sourceId}</span>
              </div>
              {link.context && (
                <p className="text-xs text-neutral-500 border-l-2 border-neutral-700 pl-2 ml-1 italic line-clamp-2">
                  "{link.context}"
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
