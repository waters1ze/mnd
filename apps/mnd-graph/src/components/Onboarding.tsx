import { useState } from 'react';
import {
  selectVaultDirectory,
  classifyVaultDestination,
  previewVaultInitialization,
  initializeVault,
  setActiveVault
} from '../core/ipc';
import type { VaultClassification } from '../core/ipc';
import { FolderOpen, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export function Onboarding({ onVaultSelected }: { onVaultSelected: (vaultId: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [candidate, setCandidate] = useState<{ id: string; displayPath: string; displayName: string } | null>(null);
  const [classification, setClassification] = useState<VaultClassification | null>(null);
  
  const [preview, setPreview] = useState<{ token: string; createSet: string[] } | null>(null);

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      setError(null);
      setPreview(null);
      
      const selected = await selectVaultDirectory();
      if (!selected) {
        setLoading(false);
        return;
      }
      
      setCandidate({
        id: selected.candidateId,
        displayPath: selected.displayPath,
        displayName: selected.displayName
      });
      
      const type = await classifyVaultDestination(selected.candidateId);
      setClassification(type);
      
      if (['empty_directory', 'existing_mnd_vault', 'existing_obsidian_vault', 'compatible_existing_vault'].includes(type)) {
        const mode = type === 'existing_mnd_vault' ? 'open' : type === 'empty_directory' ? 'new' : 'integrate';
        const previewResult = await previewVaultInitialization(selected.candidateId, mode);
        setPreview({
          token: previewResult.previewToken,
          createSet: previewResult.createSet
        });
      } else {
        setError(`This destination cannot be opened safely (${type.replaceAll('_', ' ')}).`);
      }
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmInit = async () => {
    if (!candidate || !preview) return;
    try {
      setLoading(true);
      const vaultId = await initializeVault(candidate.id, preview.token);
      await setActiveVault(vaultId);
      onVaultSelected(vaultId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCandidate(null);
    setClassification(null);
    setPreview(null);
    setError(null);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-6 selection:bg-blue-500/30">
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-8 space-y-8 relative overflow-hidden">
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 mb-4 ring-1 ring-blue-500/20">
            <FolderOpen className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">MND Graph Vault</h1>
          <p className="text-neutral-400 text-sm">
            Select a folder to use as your vault. Choose an existing vault or an empty folder to initialize a new one.
          </p>
        </div>

        {/* Error state */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{error}</p>
          </div>
        )}

        {/* Action area */}
        {!candidate ? (
          <div className="flex flex-col items-center justify-center pt-4">
            <button 
              onClick={handleSelectFolder} 
              disabled={loading}
              className="group relative flex items-center justify-center gap-3 w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
              {loading ? 'Processing...' : 'Browse for Vault Folder'}
              {!loading && <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />}
            </button>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500 font-medium uppercase tracking-wider text-xs">Selected Path</span>
                <span className="text-blue-400 font-mono text-xs px-2 py-0.5 rounded-md bg-blue-500/10">
                  {candidate.displayName}
                </span>
              </div>
              <p className="text-sm font-mono text-neutral-300 truncate opacity-70" title={candidate.displayPath}>
                {candidate.displayPath}
              </p>
            </div>

            {preview && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{classification === 'existing_mnd_vault' ? 'Existing MND vault is ready to open.' : 'Destination is ready for confirmed initialization.'}</span>
                </div>
                
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider sticky top-0 bg-neutral-950 pb-2">
                    {preview.createSet.length === 0 ? 'No files will be changed' : 'Files to be created'}
                  </p>
                  <ul className="space-y-1">
                    {preview.createSet.map((path, idx) => (
                      <li key={idx} className="text-sm font-mono text-neutral-300 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-emerald-500/50" />
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button 
                    onClick={handleCancel}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleConfirmInit}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : classification === 'existing_mnd_vault' ? 'Open Vault' : 'Initialize Vault'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
