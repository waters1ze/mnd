import { useState, useEffect } from 'react';
import { Onboarding } from './components/Onboarding';
import { GraphView } from './components/GraphView';
import { Editor } from './components/Editor';
import { GraphNode } from './core/types';
import './App.css';

function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('mnd-vault-path');
    if (saved) {
      setVaultPath(saved);
    }
  }, []);

  if (!vaultPath) {
    return <Onboarding onVaultSelected={setVaultPath} />;
  }

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <GraphView vaultPath={vaultPath} onNodeDoubleClicked={(node) => setSelectedNode(node)} />
      </div>
      
      {selectedNode && (
        <Editor 
          vaultPath={vaultPath} 
          node={selectedNode} 
          onClose={() => setSelectedNode(null)} 
        />
      )}
    </div>
  );
}

export default App;
