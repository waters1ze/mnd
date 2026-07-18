import { useEffect, useState } from 'react';
import { SigmaContainer, ControlsContainer, ZoomControl, FullScreenControl, useRegisterEvents } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Indexer } from '../core/indexer';
import { saveIndexToDb, saveLayoutToDb, loadLayoutFromDb } from '../core/db';
import { GraphNode } from '../core/types';

export function GraphView({ vaultPath, onNodeDoubleClicked }: { vaultPath: string, onNodeDoubleClicked: (node: GraphNode) => void }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    async function loadGraph() {
      try {
        setLoading(true);
        const indexer = new Indexer(vaultPath);
        const index = await indexer.build();
        
        await saveIndexToDb(index);
        const savedLayout = await loadLayoutFromDb();
        
        const g = new Graph();
        
        for (const [id, node] of index.nodes.entries()) {
          const pos = savedLayout[id] || { 
            x: Math.random() * 100, 
            y: Math.random() * 100 
          };
          
          g.addNode(id, {
            ...node,
            x: pos.x,
            y: pos.y,
            size: node.type === 'image' || node.type === 'source_video' ? 15 : 10,
            label: node.title || node.id,
            color: node.isUnresolved ? '#f00' : (node.type === 'mnd' ? '#007acc' : '#ccc')
          });
        }
        
        for (const edge of index.edges) {
          if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
            g.addEdge(edge.source, edge.target, {
              type: 'arrow',
              label: edge.relation,
              size: 2,
              color: '#666'
            });
          }
        }
        
        // Run ForceAtlas2 if there are no saved layouts, or maybe just run it for a few iterations
        if (Object.keys(savedLayout).length === 0 && g.order > 0) {
          forceAtlas2.assign(g, { iterations: 100, settings: { gravity: 10 } });
          
          // Save the computed layout
          const newLayout: Record<string, {x: number, y: number}> = {};
          g.forEachNode((n, attr) => {
            newLayout[n] = { x: attr.x, y: attr.y };
          });
          await saveLayoutToDb(newLayout);
        }
        
        if (isMounted) {
          setGraph(g);
        }
      } catch (err) {
        console.warn('Failed to load graph:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    
    loadGraph();
    
    return () => { isMounted = false; };
  }, [vaultPath]);

  const SigmaEvents = () => {
    const registerEvents = useRegisterEvents();
    
    useEffect(() => {
      registerEvents({
        doubleClickNode: (event: any) => {
          if (graph) {
            const nodeAttr = graph.getNodeAttributes(event.node);
            onNodeDoubleClicked(nodeAttr as GraphNode);
          }
        }
      });
    }, [registerEvents]);
    return null;
  };

  if (loading) {
    return <div style={{ color: 'white', padding: '2rem' }}>Loading Graph...</div>;
  }

  if (!graph) {
    return <div style={{ color: 'white', padding: '2rem' }}>Error loading graph.</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: '#1e1e1e' }}>
      <SigmaContainer style={{ height: "100%", width: "100%" }} graph={graph} settings={{ renderEdgeLabels: true }}>
        <SigmaEvents />
        <ControlsContainer position={"bottom-right"}>
          <ZoomControl />
          <FullScreenControl />
        </ControlsContainer>
      </SigmaContainer>
    </div>
  );
}
