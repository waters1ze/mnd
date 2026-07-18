import { useState, useEffect } from 'react';
import { getFS } from '../core/fs-adapter';
import { GraphNode } from '../core/types';

export function Editor({ vaultPath, node, onClose }: { vaultPath: string, node: GraphNode | null, onClose: () => void }) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!node || !node.path || !node.path.endsWith('.md')) {
      setContent('');
      return;
    }

    let isMounted = true;
    const fs = getFS();
    const fullPath = fs.join(vaultPath, node.path);
    
    fs.readTextFile(fullPath).then(text => {
      if (isMounted) setContent(text);
    }).catch(err => {
      console.error("Failed to read file", err);
      if (isMounted) setContent('Error reading file.');
    });

    return () => { isMounted = false; };
  }, [node, vaultPath]);

  const handleSave = async () => {
    if (!node || !node.path) return;
    setSaving(true);
    try {
      const fs = getFS();
      const fullPath = fs.join(vaultPath, node.path);
      await fs.writeTextFile(fullPath, content);
    } catch (err) {
      console.error("Failed to save", err);
      alert("Failed to save file.");
    } finally {
      setSaving(false);
    }
  };

  if (!node) return null;

  return (
    <div style={{ width: '300px', height: '100%', backgroundColor: '#252526', color: '#ccc', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #333' }}>
      <div style={{ padding: '10px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, fontSize: '14px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{node.title || node.id}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer' }}>✖</button>
      </div>
      
      {node.path.endsWith('.md') ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px' }}>
          <textarea 
            style={{ flex: 1, backgroundColor: '#1e1e1e', color: '#d4d4d4', border: '1px solid #3c3c3c', padding: '10px', resize: 'none', fontFamily: 'monospace' }}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
          <button 
            onClick={handleSave} 
            disabled={saving}
            style={{ marginTop: '10px', padding: '8px', backgroundColor: '#0e639c', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px' }}>
          <p>Cannot edit non-markdown files.</p>
        </div>
      )}
    </div>
  );
}
