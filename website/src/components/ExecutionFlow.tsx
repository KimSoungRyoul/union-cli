import React from 'react';
import { Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import ReactFlowDiagram from './ReactFlowDiagram';

/* ------------------------------------------------------------------ */
/* Color mapping per step — matches architecture layer palette          */
/* ------------------------------------------------------------------ */
const STEP_PALETTE = [
  { bg: '#e0e7ff', border: '#a5b4fc', text: '#312e81' }, // 1 User Input — Interface
  { bg: '#c7d2fe', border: '#818cf8', text: '#312e81' }, // 2 oclif Parser — Build
  { bg: '#c7d2fe', border: '#818cf8', text: '#312e81' }, // 3 Init Hook — Build
  { bg: '#a5b4fc', border: '#6366f1', text: '#1e1b4b' }, // 4 Executor — CLI
  { bg: '#818cf8', border: '#4f46e5', text: '#ffffff' }, // 5 HTTP Provider — Provider
  { bg: '#818cf8', border: '#4f46e5', text: '#ffffff' }, // 6 fetch() — Provider
  { bg: '#6366f1', border: '#4338ca', text: '#ffffff' }, // 7 Output Formatter — Core
  { bg: '#4f46e5', border: '#3730a3', text: '#ffffff' }, // 8 Result — Core
] as const;

/* ------------------------------------------------------------------ */
/* Custom Node                                                         */
/* ------------------------------------------------------------------ */

type StepNodeData = {
  label: string;
  description: string;
  stepIndex: number;
  color: string;
  isTerminal?: boolean;
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const idx = data.stepIndex as number;
  const palette = STEP_PALETTE[idx];
  const isTerminal = data.isTerminal as boolean | undefined;

  return (
    <div
      style={{
        background: palette.bg,
        border: `2px solid ${palette.border}`,
        borderRadius: 12,
        padding: '14px 18px',
        minWidth: 150,
        maxWidth: 180,
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: palette.text,
          marginBottom: 4,
          fontFamily: (data.label as string).startsWith('$') ? 'var(--ifm-font-family-monospace)' : 'inherit',
          wordBreak: 'break-word',
        }}
      >
        {data.label as string}
      </div>
      <div
        style={{
          fontSize: 11,
          color: palette.text,
          opacity: 0.72,
          lineHeight: 1.4,
        }}
      >
        {data.description as string}
      </div>
      {!isTerminal && (
        <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
      )}
    </div>
  );
}

const nodeTypes = { stepNode: StepNode };

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */
const COL_WIDTH = 200;
const ROW_1_Y = 40;
const ROW_2_Y = 200;

const steps: Array<{ label: string; description: string }> = [
  { label: '$ my-cli api users list --json', description: '사용자 입력' },
  { label: 'oclif Parser', description: '커맨드 / 플래그 파싱' },
  { label: 'Init Hook', description: 'manifest 로드 + provider 등록' },
  { label: 'Executor', description: 'namespace → provider 선택' },
  { label: 'HTTP Provider', description: 'URL / Body / Auth 구성' },
  { label: 'fetch()', description: 'POST https://api.../users' },
  { label: 'Output Formatter', description: '--json → JSON.stringify' },
  { label: 'Result', description: 'stdout 출력' },
];

const nodes: Node[] = steps.map((step, i) => {
  // Two rows of 4 for a clean layout
  const row = i < 4 ? 0 : 1;
  const col = i < 4 ? i : i - 4;

  return {
    id: `step-${i}`,
    type: 'stepNode',
    position: {
      x: 40 + col * COL_WIDTH,
      y: row === 0 ? ROW_1_Y : ROW_2_Y,
    },
    data: {
      label: step.label,
      description: step.description,
      stepIndex: i,
      color: STEP_PALETTE[i].bg,
      isTerminal: i === steps.length - 1,
    },
  };
});

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */
const animatedEdge = {
  type: 'smoothstep' as const,
  animated: true,
  style: { stroke: '#6366f1', strokeWidth: 2 },
};

const edges: Edge[] = [
  // Row 1: left-to-right
  { id: 'e-0-1', source: 'step-0', target: 'step-1', ...animatedEdge },
  { id: 'e-1-2', source: 'step-1', target: 'step-2', ...animatedEdge },
  { id: 'e-2-3', source: 'step-2', target: 'step-3', ...animatedEdge },
  // Row 1 → Row 2 transition
  { id: 'e-3-4', source: 'step-3', target: 'step-4', ...animatedEdge },
  // Row 2: left-to-right
  { id: 'e-4-5', source: 'step-4', target: 'step-5', ...animatedEdge },
  { id: 'e-5-6', source: 'step-5', target: 'step-6', ...animatedEdge },
  { id: 'e-6-7', source: 'step-6', target: 'step-7', ...animatedEdge },
];

/* ------------------------------------------------------------------ */
/* Exported Component                                                  */
/* ------------------------------------------------------------------ */

export default function ExecutionFlow(): JSX.Element {
  return (
    <ReactFlowDiagram
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      style={{ height: 420 }}
    />
  );
}
