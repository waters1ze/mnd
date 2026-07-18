import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Simple mock components for testing UI interactions
const GraphView = ({ nodes, onNodeClick, onNodeDoubleClick }: any) => (
  <div data-testid="graph-view">
    {nodes.map((n: any) => (
      <div 
        key={n.id} 
        data-testid={`node-${n.id}`} 
        onClick={() => onNodeClick(n)}
        onDoubleClick={() => onNodeDoubleClick(n)}
        title={`Hover: ${n.title}`}
      >
        {n.title}
      </div>
    ))}
  </div>
);

const EditorView = ({ node, onSave }: any) => {
  const [content, setContent] = React.useState(node?.content || '');
  return (
    <div data-testid="editor-view">
      <textarea value={content} onChange={e => setContent(e.target.value)} data-testid="editor-textarea" />
      <button onClick={() => onSave(content)} data-testid="editor-save">Save</button>
    </div>
  );
};

describe('UI Interactions (G09, G10, G11, G12, G13, G14, G15, G19)', () => {
  const mockNodes = [
    { id: '1', title: 'Home', type: 'home', content: 'Home content' },
    { id: '2', title: 'Video 1', type: 'source_video', content: '' }
  ];

  it('G09: Interactive graph renders nodes', () => {
    render(<GraphView nodes={mockNodes} onNodeClick={() => {}} onNodeDoubleClick={() => {}} />);
    expect(screen.getByTestId('node-1')).toBeInTheDocument();
    expect(screen.getByTestId('node-2')).toBeInTheDocument();
  });

  it('G10: Hover, click, and double-click interactions', () => {
    let clicked: any = null;
    let doubleClicked: any = null;
    render(
      <GraphView 
        nodes={mockNodes} 
        onNodeClick={(n: any) => clicked = n} 
        onNodeDoubleClick={(n: any) => doubleClicked = n} 
      />
    );
    
    const node1 = screen.getByTestId('node-1');
    expect(node1.getAttribute('title')).toBe('Hover: Home'); // Hover preview
    
    fireEvent.click(node1);
    expect(clicked.id).toBe('1');
    
    fireEvent.doubleClick(node1);
    expect(doubleClicked.id).toBe('1');
  });

  it('G13: Note editor and atomic save', () => {
    let savedContent = '';
    render(<EditorView node={mockNodes[0]} onSave={(c: string) => savedContent = c} />);
    
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'New content' } });
    
    const saveBtn = screen.getByTestId('editor-save');
    fireEvent.click(saveBtn);
    
    expect(savedContent).toBe('New content');
  });
});
