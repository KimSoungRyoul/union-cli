import React, { useCallback } from 'react';
import { Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import ReactFlowDiagram from './ReactFlowDiagram';

/* ------------------------------------------------------------------ */
/* Color palette — lighter at top, deeper at bottom                    */
/* ------------------------------------------------------------------ */
const LAYER_COLORS = {
  1: { bg: '#e0e7ff', border: '#a5b4fc', text: '#312e81' },
  2: { bg: '#c7d2fe', border: '#818cf8', text: '#312e81' },
  3: { bg: '#a5b4fc', border: '#6366f1', text: '#1e1b4b' },
  4: { bg: '#818cf8', border: '#4f46e5', text: '#ffffff' },
  5: { bg: '#6366f1', border: '#4338ca', text: '#ffffff' },
} as const;

const SUB_COLORS = {
  provider: { bg: '#c4b5fd', border: '#7c3aed', text: '#1e1b4b' },
  core: { bg: '#a78bfa', border: '#6d28d9', text: '#ffffff' },
} as const;

/* ------------------------------------------------------------------ */
/* Custom Node Components                                              */
/* ------------------------------------------------------------------ */

type LayerNodeData = {
  label: string;
  subtitle: string;
  layer: number;
  color: string;
};

function LayerNode({ data }: NodeProps<Node<LayerNodeData>>) {
  const layer = data.layer as number;
  const palette = LAYER_COLORS[layer as keyof typeof LAYER_COLORS];

  return (
    <div
      style={{
        background: palette.bg,
        border: `2px solid ${palette.border}`,
        borderRadius: 12,
        padding: '16px 28px',
        minWidth: 560,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: palette.text,
          marginBottom: 4,
        }}
      >
        {data.label as string}
      </div>
      <div style={{ fontSize: 12, color: palette.text, opacity: 0.75 }}>
        {data.subtitle as string}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

type SubNodeData = {
  label: string;
  variant: 'provider' | 'core';
  color: string;
};

function SubNode({ data }: NodeProps<Node<SubNodeData>>) {
  const variant = (data.variant as string) || 'provider';
  const palette = SUB_COLORS[variant as keyof typeof SUB_COLORS];

  return (
    <div
      style={{
        background: palette.bg,
        border: `2px solid ${palette.border}`,
        borderRadius: 8,
        padding: '8px 16px',
        textAlign: 'center',
        minWidth: 90,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: palette.text }}>
        {data.label as string}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

const nodeTypes = {
  layerNode: LayerNode,
  subNode: SubNode,
};

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */
const CENTER_X = 350;
const LAYER_GAP = 120;
const START_Y = 30;

function layerY(index: number): number {
  return START_Y + index * LAYER_GAP;
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */
const nodes: Node[] = [
  // Layer 1
  {
    id: 'layer1',
    type: 'layerNode',
    position: { x: CENTER_X - 280, y: layerY(0) },
    data: {
      label: 'Layer 1: Interface',
      subtitle: 'plugins/*.yaml — 사용자가 작성하는 유일한 파일',
      layer: 1,
      color: LAYER_COLORS[1].bg,
    },
  },
  // Layer 2
  {
    id: 'layer2',
    type: 'layerNode',
    position: { x: CENTER_X - 280, y: layerY(1) },
    data: {
      label: 'Layer 2: Build',
      subtitle: 'YAML 파싱 → 검증 → Codegen',
      layer: 2,
      color: LAYER_COLORS[2].bg,
    },
  },
  // Layer 3
  {
    id: 'layer3',
    type: 'layerNode',
    position: { x: CENTER_X - 280, y: layerY(2) },
    data: {
      label: 'Layer 3: CLI',
      subtitle: 'oclif — 커맨드 파싱, 플래그, 도움말',
      layer: 3,
      color: LAYER_COLORS[3].bg,
    },
  },
  // Layer 4 — main
  {
    id: 'layer4',
    type: 'layerNode',
    position: { x: CENTER_X - 280, y: layerY(3) },
    data: {
      label: 'Layer 4: Provider',
      subtitle: 'HTTP / CLI / Python / JS — 외부 시스템 연결 계층',
      layer: 4,
      color: LAYER_COLORS[4].bg,
    },
  },
  // Layer 4 — sub-nodes
  {
    id: 'sub-http',
    type: 'subNode',
    position: { x: CENTER_X - 250, y: layerY(3) + 76 },
    data: { label: 'HTTP', variant: 'provider', color: SUB_COLORS.provider.bg },
  },
  {
    id: 'sub-cli',
    type: 'subNode',
    position: { x: CENTER_X - 110, y: layerY(3) + 76 },
    data: { label: 'CLI', variant: 'provider', color: SUB_COLORS.provider.bg },
  },
  {
    id: 'sub-python',
    type: 'subNode',
    position: { x: CENTER_X + 30, y: layerY(3) + 76 },
    data: { label: 'Python', variant: 'provider', color: SUB_COLORS.provider.bg },
  },
  {
    id: 'sub-js',
    type: 'subNode',
    position: { x: CENTER_X + 170, y: layerY(3) + 76 },
    data: { label: 'JS', variant: 'provider', color: SUB_COLORS.provider.bg },
  },

  // Layer 5 — main
  {
    id: 'layer5',
    type: 'layerNode',
    position: { x: CENTER_X - 280, y: layerY(4) + 60 },
    data: {
      label: 'Layer 5: Core',
      subtitle: 'Auth, Output, Config, CredentialStore, Error — 공통 인프라',
      layer: 5,
      color: LAYER_COLORS[5].bg,
    },
  },
  // Layer 5 — sub-nodes
  {
    id: 'sub-auth',
    type: 'subNode',
    position: { x: CENTER_X - 280, y: layerY(4) + 136 },
    data: { label: 'Auth', variant: 'core', color: SUB_COLORS.core.bg },
  },
  {
    id: 'sub-output',
    type: 'subNode',
    position: { x: CENTER_X - 160, y: layerY(4) + 136 },
    data: { label: 'Output', variant: 'core', color: SUB_COLORS.core.bg },
  },
  {
    id: 'sub-config',
    type: 'subNode',
    position: { x: CENTER_X - 40, y: layerY(4) + 136 },
    data: { label: 'Config', variant: 'core', color: SUB_COLORS.core.bg },
  },
  {
    id: 'sub-cred',
    type: 'subNode',
    position: { x: CENTER_X + 80, y: layerY(4) + 136 },
    data: { label: 'CredentialStore', variant: 'core', color: SUB_COLORS.core.bg },
  },
  {
    id: 'sub-error',
    type: 'subNode',
    position: { x: CENTER_X + 230, y: layerY(4) + 136 },
    data: { label: 'Error', variant: 'core', color: SUB_COLORS.core.bg },
  },
];

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */
const edgeDefaults = {
  type: 'smoothstep' as const,
  animated: false,
  style: { stroke: '#6366f1', strokeWidth: 2 },
};

const edges: Edge[] = [
  { id: 'e1-2', source: 'layer1', target: 'layer2', ...edgeDefaults },
  { id: 'e2-3', source: 'layer2', target: 'layer3', ...edgeDefaults },
  { id: 'e3-4', source: 'layer3', target: 'layer4', ...edgeDefaults },
  { id: 'e4-5', source: 'layer4', target: 'layer5', ...edgeDefaults },
  // sub-edges from layer4 to sub-nodes
  { id: 'e4-http', source: 'layer4', target: 'sub-http', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e4-cli', source: 'layer4', target: 'sub-cli', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e4-python', source: 'layer4', target: 'sub-python', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e4-js', source: 'layer4', target: 'sub-js', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  // sub-edges from layer5 to sub-nodes
  { id: 'e5-auth', source: 'layer5', target: 'sub-auth', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e5-output', source: 'layer5', target: 'sub-output', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e5-config', source: 'layer5', target: 'sub-config', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e5-cred', source: 'layer5', target: 'sub-cred', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
  { id: 'e5-error', source: 'layer5', target: 'sub-error', ...edgeDefaults, style: { ...edgeDefaults.style, strokeDasharray: '6 3' } },
];

/* ------------------------------------------------------------------ */
/* Exported Component                                                  */
/* ------------------------------------------------------------------ */

export default function ArchitectureFlow(): JSX.Element {
  return (
    <ReactFlowDiagram
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      style={{ height: 700 }}
    />
  );
}
