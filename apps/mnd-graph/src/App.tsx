import { useEffect, useState } from 'react';
import { BacklinksPanel } from './components/BacklinksPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { Editor } from './components/Editor';
import { FileExplorer } from './components/FileExplorer';
import { GraphView } from './components/GraphView';
import { Onboarding } from './components/Onboarding';
import { SearchPanel } from './components/SearchPanel';
import { StudioPanel } from './components/StudioPanel';
import { getAppConfig, startVaultWatcher, stopVaultWatcher } from './core/ipc';
import type { GraphNode } from './core/types';
import { Folder, GitBranch, Link2, Search, Settings, Sparkles } from 'lucide-react';

type Sidebar = 'explorer' | 'search' | 'backlinks' | 'diagnostics' | null;

export default function App() {
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activeSidebar, setActiveSidebar] = useState<Sidebar>('explorer');
  const [studioOpen, setStudioOpen] = useState(true);

  useEffect(() => {
    let mounted = true;
    getAppConfig()
      .then(config => {
        if (mounted && config.activeVaultId && config.activeVaultPath) setVaultId(config.activeVaultId);
      })
      .catch(error => console.warn('Could not get app config on boot', error));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!vaultId) return;
    startVaultWatcher(vaultId).catch(error => console.warn('Could not start vault watcher', error));
    return () => { stopVaultWatcher(vaultId).catch(error => console.warn('Could not stop vault watcher', error)); };
  }, [vaultId]);

  if (!vaultId) return <Onboarding onVaultSelected={setVaultId} />;

  const toggleSidebar = (next: Exclude<Sidebar, null>) => {
    setActiveSidebar(current => current === next ? null : next);
  };

  const switchVault = () => {
    if (confirm('Открыть другую папку? Сначала сохраните изменения в заметке.')) {
      setSelectedNode(null);
      setVaultId(null);
    }
  };

  return (
    <div className="app-shell flex h-screen w-screen overflow-hidden text-slate-200">
      <nav className="activity-bar z-20 flex w-16 shrink-0 flex-col items-center border-r border-white/8 py-4">
        <div className="brand-mark mb-7" aria-label="MND">M</div>
        <div className="flex flex-1 flex-col gap-2">
          <ActivityButton icon={Folder} active={activeSidebar === 'explorer'} onClick={() => toggleSidebar('explorer')} title="Файлы" />
          <ActivityButton icon={Search} active={activeSidebar === 'search'} onClick={() => toggleSidebar('search')} title="Поиск" />
          <ActivityButton icon={Link2} active={activeSidebar === 'backlinks'} onClick={() => toggleSidebar('backlinks')} title="Обратные ссылки" />
          <ActivityButton icon={GitBranch} active={activeSidebar === 'diagnostics'} onClick={() => toggleSidebar('diagnostics')} title="Диагностика" />
          <div className="my-2 h-px bg-white/8" />
          <ActivityButton icon={Sparkles} active={studioOpen} onClick={() => setStudioOpen(value => !value)} title="AI-монтажная" />
        </div>
        <ActivityButton icon={Settings} active={false} onClick={switchVault} title="Сменить папку" />
      </nav>

      {activeSidebar && (
        <aside className="workspace-sidebar z-10 flex w-72 shrink-0 flex-col border-r border-white/8 shadow-2xl">
          {activeSidebar === 'explorer' && <FileExplorer vaultId={vaultId} onNodeSelect={setSelectedNode} />}
          {activeSidebar === 'search' && <SearchPanel vaultId={vaultId} onNodeSelect={setSelectedNode} />}
          {activeSidebar === 'diagnostics' && <DiagnosticsPanel vaultId={vaultId} />}
          {activeSidebar === 'backlinks' && <BacklinksPanel vaultId={vaultId} selectedNode={selectedNode} />}
        </aside>
      )}

      <main className="relative flex min-w-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute left-5 top-4 z-10 rounded-full border border-white/10 bg-[#0b0e17]/70 px-3 py-1.5 text-[11px] font-medium tracking-wide text-slate-400 backdrop-blur-xl">
            MND GRAPH · рабочая папка подключена
          </div>
          <GraphView vaultId={vaultId} onNodeDoubleClicked={setSelectedNode} />
        </div>
        {selectedNode && <Editor vaultId={vaultId} node={selectedNode} onClose={() => setSelectedNode(null)} />}
        {studioOpen && <StudioPanel vaultId={vaultId} />}
      </main>
    </div>
  );
}

function ActivityButton({ icon: Icon, active, onClick, title }: {
  icon: typeof Folder;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`activity-button ${active ? 'activity-button-active' : ''}`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
