import { useState } from 'react';
import { searchNodes } from '../core/ipc';
import { GraphNode } from '../core/types';
import { Search, Loader2 } from 'lucide-react';

export function SearchPanel({ vaultId, onNodeSelect }: { vaultId: string, onNodeSelect: (n: GraphNode) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const res = await searchNodes(vaultId, query);
      setResults(res || []);
    } catch (err) {
      console.warn("Search failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 overflow-hidden">
      <div className="p-4 border-b border-neutral-800 bg-neutral-950/50">
        <form onSubmit={handleSearch} className="relative">
          <input 
            type="text" 
            placeholder="Search nodes..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-4 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-neutral-600"
          />
          <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
          <button type="submit" className="hidden" />
        </form>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-neutral-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4">
            {query ? 'No results found.' : 'Enter a search query.'}
          </div>
        ) : (
          results.map((res, i) => (
            <div 
              key={i} 
              onClick={() => onNodeSelect(res)}
              className="p-3 bg-neutral-800/50 border border-neutral-700/50 rounded-xl space-y-1 cursor-pointer hover:bg-neutral-800 hover:border-neutral-600 transition-all active:scale-[0.98]"
            >
              <h3 className="text-sm font-medium text-blue-400 truncate">{res.title || res.id}</h3>
              <p className="text-xs text-neutral-400 line-clamp-2">{res.snippet || res.path}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
