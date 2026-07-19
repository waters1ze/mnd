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
        setError(`Эту папку нельзя безопасно открыть (${type.replaceAll('_', ' ')}).`);
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
    <div className="app-shell flex min-h-screen flex-col items-center justify-center p-6 text-slate-100">
      <div className="pointer-events-none absolute left-[15%] top-[12%] h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[10%] right-[15%] h-72 w-72 rounded-full bg-cyan-500/8 blur-3xl" />
      <div className="relative w-full max-w-xl space-y-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0e17]/88 p-9 shadow-[0_35px_100px_rgba(0,0,0,.48)] backdrop-blur-2xl">
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-violet-500/25 to-cyan-400/10 ring-1 ring-violet-400/25 shadow-[0_18px_50px_rgba(109,40,217,.24)]">
            <FolderOpen className="h-8 w-8 text-violet-300" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">MND Graph Vault</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">
            Откройте папку с видео, аудио и заметками. MND аккуратно подключит её как vault, просканирует содержимое и подготовит рабочее пространство.
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
              className="primary-button group w-full"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
              {loading ? 'Проверяем папку…' : 'Открыть папку'}
              {!loading && <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />}
            </button>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Выбранная папка</span>
                <span className="rounded-md bg-violet-500/10 px-2 py-0.5 font-mono text-xs text-violet-300">
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
                  <span>{classification === 'existing_mnd_vault' ? 'MND vault готов к открытию.' : 'Папка готова к безопасному подключению.'}</span>
                </div>
                
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider sticky top-0 bg-neutral-950 pb-2">
                    {preview.createSet.length === 0 ? 'Файлы не будут изменены' : 'Будут созданы служебные файлы'}
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
                    Отмена
                  </button>
                  <button 
                    onClick={handleConfirmInit}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : classification === 'existing_mnd_vault' ? 'Открыть vault' : 'Подключить папку'}
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
