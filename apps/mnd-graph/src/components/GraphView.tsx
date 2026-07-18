import { useEffect, useState } from 'react';
import { SigmaContainer, ControlsContainer, ZoomControl, FullScreenControl, useRegisterEvents, useLoadGraph, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { loadGraph, loadGraphLayout, saveGraphLayout } from '../core/ipc';
import { GraphNode } from '../core/types';
import { Filter, Eye, Tag } from 'lucide-react';

// A component that handles graph loading and layout saving
function GraphDataHandler({ vaultId, setNodesCount, setEdgesCount }: { vaultId: string, setNodesCount: (n: number) => void, setEdgesCount: (n: number) => void }) {
  const loadGraphIntoSigma = useLoadGraph();
  
  useEffect(() => {
    let isMounted = true;
    
    async function init() {
      try {
        const indexData = await loadGraph();
        const savedLayout = await loadGraphLayout();
        
        const g = new Graph();
        
        const nodes = indexData.nodes || {};
        const edges = indexData.edges || [];
        
        for (const [id, node] of Object.entries<any>(nodes)) {
          const pos = savedLayout[id] || { 
            x: Math.random() * 100, 
            y: Math.random() * 100 
          };
          
          g.addNode(id, {
            ...node,
            x: pos.x,
            y: pos.y,
            size: node.type === 'image' || node.type === 'source_video' ? 12 : 8,
            label: node.title || id,
            color: node.isUnresolved ? '#ef4444' : (node.type === 'mnd' ? '#3b82f6' : '#737373')
          });
        }
        
        for (const edge of edges) {
          if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
            g.addEdge(edge.source, edge.target, {
              type: 'arrow',
              label: edge.relation,
              size: 2,
              color: '#404040'
            });
          }
        }
        
        if (Object.keys(savedLayout).length === 0 && g.order > 0) {
          forceAtlas2.assign(g, { iterations: 100, settings: { gravity: 10 } });
          const newLayout: Record<string, {x: number, y: number}> = {};
          g.forEachNode((n, attr) => {
            newLayout[n] = { x: attr.x, y: attr.y };
          });
          await saveGraphLayout(newLayout);
        }
        
        if (isMounted) {
          loadGraphIntoSigma(g);
          setNodesCount(g.order);
          setEdgesCount(g.size);
        }
      } catch (err) {
        console.warn('Failed to load graph data:', err);
      }
    }
    
    init();
    return () => { isMounted = false; };
  }, [vaultId, loadGraphIntoSigma, setNodesCount, setEdgesCount]);
  
  return null;
}

function GraphEvents({ onNodeDoubleClicked }: { onNodeDoubleClicked: (node: GraphNode) => void }) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  
  useEffect(() => {
    registerEvents({
      doubleClickNode: (event: { node: string }) => {
        const nodeAttr = sigma.getGraph().getNodeAttributes(event.node);
        onNodeDoubleClicked(nodeAttr as GraphNode);
      },
      enterNode: (_event: unknown) => {
        // hover card: set cursor
        document.body.style.cursor = "pointer";
      },
      leaveNode: () => {
        document.body.style.cursor = "default";
      }
    });
  }, [registerEvents, onNodeDoubleClicked, sigma]);
  return null;
}

export function GraphView({ vaultId, onNodeDoubleClicked }: { vaultId: string, onNodeDoubleClicked: (node: GraphNode) => void }) {
  const [nodesCount, setNodesCount] = useState(0);
  const [edgesCount, setEdgesCount] = useState(0);
  
  return (
    <div className="flex-1 h-full relative bg-neutral-950">
      
      {/* Top Bar for Filters */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
        
        {/* Graph Stats Card */}
        <div className="bg-neutral-900/90 backdrop-blur border border-neutral-800 rounded-xl px-4 py-2 flex items-center gap-4 shadow-xl pointer-events-auto">
          <div className="flex flex-col">
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Nodes</span>
            <span className="text-sm font-mono text-neutral-200">{nodesCount}</span>
          </div>
          <div className="w-px h-8 bg-neutral-800" />
          <div className="flex flex-col">
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Edges</span>
            <span className="text-sm font-mono text-neutral-200">{edgesCount}</span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-neutral-900/90 backdrop-blur border border-neutral-800 rounded-xl p-1 flex items-center shadow-xl pointer-events-auto">
          <button className="px-3 py-1.5 flex items-center gap-2 rounded-lg text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">
            <Filter className="w-4 h-4" /> Filter
          </button>
          <button className="px-3 py-1.5 flex items-center gap-2 rounded-lg text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">
            <Tag className="w-4 h-4" /> Type
          </button>
          <button className="px-3 py-1.5 flex items-center gap-2 rounded-lg text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">
            <Eye className="w-4 h-4" /> Depth
          </button>
        </div>
      </div>

      <SigmaContainer 
        style={{ width: "100%", height: "100%" }} 
        settings={{ 
          renderEdgeLabels: true,
          defaultNodeColor: "#737373",
          defaultEdgeColor: "#404040",
          labelFont: "inherit",
          labelWeight: "500",
          labelColor: { color: "#e5e5e5" }
        }}
      >
        <GraphDataHandler vaultId={vaultId} setNodesCount={setNodesCount} setEdgesCount={setEdgesCount} />
        <GraphEvents onNodeDoubleClicked={onNodeDoubleClicked} />
        
        <ControlsContainer position="bottom-right" className="!bg-neutral-900 !border-neutral-800 !rounded-xl overflow-hidden shadow-xl mb-4 mr-4">
          <ZoomControl className="!bg-neutral-900 hover:!bg-neutral-800 !text-neutral-300 !border-neutral-800" />
          <FullScreenControl className="!bg-neutral-900 hover:!bg-neutral-800 !text-neutral-300 !border-neutral-800" />
        </ControlsContainer>
      </SigmaContainer>
    </div>
  );
}
