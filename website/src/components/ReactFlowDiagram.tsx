import React from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useColorMode } from '@docusaurus/theme-common';
import styles from './ReactFlowDiagram.module.css';

interface ReactFlowDiagramProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes?: NodeTypes;
  style?: React.CSSProperties;
  fitView?: boolean;
  minZoom?: number;
  maxZoom?: number;
}

export default function ReactFlowDiagram({
  nodes,
  edges,
  nodeTypes,
  style,
  fitView = true,
  minZoom = 0.5,
  maxZoom = 1.5,
}: ReactFlowDiagramProps): JSX.Element {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  return (
    <div className={styles.container} style={style}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={fitView}
        minZoom={minZoom}
        maxZoom={maxZoom}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        colorMode={isDark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            return (node.data?.color as string) || '#4f46e5';
          }}
          maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'}
          style={{ borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}
