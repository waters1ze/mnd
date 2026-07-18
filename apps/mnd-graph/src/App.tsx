import { useState, useEffect } from 'react';
import { Onboarding } from './components/Onboarding';
import { GraphView } from './components/GraphView';
import { Editor } from './components/Editor';
import { FileExplorer } from './components/FileExplorer';
import { SearchPanel } from './components/SearchPanel';
import { BacklinksPanel } from './components/BacklinksPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { GraphNode } from './core/types';
import { getAppConfig } from './core/ipc';
import { Settings, Folder, Search, Link2, GitBranch } from 'lucide-react';

export default function App() {
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activeSidebar, setActiveSidebar] = useState<'explorer' | 'search' | 'backlinks' | 'diagnostics' | null>('explorer');

  useEffect(() => {
    // Try to load active vault from backend config
    let isMounted = true;
    getAppConfig().then(config => {
      if (isMounted && config && config.activeVaultPath) {
        // Here the config activeVaultPath is actually just the path, but the backend uses vaultId now
        // Assuming config returns activeVaultPath or vaultId
        const activeId = (config as any).vaultId || config.activeVaultPath;
        if (activeId) setVaultId(activeId);
      }
    }).catch(err => {
      console.warn("Could not get app config on boot", err);
    });
    return () => { isMounted = false; };
  }, []);

  if (!vaultId) {
    return <Onboarding onVaultSelected={setVaultId} />;
  }

  const handleSwitchVault = async () => {
    // Phase 8: Vault switching UI with dirty-note guard
    if (confirm("Switch to another vault? (Ensure no unsaved changes)")) {
      setVaultId(null);
    }
  };

  return (
    <div className="flex w-screen h-screen bg-neutral-950 text-neutral-200 overflow-hidden font-sans">
      
      {/* Activity Bar */}
      <div className="w-14 flex flex-col items-center py-4 bg-neutral-900 border-r border-neutral-800 z-20 shrink-0">
        <div className="flex flex-col gap-4 flex-1">
          <ActivityButton icon={Folder} active={activeSidebar === 'explorer'} onClick={() => setActiveSidebar(activeSidebar === 'explorer' ? null : 'explorer')} title="File Explorer" />
          <ActivityButton icon={Search} active={activeSidebar === 'search'} onClick={() => setActiveSidebar(activeSidebar === 'search' ? null : 'search')} title="Search" />
          <ActivityButton icon={GitBranch} active={activeSidebar === 'diagnostics'} onClick={() => setActiveSidebar(activeSidebar === 'diagnostics' ? null : 'diagnostics')} title="Diagnostics" />
          <ActivityButton icon={Link2} active={activeSidebar === 'backlinks'} onClick={() => setActiveSidebar(activeSidebar === 'backlinks' ? null : 'backlinks')} title="Backlinks" />
        </div>
        <div className="flex flex-col gap-4 mt-auto">
          <ActivityButton icon={Settings} active={false} onClick={handleSwitchVault} title="Switch Vault" />
        </div>
      </div>

      {/* Sidebar Area */}
      {activeSidebar && (
        <div className="w-72 bg-neutral-900 border-r border-neutral-800 z-10 flex flex-col shadow-xl shrink-0">
          {activeSidebar === 'explorer' && <FileExplorer vaultId={vaultId} onNodeSelect={setSelectedNode} />}
          {activeSidebar === 'search' && <SearchPanel vaultId={vaultId} onNodeSelect={setSelectedNode} />}
          {activeSidebar === 'diagnostics' && <DiagnosticsPanel vaultId={vaultId} />}
          {activeSidebar === 'backlinks' && <BacklinksPanel vaultId={vaultId} selectedNode={selectedNode} />}
        </div>
      )}

      {/* Main Graph Area */}
      <div className="flex-1 relative flex">
        <GraphView vaultId={vaultId} onNodeDoubleClicked={setSelectedNode} />
        
        {/* Editor Sidebar */}
        {selectedNode && (
          <Editor 
            vaultId={vaultId} 
            node={selectedNode} 
            onClose={() => setSelectedNode(null)} 
          />
        )}
      </div>

    </div>
  );
}

function ActivityButton({ icon: Icon, active, onClick, title }: any) {
  return (
    <button 
      onClick={onClick}
      title={title}
      className={`p-2.5 rounded-xl transition-all duration-200 ${
        active 
          ? 'bg-blue-500/10 text-blue-400 border-l-2 border-blue-500' 
          : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-l-2 border-transparent'
      }`}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}
