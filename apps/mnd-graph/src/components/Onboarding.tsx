import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { classifyVault, initializeVault } from '../core/vault';
import { setAdapter } from '../core/fs-adapter';
import { initTauriFs } from '../core/fs-tauri';

export function Onboarding({ onVaultSelected }: { onVaultSelected: (path: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: 'Select your MND Vault or an empty folder'
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        setLoading(false);
        return; // User cancelled
      }

      // Initialize FS
      const fsAdapter = await initTauriFs();
      setAdapter(fsAdapter);

      const classification = await classifyVault(selectedPath);
      
      if (classification === 'unknown') {
        setError("Invalid path selected.");
        setLoading(false);
        return;
      }
      
      if (classification === 'empty') {
        // Initialize the new vault
        await initializeVault(selectedPath);
      }
      
      // Save to local storage for persistence
      localStorage.setItem('mnd-vault-path', selectedPath);
      onVaultSelected(selectedPath);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="onboarding-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#1e1e1e', color: 'white' }}>
      <h1>Welcome to MND Graph Vault</h1>
      <p style={{ maxWidth: '400px', textAlign: 'center', marginBottom: '2rem' }}>
        Select a folder to use as your MND Vault. You can choose an existing vault or an empty folder to create a new one.
      </p>
      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}
      <button 
        onClick={handleSelectFolder} 
        disabled={loading}
        style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#007acc', color: 'white', border: 'none', borderRadius: '4px' }}
      >
        {loading ? 'Processing...' : 'Select Folder'}
      </button>
    </div>
  );
}
