import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  Compass,
  FileText,
  Maximize2,
  MessageSquareText,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  GraphEdge,
  GraphNode,
  GraphNodeType,
  PolicyConflict,
  PolicyDocument,
  PolicyKnowledgeGraph,
} from '../types/policy';
import {
  getConflictPoints,
  splitHighlightedExcerpt,
} from '../utils/conflictHighlight';
import { CONFLICT_TYPE_LABELS } from '../utils/labels';
import { SeverityLabel } from './SeverityLabel';

export interface GraphHighlightState {
  label: string;
  nodeIds: string[];
  edgeIds: string[];
}

interface KnowledgeGraphViewProps {
  graph?: PolicyKnowledgeGraph;
  policies: PolicyDocument[];
  conflicts: PolicyConflict[];
  selectedPolicyScope: string;
  onSelectPolicyScope: (policyId: string) => void;
  highlightSubgraph: GraphHighlightState | null;
  onClearHighlight: () => void;
  onRebuildGraph: () => Promise<void>;
  onJumpToConflict: (conflictId?: string) => void;
  onJumpToPolicy: (policyId: string) => void;
  onAskAboutNode: (question: string) => void;
}

type GraphFilterMode = 'all' | 'conflicts' | 'structure' | 'rules';

interface Point {
  x: number;
  y: number;
}

const NODE_TYPE_META: Record<
  GraphNodeType,
  { label: string; color: string; stroke: string; radius: number }
> = {
  policy: {
    label: '制度文档',
    color: '#1D4ED8',
    stroke: '#1E3A8A',
    radius: 22,
  },
  clause: {
    label: '制度条款',
    color: '#334155',
    stroke: '#0F172A',
    radius: 13,
  },
  role: {
    label: '审批/责任角色',
    color: '#4F46E5',
    stroke: '#312E81',
    radius: 15,
  },
  rule: {
    label: '规则阈值',
    color: '#D97706',
    stroke: '#92400E',
    radius: 13,
  },
  topic: {
    label: '适用主题',
    color: '#059669',
    stroke: '#065F46',
    radius: 14,
  },
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 760;

function computeDeterministicLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusPolicyNodeId?: string
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  if (nodes.length === 0) return positions;

  // When scoped to a single policy file, anchor all nodes around canvas center radially
  if (focusPolicyNodeId) {
    const vel: Record<string, Point> = {};
    nodes.forEach((node, idx) => {
      if (node.id === focusPolicyNodeId) {
        positions[node.id] = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
      } else {
        const goldenAngle = idx * 2.3999632;
        const dist =
          node.type === 'clause'
            ? 145
            : node.type === 'role' || node.type === 'topic'
              ? 235
              : 270;
        positions[node.id] = {
          x: CANVAS_WIDTH / 2 + Math.cos(goldenAngle) * dist,
          y: CANVAS_HEIGHT / 2 + Math.sin(goldenAngle) * dist,
        };
      }
      vel[node.id] = { x: 0, y: 0 };
    });

    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const iterations = Math.min(200, Math.max(110, nodes.length * 4));
    for (let iter = 0; iter < iterations; iter++) {
      const cooling = 1 - iter / iterations;
      const forces: Record<string, Point> = {};
      for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const pa = positions[a.id];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const pb = positions[b.id];
          let dx = pa.x - pb.x;
          let dy = pa.y - pb.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) {
            dx = (i % 2 === 0 ? 1 : -1) * 3;
            dy = (j % 2 === 0 ? 1 : -1) * 3;
            distSq = 18;
          }
          const dist = Math.sqrt(distSq);
          const minSpacing = a.type === 'policy' || b.type === 'policy' ? 140 : 102;
          const repulse =
            11500 / distSq + (dist < minSpacing ? (minSpacing - dist) * 0.65 : 0);
          const fx = (dx / dist) * repulse;
          const fy = (dy / dist) * repulse;
          forces[a.id].x += fx;
          forces[a.id].y += fy;
          forces[b.id].x -= fx;
          forces[b.id].y -= fy;
        }
      }

      for (const edge of edges) {
        if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) continue;
        const ps = positions[edge.source];
        const pt = positions[edge.target];
        const dx = pt.x - ps.x;
        const dy = pt.y - ps.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ideal =
          edge.relation === 'contains'
            ? 145
            : edge.relation === 'conflicts_with'
              ? 200
              : 140;
        const strength = edge.relation === 'contains' ? 0.065 : 0.038;
        const pull = (dist - ideal) * strength;
        const fx = (dx / dist) * pull;
        const fy = (dy / dist) * pull;
        forces[edge.source].x += fx;
        forces[edge.source].y += fy;
        forces[edge.target].x -= fx;
        forces[edge.target].y -= fy;
      }

      for (const node of nodes) {
        const p = positions[node.id];
        if (node.id === focusPolicyNodeId) {
          forces[node.id].x += (CANVAS_WIDTH / 2 - p.x) * 0.14;
          forces[node.id].y += (CANVAS_HEIGHT / 2 - p.y) * 0.14;
        } else {
          forces[node.id].x += (CANVAS_WIDTH / 2 - p.x) * 0.008;
          forces[node.id].y += (CANVAS_HEIGHT / 2 - p.y) * 0.008;
        }
        vel[node.id].x = (vel[node.id].x + forces[node.id].x) * 0.62;
        vel[node.id].y = (vel[node.id].y + forces[node.id].y) * 0.62;

        const stepLimit = 22 * cooling + 2;
        const vx = Math.max(-stepLimit, Math.min(stepLimit, vel[node.id].x));
        const vy = Math.max(-stepLimit, Math.min(stepLimit, vel[node.id].y));

        p.x = Math.max(82, Math.min(CANVAS_WIDTH - 82, p.x + vx));
        p.y = Math.max(62, Math.min(CANVAS_HEIGHT - 62, p.y + vy));
      }
    }
    return positions;
  }

  // Group nodes by community for well-separated cluster centers
  const communities = Array.from(
    new Set(nodes.map((n) => n.communityId || 'default'))
  );
  const commCenter = new Map<string, Point>();
  communities.forEach((cid, idx) => {
    const angle = (idx / Math.max(1, communities.length)) * Math.PI * 2 - Math.PI / 2;
    const rx = communities.length > 1 ? 340 : 0;
    const ry = communities.length > 1 ? 210 : 0;
    commCenter.set(cid, {
      x: CANVAS_WIDTH / 2 + Math.cos(angle) * rx,
      y: CANVAS_HEIGHT / 2 + Math.sin(angle) * ry,
    });
  });

  // Deterministic initial placement around community centroids
  const vel: Record<string, Point> = {};
  nodes.forEach((node, idx) => {
    const center = commCenter.get(node.communityId || 'default') ?? {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
    };
    const goldenAngle = idx * 2.3999632;
    const dist =
      node.type === 'policy' ? 40 : node.type === 'role' || node.type === 'topic' ? 120 : 185;
    positions[node.id] = {
      x: center.x + Math.cos(goldenAngle) * dist,
      y: center.y + Math.sin(goldenAngle) * dist,
    };
    vel[node.id] = { x: 0, y: 0 };
  });

  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const iterations = Math.min(220, Math.max(110, nodes.length * 3));

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const forces: Record<string, Point> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // Pairwise repulsion with strong minimum node separation
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const pa = positions[a.id];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const pb = positions[b.id];
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (i % 2 === 0 ? 1 : -1) * 3;
          dy = (j % 2 === 0 ? 1 : -1) * 3;
          distSq = 18;
        }
        const dist = Math.sqrt(distSq);
        const minSpacing = a.type === 'policy' || b.type === 'policy' ? 122 : 90;
        const repulse =
          10500 / distSq + (dist < minSpacing ? (minSpacing - dist) * 0.6 : 0);
        const fx = (dx / dist) * repulse;
        const fy = (dy / dist) * repulse;
        forces[a.id].x += fx;
        forces[a.id].y += fy;
        forces[b.id].x -= fx;
        forces[b.id].y -= fy;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) continue;
      const ps = positions[edge.source];
      const pt = positions[edge.target];
      const dx = pt.x - ps.x;
      const dy = pt.y - ps.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ideal =
        edge.relation === 'contains'
          ? 112
          : edge.relation === 'conflicts_with'
          ? 195
          : 142;
      const strength = edge.relation === 'contains' ? 0.065 : 0.035;
      const pull = (dist - ideal) * strength;
      const fx = (dx / dist) * pull;
      const fy = (dy / dist) * pull;
      forces[edge.source].x += fx;
      forces[edge.source].y += fy;
      forces[edge.target].x -= fx;
      forces[edge.target].y -= fy;
    }

    // Gentle gravity toward community centroid
    for (const node of nodes) {
      const p = positions[node.id];
      const cc = commCenter.get(node.communityId || 'default') ?? {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
      };
      forces[node.id].x += (cc.x - p.x) * 0.012 + (CANVAS_WIDTH / 2 - p.x) * 0.0025;
      forces[node.id].y += (cc.y - p.y) * 0.012 + (CANVAS_HEIGHT / 2 - p.y) * 0.0025;

      vel[node.id].x = (vel[node.id].x + forces[node.id].x) * 0.62;
      vel[node.id].y = (vel[node.id].y + forces[node.id].y) * 0.62;

      const stepLimit = 22 * cooling + 2;
      const vx = Math.max(-stepLimit, Math.min(stepLimit, vel[node.id].x));
      const vy = Math.max(-stepLimit, Math.min(stepLimit, vel[node.id].y));

      p.x = Math.max(76, Math.min(CANVAS_WIDTH - 76, p.x + vx));
      p.y = Math.max(58, Math.min(CANVAS_HEIGHT - 58, p.y + vy));
    }
  }

  return positions;
}

