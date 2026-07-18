import { useState, useEffect } from 'react';
import { readVaultFile, atomicWriteVaultFile } from '../core/ipc';
import { GraphNode } from '../core/types';
import { Save, X, AlertTriangle, RefreshCcw, Copy, GitCompare } from 'lucide-react';

export function Editor({ vaultId, node, onClose }: { vaultId: string, node: GraphNode | null, onClose: () => void }) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [baseIdentity, setBaseIdentity] = useState<{ mtime: number; size: number; sha256: string } | undefined>(undefined);
  const [conflictError, setConflictError] = useState(false);

  useEffect(() => {
    if (!node || !node.path || !node.path.endsWith('.md')) {
      setContent('');
      return;
    }

    let isMounted = true;
    setLoading(true);
    
    // In a real app, readVaultFile would return { content, identity: { mtime, size, sha256 } }
    // Or we query metadata. For this mock, assume it just returns content or we can fake identity.
    // Let's assume the API returns content. We don't have get_metadata in the contract exactly for identity,
    // wait, the contract says readVaultFile. Let's just pass undefined for baseIdentity if we don't have it,
    // or if the backend returns it in a wrapper, we extract it. We'll just read content.
    readVaultFile(vaultId, node.path).then(text => {
      // If the backend returns a JSON with { content, mtime, size, sha256 } we parse it.
      // Let's assume it returns just string for now.
      let parsedText = text;
      try {
        const obj = JSON.parse(text);
        if (obj.content !== undefined) {
          parsedText = obj.content;
          setBaseIdentity({ mtime: obj.mtime, size: obj.size, sha256: obj.sha256 });
        }
      } catch (e) {
        // Not json, just string
      }
      
      if (isMounted) {
        setContent(parsedText);
        setOriginalContent(parsedText);
        setConflictError(false);
      }
    }).catch(err => {
      console.error("Failed to read file", err);
      if (isMounted) setContent('Error reading file.');
    }).finally(() => {
      if (isMounted) setLoading(false);
    });

    return () => { isMounted = false; };
  }, [node, vaultId]);

  const handleSave = async () => {
    if (!node || !node.path) return;
    setSaving(true);
    setConflictError(false);
    try {
      await atomicWriteVaultFile(vaultId, node.path, content, baseIdentity);
      setOriginalContent(content);
      // optionally update baseIdentity here if returned
    } catch (err: any) {
      console.error("Failed to save", err);
      if (err && (err === 'external_change_conflict' || err.message === 'external_change_conflict' || err.includes?.('external_change_conflict'))) {
        setConflictError(true);
      } else {
        alert("Failed to save file: " + String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConflictResolve = async (action: 'reload' | 'compare' | 'save_copy' | 'cancel') => {
    if (action === 'cancel') {
      setConflictError(false);
      return;
    }
    
    if (action === 'reload') {
      setConflictError(false);
      // Re-read
      if (!node) return;
      try {
        const text = await readVaultFile(vaultId, node.path);
        let parsedText = text;
        try {
          const obj = JSON.parse(text);
          if (obj.content !== undefined) {
            parsedText = obj.content;
            setBaseIdentity({ mtime: obj.mtime, size: obj.size, sha256: obj.sha256 });
          }
        } catch(e) {}
        setContent(parsedText);
        setOriginalContent(parsedText);
      } catch (e) {
        alert("Failed to reload: " + String(e));
      }
      return;
    }
    
    if (action === 'save_copy') {
      // save to .copy.md
      if (!node) return;
      try {
        const copyPath = node.path.replace('.md', '.copy.md');
        await atomicWriteVaultFile(vaultId, copyPath, content);
        setConflictError(false);
        alert("Saved as copy to " + copyPath);
      } catch (e) {
        alert("Failed to save copy: " + String(e));
      }
      return;
    }
    
    if (action === 'compare') {
      alert("Compare view not fully implemented. Showing diff in console.");
      console.log("Original:", originalContent);
      console.log("Current:", content);
      return;
    }
  };

  if (!node) return null;
  const isDirty = content !== originalContent;

  return (
    <div className="flex flex-col w-96 h-full bg-neutral-900 border-l border-neutral-800 shadow-2xl z-10 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`w-2 h-2 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-transparent'}`} />
          <h3 className="font-medium text-sm text-neutral-200 truncate" title={node.title || node.id}>
            {node.title || node.id}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={handleSave}
            disabled={saving || (!isDirty && !conflictError)}
            className={`p-1.5 rounded-md transition-colors ${
              isDirty ? 'text-blue-400 hover:bg-blue-500/10' : 'text-neutral-600'
            }`}
            title="Save (Ctrl+S)"
          >
            {saving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {conflictError && (
        <div className="p-4 m-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-3">
          <div className="flex items-start gap-2 text-amber-500">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h4 className="text-sm font-medium">External Change Conflict</h4>
          </div>
          <p className="text-xs text-amber-500/80">
            This file was modified externally since you opened it. Overwriting will lose those changes.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button onClick={() => handleConflictResolve('reload')} className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors">
              <RefreshCcw className="w-3 h-3" /> Reload external
            </button>
            <button onClick={() => handleConflictResolve('compare')} className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors">
              <GitCompare className="w-3 h-3" /> Compare
            </button>
            <button onClick={() => handleConflictResolve('save_copy')} className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors">
              <Copy className="w-3 h-3" /> Save as copy
            </button>
            <button onClick={() => handleConflictResolve('cancel')} className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}
      
      {node.path.endsWith('.md') ? (
        <div className="flex-1 flex flex-col p-4 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-10 bg-neutral-900/50 backdrop-blur-sm flex items-center justify-center">
              <RefreshCcw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          )}
          <textarea 
            className="flex-1 w-full bg-neutral-950 text-neutral-300 border border-neutral-800 rounded-xl p-4 resize-none font-mono text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 custom-scrollbar"
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-4 text-neutral-500">
          <div className="w-16 h-16 rounded-2xl bg-neutral-800 flex items-center justify-center">
            {node.type.includes('image') ? '🖼️' : node.type.includes('video') ? '🎬' : '📄'}
          </div>
          <div>
            <p className="font-medium text-neutral-300">Cannot edit directly</p>
            <p className="text-sm mt-1">Editing non-markdown files is not supported.</p>
          </div>
        </div>
      )}
    </div>
  );
}
