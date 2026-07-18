import { useState, useEffect } from 'react';
import { loadDiagnostics } from '../core/ipc';
import { AlertTriangle, AlertCircle } from 'lucide-react';

export function DiagnosticsPanel({ vaultId }: { vaultId: string }) {
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    loadDiagnostics(vaultId).then(data => {
      if (isMounted) setDiagnostics(data || []);
    }).catch(err => {
      console.warn("Failed to load diagnostics", err);
    }).finally(() => {
      if (isMounted) setLoading(false);
    });
    return () => { isMounted = false; };
  }, [vaultId]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/50">
        <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">Diagnostics</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {loading ? (
          <div className="text-xs text-neutral-500 text-center py-4">Loading...</div>
        ) : diagnostics.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4">No issues found.</div>
        ) : (
          diagnostics.map((d, i) => (
            <div key={i} className="p-3 bg-neutral-800/50 border border-neutral-700/50 rounded-xl flex items-start gap-3 hover:bg-neutral-800 transition-colors">
              {d.severity === 'error' ? (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 overflow-hidden">
                <p className="text-xs font-mono text-neutral-400 truncate" title={d.path}>{d.path}</p>
                <p className="text-xs text-neutral-300 leading-relaxed">{d.message}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