function truncateLabel(label: string, maxLen = 11): string {
  return label.length > maxLen ? `${label.slice(0, maxLen)}…` : label;
}

function estimateSvgTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.56;
  }
  return width;
}

function formatNodeDisplayLines(node: GraphNode): {
  primary: string;
  secondary?: string;
} {
  if (node.type === 'clause') {
    const parts = node.label.split('·');
    const policyPrefix = node.policyTitle
      ? truncateLabel(node.policyTitle, 9)
      : truncateLabel(parts[0] ?? node.label, 9);
    const clausePart =
      parts.length > 1
        ? parts.slice(1).join('·')
        : node.clauseRef || node.label;
    return {
      primary: policyPrefix,
      secondary: truncateLabel(clausePart, 13),
    };
  }
  if (node.type === 'policy') {
    return { primary: truncateLabel(node.label, 14) };
  }
  return { primary: truncateLabel(node.label, 14) };
}

function buildConflictBadgeInfo(
  edge: GraphEdge,
  conflict?: PolicyConflict
): {
  headline: string;
  detail: string;
  resolved: boolean;
} {
  if (!conflict) {
    return {
      headline: truncateLabel(edge.label || '跨制度冲突', 16),
      detail: '',
      resolved: false,
    };
  }
  const points = getConflictPoints(conflict);
  const firstPt = points[0];
  const resolved = conflict.status === 'resolved';
  const headlineBase =
    conflict.title.length <= 16
      ? conflict.title
      : firstPt?.dimension || truncateLabel(conflict.title, 16);
  const headline = resolved ? `已解决 · ${headlineBase}` : headlineBase;
  const detail = firstPt
    ? `${truncateLabel(firstPt.valueA, 11)} ≠ ${truncateLabel(firstPt.valueB, 11)}`
    : '';
  return { headline, detail, resolved };
}

export function KnowledgeGraphView({
  graph,
  policies,
  conflicts,
  selectedPolicyScope,
  onSelectPolicyScope,
  highlightSubgraph,
  onClearHighlight,
  onRebuildGraph,
  onJumpToConflict,
  onJumpToPolicy,
  onAskAboutNode,
}: KnowledgeGraphViewProps) {
  const [filterMode, setFilterMode] = useState<GraphFilterMode>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConflictEdgeId, setSelectedConflictEdgeId] = useState<string | null>(null);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  // Viewport transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [customPositions, setCustomPositions] = useState<Record<string, Point>>({});
  const dragStateRef = useRef<{
    kind: 'pan' | 'node';
    nodeId?: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const activePolicies = useMemo(
    () => policies.filter((p) => p.status !== 'archived'),
    [policies]
  );

  const scopedPolicy = useMemo(
    () =>
      selectedPolicyScope !== 'all'
        ? activePolicies.find((p) => p.id === selectedPolicyScope) ?? null
        : null,
    [activePolicies, selectedPolicyScope]
  );

  const rawNodes = graph?.nodes ?? [];
  const rawEdges = graph?.edges ?? [];
  const rawCommunities = graph?.communities ?? [];

  // Scope graph to either all policies or a single selected policy (ego-subgraph)
  const { scopedNodes, scopedEdges, scopedCommunities } = useMemo(() => {
    if (!scopedPolicy) {
      return {
        scopedNodes: rawNodes,
        scopedEdges: rawEdges,
        scopedCommunities: rawCommunities,
      };
    }

    const seedNodeIds = new Set<string>(
      rawNodes
        .filter(
          (n) => n.policyId === scopedPolicy.id || n.id === `pol:${scopedPolicy.id}`
        )
        .map((n) => n.id)
    );

    const edgesForPolicy = rawEdges.filter(
      (e) => seedNodeIds.has(e.source) || seedNodeIds.has(e.target)
    );

    const includedNodeIds = new Set<string>(seedNodeIds);
    for (const e of edgesForPolicy) {
      includedNodeIds.add(e.source);
      includedNodeIds.add(e.target);
    }

    const nodesForPolicy = rawNodes.filter((n) => includedNodeIds.has(n.id));
    const commsForPolicy = rawCommunities.filter((c) =>
      c.policyIds.includes(scopedPolicy.id)
    );

    return {
      scopedNodes: nodesForPolicy,
      scopedEdges: edgesForPolicy,
      scopedCommunities: commsForPolicy,
    };
  }, [rawNodes, rawEdges, rawCommunities, scopedPolicy]);

  // Filter nodes & edges cleanly within current policy scope
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (scopedNodes.length === 0) {
      return { visibleNodes: [] as GraphNode[], visibleEdges: [] as GraphEdge[] };
    }

    let candidateEdges = scopedEdges;
    if (filterMode === 'conflicts') {
      candidateEdges = scopedEdges.filter((e) => e.relation === 'conflicts_with');
    } else if (filterMode === 'structure') {
      candidateEdges = scopedEdges.filter(
        (e) => e.relation === 'contains' || e.relation === 'references'
      );
    } else if (filterMode === 'rules') {
      candidateEdges = scopedEdges.filter(
        (e) =>
          e.relation === 'requires_approval' ||
          e.relation === 'defines_rule' ||
          e.relation === 'applies_to' ||
          e.relation === 'conflicts_with'
      );
    }

    const connectedNodeIds = new Set<string>();
    for (const e of candidateEdges) {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    }

    let nodesFiltered =
      filterMode === 'all'
        ? scopedNodes
        : scopedNodes.filter((n) => connectedNodeIds.has(n.id));

    const q = searchTerm.trim().toLowerCase();
    if (q) {
      const matchedIds = new Set(
        nodesFiltered
          .filter(
            (n) =>
              n.label.toLowerCase().includes(q) ||
              (n.summary ?? '').toLowerCase().includes(q) ||
              (n.clauseRef ?? '').toLowerCase().includes(q)
          )
          .map((n) => n.id)
      );
      // Include 1-hop neighbors of matched nodes so graph context stays intact
      const expandedIds = new Set(matchedIds);
      for (const e of candidateEdges) {
        if (matchedIds.has(e.source)) expandedIds.add(e.target);
        if (matchedIds.has(e.target)) expandedIds.add(e.source);
      }
      nodesFiltered = nodesFiltered.filter((n) => expandedIds.has(n.id));
    }

    const finalNodeSet = new Set(nodesFiltered.map((n) => n.id));
    const edgesFiltered = candidateEdges.filter(
      (e) => finalNodeSet.has(e.source) && finalNodeSet.has(e.target)
    );

    return { visibleNodes: nodesFiltered, visibleEdges: edgesFiltered };
  }, [scopedNodes, scopedEdges, filterMode, searchTerm]);

  const basePositions = useMemo(
    () =>
      computeDeterministicLayout(
        visibleNodes,
        visibleEdges,
        scopedPolicy ? `pol:${scopedPolicy.id}` : undefined
      ),
    [visibleNodes, visibleEdges, scopedPolicy]
  );

  // Reset custom dragged coordinates when graph topology, scope, or filter changes
  useEffect(() => {
    setCustomPositions({});
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [graph?.updatedAt, selectedPolicyScope, filterMode, searchTerm]);

  const getNodePos = (id: string): Point =>
    customPositions[id] ?? basePositions[id] ?? { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };

  const conflictById = useMemo(
    () => new Map(conflicts.map((c) => [c.id, c])),
    [conflicts]
  );

  const selectedConflictEdge = useMemo(
    () =>
      selectedConflictEdgeId
        ? rawEdges.find(
            (e) => e.id === selectedConflictEdgeId && e.relation === 'conflicts_with'
          ) ?? null
        : null,
    [rawEdges, selectedConflictEdgeId]
  );

  const selectedConflict = useMemo(
    () =>
      selectedConflictEdge?.conflictId
        ? conflictById.get(selectedConflictEdge.conflictId) ?? null
        : null,
    [selectedConflictEdge, conflictById]
  );

  // Determine active highlight sets (either selectedConflictEdge, selectedNode, selectedCommunity, or GraphRAG query subgraph)
  const activeHighlight = useMemo(() => {
    if (selectedConflictEdge) {
      return {
        nodeIds: new Set<string>([
          selectedConflictEdge.source,
          selectedConflictEdge.target,
        ]),
        edgeIds: new Set<string>([selectedConflictEdge.id]),
      };
    }

    if (selectedNodeId) {
      const neighborNodes = new Set<string>([selectedNodeId]);
      const neighborEdges = new Set<string>();
      for (const e of visibleEdges) {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          neighborNodes.add(e.source);
          neighborNodes.add(e.target);
          neighborEdges.add(e.id);
        }
      }
      return { nodeIds: neighborNodes, edgeIds: neighborEdges };
    }

    if (selectedCommunityId) {
      const comm = scopedCommunities.find((c) => c.id === selectedCommunityId);
      const commNodes = new Set(comm?.nodeIds ?? []);
      const commEdges = new Set(
        visibleEdges
          .filter((e) => commNodes.has(e.source) && commNodes.has(e.target))
          .map((e) => e.id)
      );
      return { nodeIds: commNodes, edgeIds: commEdges };
    }

    if (highlightSubgraph && highlightSubgraph.nodeIds.length > 0) {
      return {
        nodeIds: new Set(highlightSubgraph.nodeIds),
        edgeIds: new Set(highlightSubgraph.edgeIds),
      };
    }

    return null;
  }, [
    selectedConflictEdge,
    selectedNodeId,
    selectedCommunityId,
    scopedCommunities,
    highlightSubgraph,
    visibleEdges,
  ]);

  const selectedNode = useMemo(
    () => rawNodes.find((n) => n.id === selectedNodeId) ?? null,
    [rawNodes, selectedNodeId]
  );

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) return [];
    const map = new Map(rawNodes.map((n) => [n.id, n]));
    return rawEdges
      .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
      .map((edge) => {
        const isOutgoing = edge.source === selectedNode.id;
        const otherId = isOutgoing ? edge.target : edge.source;
        return {
          edge,
          other: map.get(otherId),
          direction: isOutgoing ? 'out' : 'in',
        };
      })
      .filter((item): item is { edge: GraphEdge; other: GraphNode; direction: string } =>
        Boolean(item.other)
      )
      .sort((a, b) => {
        if (a.edge.relation === 'conflicts_with' && b.edge.relation !== 'conflicts_with')
          return -1;
        if (b.edge.relation === 'conflicts_with' && a.edge.relation !== 'conflicts_with')
          return 1;
        return 0;
      });
  }, [selectedNode, rawNodes, rawEdges]);

  const conflictEdges = useMemo(
    () => scopedEdges.filter((e) => e.relation === 'conflicts_with'),
    [scopedEdges]
  );

  const handleRebuild = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    setRebuildMessage(null);
    try {
      await onRebuildGraph();
      setRebuildMessage('已完成 AI 深度实体抽取与图谱重构。');
    } catch (err) {
      setRebuildMessage(
        err instanceof Error ? err.message : 'AI 图谱抽取失败，请稍后重试。'
      );
    } finally {
      setRebuilding(false);
    }
  };

  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCustomPositions({});
  };

  const focusConflictEdge = (edge: GraphEdge) => {
    setFilterMode('all');
    setSearchTerm('');
    setSelectedCommunityId(null);
    setSelectedNodeId(null);
    setSelectedConflictEdgeId(edge.id);
    const ps = getNodePos(edge.source);
    const pt = getNodePos(edge.target);
    const midX = (ps.x + pt.x) / 2;
    const midY = (ps.y + pt.y) / 2;
    setZoom(1.25);
    setPan({
      x: (CANVAS_WIDTH / 2 - midX) * 0.75,
      y: (CANVAS_HEIGHT / 2 - midY) * 0.75,
    });
  };

  const handleSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragStateRef.current = {
      kind: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: pan.x,
      startY: pan.y,
      moved: false,
    };
  };

  const handleNodePointerDown = (
    e: ReactPointerEvent<SVGGElement>,
    nodeId: string
  ) => {
    e.stopPropagation();
    const pos = getNodePos(nodeId);
    dragStateRef.current = {
      kind: 'node',
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: pos.x,
      startY: pos.y,
      moved: false,
    };
  };

  const handleSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / Math.max(1, rect.width);
    const scaleY = CANVAS_HEIGHT / Math.max(1, rect.height);
    const dx = (e.clientX - drag.startClientX) * scaleX;
    const dy = (e.clientY - drag.startClientY) * scaleY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }

    if (drag.kind === 'pan') {
      setPan({
        x: drag.startX + dx,
        y: drag.startY + dy,
      });
    } else if (drag.kind === 'node' && drag.nodeId) {
      setCustomPositions((prev) => ({
        ...prev,
        [drag.nodeId!]: {
          x: Math.max(36, Math.min(CANVAS_WIDTH - 36, drag.startX + dx / zoom)),
          y: Math.max(36, Math.min(CANVAS_HEIGHT - 36, drag.startY + dy / zoom)),
        },
      }));
    }
  };

  const handleSvgPointerUp = () => {
    const drag = dragStateRef.current;
    if (drag && !drag.moved) {
      if (drag.kind === 'node' && drag.nodeId) {
        setSelectedCommunityId(null);
        setSelectedConflictEdgeId(null);
        setSelectedNodeId((prev) => (prev === drag.nodeId ? null : drag.nodeId!));
      } else if (drag.kind === 'pan') {
        setSelectedNodeId(null);
        setSelectedConflictEdgeId(null);
      }
    }
    dragStateRef.current = null;
  };

  const handleWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    setZoom((prev) => Math.max(0.55, Math.min(2.4, Number((prev + delta).toFixed(2)))));
  };

  const nodeMap = useMemo(
    () => new Map(rawNodes.map((n) => [n.id, n])),
    [rawNodes]
  );

  return (
    <div className="space-y-3">
      {rebuildMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-md px-4 py-2.5 text-xs flex items-center justify-between gap-2">
          <span>{rebuildMessage}</span>
          <button
            type="button"
            onClick={() => setRebuildMessage(null)}
            className="p-0.5 hover:opacity-70"
            aria-label="关闭通知"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {highlightSubgraph && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-md px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 shrink-0 text-indigo-700" />
            <span>
              当前正在高亮展示 AI 问答的 GraphRAG 推理子图：
              <strong className="font-semibold">「{highlightSubgraph.label}」</strong>
              （命中 {highlightSubgraph.nodeIds.length} 个节点、{highlightSubgraph.edgeIds.length} 条路径）
            </span>
          </div>
          <button
            type="button"
            onClick={onClearHighlight}
            className="px-2.5 py-1 text-xs font-medium text-indigo-800 bg-white border border-indigo-200 rounded hover:bg-indigo-100 whitespace-nowrap"
          >
            清除子图高亮
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left/Main Interactive Graph Canvas */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex items-center">
                <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <select
                  aria-label="选择图谱文件范围"
                  value={scopedPolicy ? scopedPolicy.id : 'all'}
                  onChange={(e) => {
                    onSelectPolicyScope(e.target.value);
                    setSelectedNodeId(null);
                    setSelectedConflictEdgeId(null);
                    setSelectedCommunityId(null);
                  }}
                  className="pl-8 pr-7 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 max-w-[240px] truncate"
                >
                  <option value="all">全部制度图谱 ({activePolicies.length} 份)</option>
                  {activePolicies.map((p) => {
                    const ver =
                      p.versions.find((v) => v.id === p.currentVersionId) ??
                      p.versions[p.versions.length - 1];
                    return (
                      <option key={p.id} value={p.id}>
                        《{p.title}》{ver ? ` (${ver.versionNumber})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索节点、条款或审批角色..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 w-44 sm:w-52"
                />
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                {(
                  [
                    { id: 'all', label: '全部图谱' },
                    { id: 'conflicts', label: '仅冲突子图' },
                    { id: 'structure', label: '制度与条款' },
                    { id: 'rules', label: '审批与规则' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setFilterMode(tab.id);
                      setSelectedNodeId(null);
                      setSelectedConflictEdgeId(null);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      filterMode === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 text-slate-600">
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => Math.min(2.4, Number((z + 0.2).toFixed(2))))
                  }
                  className="p-1.5 hover:bg-slate-100 rounded border border-slate-200"
                  title="放大"
                  aria-label="放大"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono tabular-nums px-1 text-slate-500">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => Math.max(0.55, Number((z - 0.2).toFixed(2))))
                  }
                  className="p-1.5 hover:bg-slate-100 rounded border border-slate-200"
                  title="缩小"
                  aria-label="缩小"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={resetViewport}
                  className="p-1.5 hover:bg-slate-100 rounded border border-slate-200"
                  title="重置视角"
                  aria-label="重置视角"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleRebuild()}
                disabled={rebuilding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {rebuilding ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>{rebuilding ? '抽取中...' : 'AI 深度抽取图谱'}</span>
              </button>
            </div>
          </div>

          <div className="relative bg-slate-50/70 h-[620px] lg:h-[calc(100vh-10.75rem)] min-h-[560px] select-none overflow-hidden">
            {visibleNodes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                <Network className="w-8 h-8 text-slate-400" />
                <div className="text-sm font-medium text-slate-700">
                  当前筛选条件下暂无可展示的知识节点
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterMode('all');
                    setSearchTerm('');
                  }}
                  className="text-xs text-blue-700 hover:underline"
                >
                  恢复展示全部图谱
                </button>
              </div>
            ) : (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={handleSvgPointerDown}
                onPointerMove={handleSvgPointerMove}
                onPointerUp={handleSvgPointerUp}
                onPointerLeave={handleSvgPointerUp}
                onWheel={handleWheel}
              >
                <defs>
                  <pattern
                    id="graph-grid-dots"
                    width="24"
                    height="24"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="2" cy="2" r="1" fill="#CBD5E1" opacity="0.65" />
                  </pattern>
                  <marker
                    id="arrow-default"
                    viewBox="0 0 10 10"
                    refX="18"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#94A3B8" />
                  </marker>
                  <marker
                    id="arrow-conflict"
                    viewBox="0 0 10 10"
                    refX="16"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#DC2626" />
                  </marker>
                </defs>

                <rect
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  fill="url(#graph-grid-dots)"
                />

                <g
                  transform={`translate(${pan.x + (CANVAS_WIDTH * (1 - zoom)) / 2}, ${
                    pan.y + (CANVAS_HEIGHT * (1 - zoom)) / 2
                  }) scale(${zoom})`}
                >
                  {/* Edges */}
                  {visibleEdges.map((edge) => {
                    const p1 = getNodePos(edge.source);
                    const p2 = getNodePos(edge.target);
                    const isConflict = edge.relation === 'conflicts_with';
                    const isHighlighted =
                      !activeHighlight || activeHighlight.edgeIds.has(edge.id);
                    const isEdgeSelected = selectedConflictEdgeId === edge.id;

                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    // Curve conflict edges slightly so they never overlap straight containment edges
                    const curveOffset = isConflict ? 34 : 0;
                    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                    const ctrlX = midX - (dy / len) * curveOffset;
                    const ctrlY = midY + (dx / len) * curveOffset;
                    const pathD = isConflict
                      ? `M ${p1.x} ${p1.y} Q ${ctrlX} ${ctrlY} ${p2.x} ${p2.y}`
                      : `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;

                    const curveMidX = isConflict
                      ? (p1.x + 2 * ctrlX + p2.x) / 4
                      : midX;
                    const curveMidY = isConflict
                      ? (p1.y + 2 * ctrlY + p2.y) / 4
                      : midY;

                    const showLabel =
                      isConflict ||
                      (activeHighlight !== null && activeHighlight.edgeIds.has(edge.id));

                    const linkedConflict =
                      isConflict && edge.conflictId
                        ? conflictById.get(edge.conflictId)
                        : undefined;
                    const badgeInfo = isConflict
                      ? buildConflictBadgeInfo(edge, linkedConflict)
                      : null;

                    const boxWidth = badgeInfo
                      ? Math.max(
                          118,
                          Math.ceil(
                            Math.max(
                              estimateSvgTextWidth(badgeInfo.headline, 10),
                              estimateSvgTextWidth(badgeInfo.detail, 9)
                            )
                          ) + 18
                        )
                      : 0;
                    const boxHeight = badgeInfo?.detail ? 34 : 22;

                    return (
                      <g
                        key={edge.id}
                        style={{
                          opacity: isHighlighted ? 1 : 0.14,
                          transition: 'opacity 160ms ease',
                        }}
                      >
                        {isConflict && (
                          <path
                            d={pathD}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={16}
                            className="cursor-pointer"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => {
                              setSelectedCommunityId(null);
                              setSelectedNodeId(null);
                              setSelectedConflictEdgeId((prev) =>
                                prev === edge.id ? null : edge.id
                              );
                            }}
                          />
                        )}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={
                            isConflict
                              ? badgeInfo?.resolved
                                ? '#059669'
                                : '#DC2626'
                              : activeHighlight && activeHighlight.edgeIds.has(edge.id)
                                ? '#1D4ED8'
                                : '#94A3B8'
                          }
                          strokeWidth={
                            isConflict
                              ? isEdgeSelected
                                ? 3.2
                                : 2.2
                              : activeHighlight && activeHighlight.edgeIds.has(edge.id)
                                ? 1.8
                                : 1.1
                          }
                          strokeDasharray={isConflict ? '5 3' : undefined}
                          markerEnd={
                            isConflict ? 'url(#arrow-conflict)' : 'url(#arrow-default)'
                          }
                          className={isConflict ? 'cursor-pointer' : 'pointer-events-none'}
                          onPointerDown={
                            isConflict ? (e) => e.stopPropagation() : undefined
                          }
                          onClick={
                            isConflict
                              ? () => {
                                  setSelectedCommunityId(null);
                                  setSelectedNodeId(null);
                                  setSelectedConflictEdgeId((prev) =>
                                    prev === edge.id ? null : edge.id
                                  );
                                }
                              : undefined
                          }
                        />
                        {showLabel && isConflict && badgeInfo ? (
                          <g
                            transform={`translate(${curveMidX}, ${curveMidY})`}
                            className="cursor-pointer"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => {
                              setSelectedCommunityId(null);
                              setSelectedNodeId(null);
                              setSelectedConflictEdgeId((prev) =>
                                prev === edge.id ? null : edge.id
                              );
                            }}
                          >
                            <title>
                              {linkedConflict
                                ? `${linkedConflict.title}：${linkedConflict.description}`
                                : badgeInfo.headline}
                            </title>
                            <rect
                              x={-boxWidth / 2}
                              y={-boxHeight / 2}
                              width={boxWidth}
                              height={boxHeight}
                              rx={4}
                              fill={
                                isEdgeSelected
                                  ? '#FEF2F2'
                                  : badgeInfo.resolved
                                    ? '#ECFDF5'
                                    : '#FFFFFF'
                              }
                              stroke={
                                badgeInfo.resolved
                                  ? '#10B981'
                                  : isEdgeSelected
                                    ? '#DC2626'
                                    : '#FCA5A5'
                              }
                              strokeWidth={isEdgeSelected ? 1.6 : 1}
                            />
                            <text
                              x={0}
                              y={badgeInfo.detail ? -4 : 3.5}
                              textAnchor="middle"
                              fontSize={10}
                              fontWeight={600}
                              fill={badgeInfo.resolved ? '#065F46' : '#991B1B'}
                              className="select-none"
                            >
                              {badgeInfo.headline}
                            </text>
                            {badgeInfo.detail && (
                              <text
                                x={0}
                                y={9.5}
                                textAnchor="middle"
                                fontSize={8.8}
                                fontWeight={500}
                                fill={badgeInfo.resolved ? '#047857' : '#B91C1C'}
                                className="select-none"
                              >
                                {badgeInfo.detail}
                              </text>
                            )}
                          </g>
                        ) : showLabel ? (
                          <text
                            x={curveMidX}
                            y={curveMidY - 4}
                            textAnchor="middle"
                            fontSize={9}
                            fontWeight={500}
                            fill="#1E40AF"
                            className="pointer-events-none select-none"
                          >
                            {edge.label}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}

                  {/* Nodes */}
                  {visibleNodes.map((node) => {
                    const pos = getNodePos(node.id);
                    const meta = NODE_TYPE_META[node.type];
                    const isSelected = selectedNodeId === node.id;
                    const isHighlighted =
                      !activeHighlight || activeHighlight.nodeIds.has(node.id);
                    const hasConflictEdge = conflictEdges.some(
                      (e) => e.source === node.id || e.target === node.id
                    );

                    const r =
                      node.type === 'policy'
                        ? meta.radius
                        : Math.min(20, meta.radius + Math.floor(node.degree / 4));
                    const displayLines = formatNodeDisplayLines(node);

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${pos.x}, ${pos.y})`}
                        onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                        className="cursor-pointer"
                        style={{
                          opacity: isHighlighted ? 1 : 0.2,
                          transition: 'opacity 160ms ease',
                        }}
                      >
                        <title>{node.label}</title>
                        {isSelected && (
                          <circle
                            r={r + 6}
                            fill="none"
                            stroke="#1D4ED8"
                            strokeWidth={2}
                            opacity={0.75}
                          />
                        )}
                        {hasConflictEdge && !isSelected && (
                          <circle
                            r={r + 3.5}
                            fill="none"
                            stroke="#DC2626"
                            strokeWidth={1.4}
                            strokeDasharray="3 2"
                          />
                        )}
                        <circle
                          r={r}
                          fill={meta.color}
                          stroke={isSelected ? '#0F172A' : '#FFFFFF'}
                          strokeWidth={isSelected ? 2.5 : 2}
                        />
                        {node.type === 'policy' && (
                          <text
                            textAnchor="middle"
                            dy="0.35em"
                            fontSize={10}
                            fontWeight={700}
                            fill="#FFFFFF"
                            className="pointer-events-none"
                          >
                            制度
                          </text>
                        )}
                        <text
                          y={r + 12}
                          textAnchor="middle"
                          fontSize={displayLines.secondary ? 9.5 : node.type === 'policy' ? 11 : 10}
                          fontWeight={
                            displayLines.secondary
                              ? 500
                              : node.type === 'policy' || isSelected
                                ? 600
                                : 500
                          }
                          fill={displayLines.secondary ? '#475569' : '#0F172A'}
                          stroke="#F8FAFC"
                          strokeWidth={3}
                          paintOrder="stroke"
                          className="pointer-events-none"
                        >
                          {displayLines.primary}
                        </text>
                        {displayLines.secondary && (
                          <text
                            y={r + 24}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={hasConflictEdge || isSelected ? 600 : 500}
                            fill={hasConflictEdge ? '#991B1B' : '#0F172A'}
                            stroke="#F8FAFC"
                            strokeWidth={3}
                            paintOrder="stroke"
                            className="pointer-events-none"
                          >
                            {displayLines.secondary}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              {(Object.keys(NODE_TYPE_META) as GraphNodeType[]).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                    style={{ backgroundColor: NODE_TYPE_META[t].color }}
                    aria-hidden="true"
                  />
                  <span>{NODE_TYPE_META[t].label}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-4 border-t-2 border-dashed border-red-600 inline-block shrink-0"
                  aria-hidden="true"
                />
                <span className="text-red-700 font-medium">冲突连线</span>
              </span>
            </div>
            <span className="text-slate-400">支持拖拽节点、滚轮缩放与点击查看关联</span>
          </div>
        </div>

        {/* Right Inspector Panel */}
        <aside className="lg:col-span-4 xl:col-span-3 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white flex flex-col lg:h-[calc(100vh-5.75rem)] min-h-[560px]">
          {selectedConflictEdge && selectedConflict ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <SeverityLabel severity={selectedConflict.severity} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-slate-600 font-medium">
                      {CONFLICT_TYPE_LABELS[selectedConflict.type]}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900 mt-1.5 leading-5">
                    {selectedConflict.title}
                  </h2>
                  <p className="text-xs text-slate-600 leading-5 mt-1">
                    {selectedConflict.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedConflictEdgeId(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0"
                  aria-label="关闭冲突详情"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Concrete contradiction points */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  具体矛盾点对照
                </div>
                <div className="space-y-2">
                  {getConflictPoints(selectedConflict).map((pt, idx) => (
                    <div
                      key={`graph-pt-${idx}`}
                      className="border border-slate-200 rounded-md p-2.5 space-y-1.5 bg-white text-xs"
                    >
                      <div className="font-semibold text-slate-900">{pt.dimension}</div>
                      <div className="px-2 py-1.5 rounded bg-rose-50/75 border border-rose-200 text-rose-950">
                        <div className="text-[11px] text-rose-700 font-medium">
                          《{selectedConflict.policyATitle}》
                        </div>
                        <div className="font-semibold leading-5 tabular-nums">
                          {pt.valueA}
                        </div>
                      </div>
                      <div className="flex items-center justify-center text-[11px] text-red-600 font-medium gap-1">
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>对立</span>
                      </div>
                      <div className="px-2 py-1.5 rounded bg-amber-50/75 border border-amber-200 text-amber-950">
                        <div className="text-[11px] text-amber-800 font-medium">
                          《{selectedConflict.policyBTitle}》
                        </div>
                        <div className="font-semibold leading-5 tabular-nums">
                          {pt.valueB}
                        </div>
                      </div>
                      {pt.impact && (
                        <div className="text-[11px] text-slate-600 leading-4 pt-1 border-t border-slate-100">
                          后果：{pt.impact}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Highlighted clause excerpts */}
              {(() => {
                const pts = getConflictPoints(selectedConflict);
                const segsA = splitHighlightedExcerpt(
                  selectedConflict.excerptA,
                  pts,
                  'A'
                );
                const segsB = splitHighlightedExcerpt(
                  selectedConflict.excerptB,
                  pts,
                  'B'
                );
                return (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      冲突条款原文
                    </div>
                    <div className="border border-rose-200 rounded-md p-2.5 space-y-1 text-xs bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConflictEdgeId(null);
                            setSelectedNodeId(selectedConflictEdge.source);
                          }}
                          className="font-semibold text-rose-800 hover:underline text-left truncate"
                        >
                          《{selectedConflict.policyATitle}》· {selectedConflict.clauseA}
                        </button>
                      </div>
                      <p className="text-slate-700 leading-5">
                        “
                        {segsA.map((s, i) =>
                          s.highlighted ? (
                            <mark
                              key={i}
                              className="bg-rose-100 text-rose-950 font-semibold px-0.5 rounded-xs"
                            >
                              {s.text}
                            </mark>
                          ) : (
                            <span key={i}>{s.text}</span>
                          )
                        )}
                        ”
                      </p>
                    </div>
                    <div className="border border-amber-200 rounded-md p-2.5 space-y-1 text-xs bg-white">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedConflictEdgeId(null);
                          setSelectedNodeId(selectedConflictEdge.target);
                        }}
                        className="font-semibold text-amber-800 hover:underline text-left truncate block w-full"
                      >
                        《{selectedConflict.policyBTitle}》· {selectedConflict.clauseB}
                      </button>
                      <p className="text-slate-700 leading-5">
                        “
                        {segsB.map((s, i) =>
                          s.highlighted ? (
                            <mark
                              key={i}
                              className="bg-amber-100 text-amber-950 font-semibold px-0.5 rounded-xs"
                            >
                              {s.text}
                            </mark>
                          ) : (
                            <span key={i}>{s.text}</span>
                          )
                        )}
                        ”
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onJumpToConflict(selectedConflict.id)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 transition-colors whitespace-nowrap"
                >
                  <span>去冲突中心处理 / 人工修订</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : selectedNode ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span
                      className="w-2 h-2 rounded-full inline-block shrink-0"
                      style={{
                        backgroundColor: NODE_TYPE_META[selectedNode.type].color,
                      }}
                    />
                    <span>{NODE_TYPE_META[selectedNode.type].label}</span>
                    {selectedNode.versionNumber && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{selectedNode.versionNumber}</span>
                      </>
                    )}
                    {selectedNode.clauseRef && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{selectedNode.clauseRef}</span>
                      </>
                    )}
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900 mt-1">
                    {selectedNode.label}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded"
                  aria-label="取消选中节点"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedNode.summary && (
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-700 leading-6 whitespace-pre-line">
                  {selectedNode.summary}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onAskAboutNode(
                      `请结合制度知识图谱，详细说明「${selectedNode.label}」的相关规定及是否存在跨制度冲突？`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  <MessageSquareText className="w-3.5 h-3.5" />
                  <span>向 AI 提问该节点</span>
                </button>
                {selectedNode.policyId && (
                  <button
                    type="button"
                    onClick={() => onJumpToPolicy(selectedNode.policyId!)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <span>查看制度原文</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800 tabular-nums">
                  关联关系路径 ({selectedNodeConnections.length})
                </div>

                {selectedNodeConnections.length === 0 ? (
                  <div className="text-xs text-slate-500">暂无关联连线。</div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {selectedNodeConnections.map(({ edge, other, direction }) => {
                      const isConflict = edge.relation === 'conflicts_with';
                      const linkedConflict =
                        isConflict && edge.conflictId
                          ? conflictById.get(edge.conflictId)
                          : undefined;
                      const concretePoints = linkedConflict
                        ? getConflictPoints(linkedConflict)
                        : [];

                      return (
                        <div
                          key={edge.id}
                          className={`p-2.5 text-xs space-y-1.5 ${
                            isConflict ? 'bg-red-50/55' : 'bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-medium ${
                                isConflict ? 'text-red-800' : 'text-slate-600'
                              }`}
                            >
                              {isConflict
                                ? linkedConflict?.title ?? edge.label
                                : direction === 'out'
                                  ? `→ [${edge.label}]`
                                  : `← [${edge.label}]`}
                            </span>
                            {isConflict && (
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => focusConflictEdge(edge)}
                                  className="text-blue-700 hover:underline font-medium whitespace-nowrap"
                                >
                                  看对比
                                </button>
                                {edge.conflictId && (
                                  <button
                                    type="button"
                                    onClick={() => onJumpToConflict(edge.conflictId)}
                                    className="text-red-700 hover:underline font-medium whitespace-nowrap"
                                  >
                                    处理冲突
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedNodeId(other.id)}
                            className="text-left font-medium text-blue-700 hover:underline block"
                          >
                            {other.label}
                          </button>
                          {concretePoints.length > 0 ? (
                            <div className="space-y-1 pt-0.5">
                              {concretePoints.map((pt, i) => (
                                <div
                                  key={i}
                                  className="bg-white border border-red-200/80 rounded px-2 py-1.5 text-[11px] space-y-0.5"
                                >
                                  <div className="font-semibold text-slate-800">
                                    {pt.dimension}
                                  </div>
                                  <div className="text-rose-800 tabular-nums">
                                    {pt.valueA}
                                  </div>
                                  <div className="text-amber-800 tabular-nums">
                                    ≠ {pt.valueB}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            edge.evidence && (
                              <p className="text-slate-600 leading-5">{edge.evidence}</p>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {scopedPolicy ? `《${scopedPolicy.title}》图谱` : 'GraphRAG 图谱概览'}
                  </h2>
                  {scopedPolicy && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPolicyScope('all');
                        setSelectedNodeId(null);
                        setSelectedConflictEdgeId(null);
                        setSelectedCommunityId(null);
                      }}
                      className="text-xs text-blue-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      查看全部图谱
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-5">
                  {scopedPolicy
                    ? `当前仅展示该文件关联的条款、审批角色、规则阈值及跨制度冲突链路。`
                    : '点击画布中的任意节点或红色冲突连线，可查看具体矛盾口径与对照条款。'}
                </p>
                {scopedPolicy && (
                  <div className="pt-1 flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => onJumpToPolicy(scopedPolicy.id)}
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                    >
                      <span>查看制度原文</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 border-y border-slate-200 py-3.5 text-xs">
                <div>
                  <div className="text-slate-500">知识实体节点</div>
                  <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                    {scopedNodes.length}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">语义与引用边</div>
                  <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                    {scopedEdges.length}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">冲突矛盾连线</div>
                  <div className="text-lg font-semibold text-red-700 font-mono tabular-nums mt-0.5">
                    {conflictEdges.length}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">主题知识社区</div>
                  <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                    {scopedCommunities.length}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>图谱冲突路径速览 ({conflictEdges.length})</span>
                </div>
                {conflictEdges.length === 0 ? (
                  <div className="text-xs text-slate-500">当前范围暂无冲突连线。</div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {conflictEdges.map((edge) => {
                      const src = nodeMap.get(edge.source);
                      const tgt = nodeMap.get(edge.target);
                      const conf = conflicts.find((c) => c.id === edge.conflictId);
                      const firstPt = conf ? getConflictPoints(conf)[0] : null;
                      return (
                        <button
                          key={edge.id}
                          type="button"
                          onClick={() => focusConflictEdge(edge)}
                          className="w-full text-left p-2.5 hover:bg-red-50/40 transition-colors space-y-1"
                        >
                          <div className="text-xs font-medium text-slate-900">
                            {conf?.title ?? edge.label}
                          </div>
                          {firstPt && (
                            <div className="text-[11px] text-red-800 leading-4 tabular-nums">
                              {firstPt.valueA} ≠ {firstPt.valueB}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500">
                            {src?.label ?? edge.source} ↔ {tgt?.label ?? edge.target}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  知识社区聚类 ({scopedCommunities.length})
                </div>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                  {scopedCommunities.map((comm) => {
                    const isCommSelected = selectedCommunityId === comm.id;
                    return (
                      <button
                        key={comm.id}
                        type="button"
                        onClick={() => {
                          setSelectedNodeId(null);
                          setSelectedCommunityId((prev) =>
                            prev === comm.id ? null : comm.id
                          );
                        }}
                        className={`w-full text-left p-2.5 transition-colors space-y-1 ${
                          isCommSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-900">
                            {comm.name}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-slate-500">
                            {comm.nodeIds.length} 节点
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 leading-5">
                          {comm.summary}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
