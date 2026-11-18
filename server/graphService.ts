import type {
  GraphCommunity,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphRelationType,
  PolicyChunk,
  PolicyConflict,
  PolicyDocument,
  PolicyKnowledgeGraph,
  RagGraphContext,
} from '../src/types/policy.ts';

const ROLE_KEYWORDS: Array<{ name: string; aliases: string[] }> = [
  { name: '人力资源部', aliases: ['人力资源部', 'HRBP', 'HR', '人事部'] },
  { name: '财务部 / 财务总监', aliases: ['财务总监', '财务部', 'CFO', '财务负责人'] },
  { name: '部门总监', aliases: ['部门总监', '所属总监'] },
  { name: '部门负责人 / 主管', aliases: ['部门负责人', '直属主管', '团队负责人'] },
  { name: 'CTO / 分管 VP', aliases: ['CTO', '分管VP', '分管 VP', '分管副总裁', 'VP'] },
  { name: '总经理 / CEO', aliases: ['总经理', 'CEO'] },
  { name: '法务合规部', aliases: ['法务合规部', '法务部', '合规部'] },
  { name: '行政与采购部', aliases: ['行政部', '采购部'] },
  { name: '信息安全委员会', aliases: ['信息安全委员会', '安全团队', '安全部'] },
];

const TOPIC_KEYWORDS: Array<{ name: string; aliases: string[] }> = [
  { name: '病假与医疗证明', aliases: ['病假', '医疗证明', '诊断证明', '三甲', '二甲', '门诊'] },
  { name: '现场考勤与周五在岗', aliases: ['打卡', '考勤', '周五', '在岗', '现场办公', '核心办公时间'] },
  { name: '远程与居家办公', aliases: ['远程办公', '居家办公', '混合办公', '异地办公'] },
  { name: '加班认定与调休', aliases: ['加班', '调休', '紧急任务', '线上故障', '300%'] },
  { name: '差旅交通与住宿标准', aliases: ['出差', '差旅', '住宿', '机票', '高铁', '交通'] },
  { name: '费用报销与审批红线', aliases: ['报销', '发票', '单笔', '审批权限', '财务红线', '超标'] },
  { name: '研发中心适用规范', aliases: ['研发中心', '研发部门', '技术团队', '产研'] },
  { name: '合同采购与信息安全', aliases: ['合同', '采购', '供应商', '保密', '信息安全', '数据权限'] },
];

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s《》「」【】()（）·：:、，,。.;；\-_/]+/g, '')
    .trim();
}

function extractRuleLabels(text: string): string[] {
  const rules = new Set<string>();
  const patterns: RegExp[] = [
    /(?:连续病假|病假)[^，。；;\n]{0,16}?\d+\s*(?:天|个工作日)[^，。；;\n]{0,16}/g,
    /(?:单笔|累计|住宿|交通|报销|金额|额度)[^，。；;\n]{0,14}?\d[\d,]*(?:\.\d+)?\s*(?:元|万元|%|折)/g,
    /(?:有效期|结转|复工后|返岗后|提前)[^，。；;\n]{0,14}?\d+\s*(?:天|个月|小时|个工作日|年)/g,
    /(?:三级甲等|三甲|二级甲等|二甲)[^，。；;\n]{0,10}(?:医院|证明)/g,
    /(?:每周五|法定节假日)[^，。；;\n]{2,18}/g,
  ];

  for (const regex of patterns) {
    const matches = text.match(regex) ?? [];
    for (const raw of matches) {
      const cleaned = raw.replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 4 && cleaned.length <= 28) {
        rules.add(cleaned);
      }
      if (rules.size >= 3) break;
    }
    if (rules.size >= 3) break;
  }

  return Array.from(rules);
}

function findMatchingClauseNodeId(
  nodes: GraphNode[],
  policyId: string,
  clauseRef: string
): string | undefined {
  const targetNorm = normalizeKey(clauseRef);
  const candidates = nodes.filter((n) => n.type === 'clause' && n.policyId === policyId);
  if (candidates.length === 0) return undefined;

  const exact = candidates.find((c) => normalizeKey(c.clauseRef ?? '') === targetNorm);
  if (exact) return exact.id;

  const partial = candidates.find((c) => {
    const cNorm = normalizeKey(c.clauseRef ?? '');
    return cNorm.includes(targetNorm) || targetNorm.includes(cNorm);
  });
  if (partial) return partial.id;

  return candidates[0].id;
}

function getCategoryCommunityName(category: string): string {
  if (category.includes('人力') || category.includes('考勤')) {
    return '人力资源与考勤社区';
  }
  if (category.includes('财务') || category.includes('差旅') || category.includes('报销')) {
    return '财务审批与差旅报销社区';
  }
  if (category.includes('办公') || category.includes('研发') || category.includes('协作')) {
    return '远程办公与研发协作社区';
  }
  if (category.includes('安全') || category.includes('法务') || category.includes('采购')) {
    return '合规风控与信息安全社区';
  }
  return `${category || '综合制度'}治理社区`;
}

export function buildPolicyKnowledgeGraph(
  policies: PolicyDocument[],
  conflicts: PolicyConflict[]
): PolicyKnowledgeGraph {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  const addNode = (node: Omit<GraphNode, 'degree'>) => {
    const existing = nodeMap.get(node.id);
    if (!existing) {
      nodeMap.set(node.id, { ...node, degree: 0 });
    } else if (node.summary && !existing.summary) {
      existing.summary = node.summary;
    }
  };

  const addEdge = (edge: GraphEdge) => {
    if (edge.source === edge.target) return;
    if (!edgeMap.has(edge.id)) {
      edgeMap.set(edge.id, edge);
    }
  };

  const activePolicies = policies.filter((p) => p.status !== 'archived');

  // 1. Policy & Clause nodes + Role / Topic / Rule extraction
  for (const policy of activePolicies) {
    const currentVer =
      policy.versions.find((v) => v.id === policy.currentVersionId) ??
      policy.versions[policy.versions.length - 1];
    if (!currentVer) continue;

    const commId = `comm:${normalizeKey(getCategoryCommunityName(policy.category))}`;
    const policyNodeId = `pol:${policy.id}`;

    addNode({
      id: policyNodeId,
      label: `${policy.title} (${currentVer.versionNumber})`,
      type: 'policy',
      policyId: policy.id,
      policyTitle: policy.title,
      versionNumber: currentVer.versionNumber,
      department: policy.department,
      summary: `${policy.code} · ${policy.category} · 责任部门：${policy.department} · 责任人：${policy.owner}`,
      communityId: commId,
    });

    // Policy managing department as a role link
    const deptRoleId = `role:${normalizeKey(policy.department)}`;
    addNode({
      id: deptRoleId,
      label: policy.department,
      type: 'role',
      summary: `制度归口与管理部门：${policy.department}`,
      communityId: commId,
    });

    for (const chunk of currentVer.chunks) {
      const clauseNodeId = `cls:${chunk.id}`;
      const shortHeading =
        chunk.heading.length > 22 ? `${chunk.heading.slice(0, 22)}…` : chunk.heading;

      addNode({
        id: clauseNodeId,
        label: `${policy.title.slice(0, 8)}·${shortHeading}`,
        type: 'clause',
        policyId: policy.id,
        policyTitle: policy.title,
        versionNumber: currentVer.versionNumber,
        clauseRef: chunk.clauseRef,
        department: policy.department,
        summary: chunk.content,
        communityId: commId,
      });

      addEdge({
        id: `edge:contains:${policyNodeId}->${clauseNodeId}`,
        source: policyNodeId,
        target: clauseNodeId,
        relation: 'contains',
        label: '包含条款',
      });

      const fullText = `${chunk.heading}\n${chunk.content}`;

      // Extract roles
      for (const roleDef of ROLE_KEYWORDS) {
        if (roleDef.aliases.some((alias) => fullText.includes(alias))) {
          const roleId = `role:${normalizeKey(roleDef.name)}`;
          addNode({
            id: roleId,
            label: roleDef.name,
            type: 'role',
            summary: `审批/协同角色实体：${roleDef.name}`,
            communityId: commId,
          });
          addEdge({
            id: `edge:role:${clauseNodeId}->${roleId}`,
            source: clauseNodeId,
            target: roleId,
            relation: 'requires_approval',
            label: '审批/责任主体',
          });
        }
      }

      // Extract topics
      for (const topicDef of TOPIC_KEYWORDS) {
        if (topicDef.aliases.some((alias) => fullText.includes(alias))) {
          const topicId = `topic:${normalizeKey(topicDef.name)}`;
          addNode({
            id: topicId,
            label: topicDef.name,
            type: 'topic',
            summary: `制度主题域：${topicDef.name}`,
            communityId: commId,
          });
          addEdge({
            id: `edge:topic:${clauseNodeId}->${topicId}`,
            source: clauseNodeId,
            target: topicId,
            relation: 'applies_to',
            label: '关联主题',
          });
        }
      }

      // Extract concrete rule thresholds
      const rules = extractRuleLabels(chunk.content);
      for (const ruleText of rules) {
        const ruleId = `rule:${normalizeKey(ruleText).slice(0, 32)}`;
        addNode({
          id: ruleId,
          label: ruleText,
          type: 'rule',
          policyId: policy.id,
          policyTitle: policy.title,
          versionNumber: currentVer.versionNumber,
          clauseRef: chunk.clauseRef,
          summary: `出自《${policy.title} ${currentVer.versionNumber}》${chunk.clauseRef}：${chunk.content}`,
          communityId: commId,
        });
        addEdge({
          id: `edge:rule:${clauseNodeId}->${ruleId}`,
          source: clauseNodeId,
          target: ruleId,
          relation: 'defines_rule',
          label: '规定阈值/细则',
        });
      }

      // Cross-policy citations like 《...》
      for (const other of activePolicies) {
        if (other.id === policy.id) continue;
        if (
          fullText.includes(`《${other.title}》`) ||
          fullText.includes(other.title)
        ) {
          const targetPolId = `pol:${other.id}`;
          addEdge({
            id: `edge:ref:${clauseNodeId}->${targetPolId}`,
            source: clauseNodeId,
            target: targetPolId,
            relation: 'references',
            label: '援引制度',
          });
        }
      }
    }
  }

  // 2. Map detected conflicts directly as conflicts_with graph edges
  const allNodesSnapshot = Array.from(nodeMap.values());
  for (const conflict of conflicts) {
    const sourceClauseId =
      findMatchingClauseNodeId(allNodesSnapshot, conflict.policyAId, conflict.clauseA) ??
      (nodeMap.has(`pol:${conflict.policyAId}`) ? `pol:${conflict.policyAId}` : undefined);
    const targetClauseId =
      findMatchingClauseNodeId(allNodesSnapshot, conflict.policyBId, conflict.clauseB) ??
      (nodeMap.has(`pol:${conflict.policyBId}`) ? `pol:${conflict.policyBId}` : undefined);

    if (sourceClauseId && targetClauseId && sourceClauseId !== targetClauseId) {
      addEdge({
        id: `edge:conflict:${conflict.id}`,
        source: sourceClauseId,
        target: targetClauseId,
        relation: 'conflicts_with',
        label:
          conflict.status === 'resolved'
            ? `已解决 · ${conflict.title}`
            : conflict.title,
        conflictId: conflict.id,
        severity: conflict.severity,
        evidence: `${conflict.title}：${conflict.description}`,
      });
    }
  }

  // 3. Recompute node degrees
  const edges = Array.from(edgeMap.values());
  for (const edge of edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (s) s.degree += 1;
    if (t) t.degree += 1;
  }

  // Prune isolated role/dept nodes with degree 0
  const nodes = Array.from(nodeMap.values()).filter((n) => n.degree > 0 || n.type === 'policy');

  // 4. Build Community clusters
  const communityMap = new Map<
    string,
    {
      id: string;
      name: string;
      nodeIds: Set<string>;
      policyIds: Set<string>;
      policyTitles: Set<string>;
    }
  >();

  for (const policy of activePolicies) {
    const name = getCategoryCommunityName(policy.category);
    const id = `comm:${normalizeKey(name)}`;
    if (!communityMap.has(id)) {
      communityMap.set(id, {
        id,
        name,
        nodeIds: new Set<string>(),
        policyIds: new Set<string>(),
        policyTitles: new Set<string>(),
      });
    }
    const bucket = communityMap.get(id)!;
    bucket.policyIds.add(policy.id);
    bucket.policyTitles.add(policy.title);
  }

  for (const node of nodes) {
    const commId = node.communityId;
    if (commId && communityMap.has(commId)) {
      communityMap.get(commId)!.nodeIds.add(node.id);
    }
  }

  const communities: GraphCommunity[] = Array.from(communityMap.values()).map((c) => {
    const openConflictCount = conflicts.filter(
      (conf) =>
        conf.status === 'open' &&
        (c.policyIds.has(conf.policyAId) || c.policyIds.has(conf.policyBId))
    ).length;

    const titles = Array.from(c.policyTitles).map((t) => `《${t}》`).join('、');
    return {
      id: c.id,
      name: c.name,
      summary: `包含制度 ${titles}，覆盖 ${c.nodeIds.size} 个知识节点；当前涉及 ${openConflictCount} 项未决冲突。`,
      nodeIds: Array.from(c.nodeIds),
      policyIds: Array.from(c.policyIds),
      openConflictCount,
    };
  });

  return {
    nodes,
    edges,
    communities,
    updatedAt: new Date().toISOString(),
    builtBy: 'deterministic',
  };
}

export interface AiGraphEnrichmentPayload {
  entities: Array<{
    label: string;
    type: GraphNodeType;
    summary: string;
  }>;
  relations: Array<{
    sourceLabel: string;
    targetLabel: string;
    relation: Exclude<GraphRelationType, 'contains' | 'conflicts_with'>;
    label: string;
    evidence: string;
  }>;
  communityInsights: Array<{
    communityName: string;
    summary: string;
  }>;
}

export function mergeAiGraphEnrichment(
  baseGraph: PolicyKnowledgeGraph,
  aiPayload: AiGraphEnrichmentPayload
): PolicyKnowledgeGraph {
  const nodeMap = new Map<string, GraphNode>(baseGraph.nodes.map((n) => [n.id, { ...n, degree: 0 }]));
  const edgeMap = new Map<string, GraphEdge>(baseGraph.edges.map((e) => [e.id, { ...e }]));

  const findNodeByLabel = (label: string): GraphNode | undefined => {
    const norm = normalizeKey(label);
    if (!norm) return undefined;
    for (const node of nodeMap.values()) {
      const nNorm = normalizeKey(node.label);
      if (nNorm === norm || nNorm.includes(norm) || norm.includes(nNorm)) {
        return node;
      }
    }
    return undefined;
  };

  for (const ent of aiPayload.entities ?? []) {
    if (!ent.label?.trim()) continue;
    const existing = findNodeByLabel(ent.label);
    if (existing) {
      if (ent.summary && (!existing.summary || existing.summary.length < 24)) {
        existing.summary = ent.summary;
      }
      continue;
    }
    const validType: GraphNodeType =
      ent.type === 'role' || ent.type === 'rule' || ent.type === 'topic' || ent.type === 'policy'
        ? ent.type
        : 'topic';
    const id = `${validType}:ai:${normalizeKey(ent.label).slice(0, 28)}`;
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        label: ent.label.trim(),
        type: validType,
        summary: ent.summary?.trim() || `AI 抽取实体：${ent.label}`,
        communityId: baseGraph.communities[0]?.id,
        degree: 0,
      });
    }
  }

  for (const rel of aiPayload.relations ?? []) {
    const src = findNodeByLabel(rel.sourceLabel);
    const tgt = findNodeByLabel(rel.targetLabel);
    if (!src || !tgt || src.id === tgt.id) continue;

    const validRel: GraphRelationType =
      rel.relation === 'requires_approval' ||
      rel.relation === 'defines_rule' ||
      rel.relation === 'applies_to' ||
      rel.relation === 'references'
        ? rel.relation
        : 'applies_to';

    const edgeId = `edge:ai:${validRel}:${src.id}->${tgt.id}`;
    if (!edgeMap.has(edgeId)) {
      edgeMap.set(edgeId, {
        id: edgeId,
        source: src.id,
        target: tgt.id,
        relation: validRel,
        label: rel.label?.trim() || '语义关联',
        evidence: rel.evidence?.trim(),
      });
    }
  }

  const edges = Array.from(edgeMap.values());
  for (const edge of edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (s) s.degree += 1;
    if (t) t.degree += 1;
  }

  const nodes = Array.from(nodeMap.values()).filter((n) => n.degree > 0 || n.type === 'policy');

  const communities = baseGraph.communities.map((comm) => {
    const insight = (aiPayload.communityInsights ?? []).find(
      (ins) =>
        normalizeKey(ins.communityName).includes(normalizeKey(comm.name).slice(0, 4)) ||
        normalizeKey(comm.name).includes(normalizeKey(ins.communityName).slice(0, 4))
    );
    return insight?.summary ? { ...comm, summary: insight.summary } : comm;
  });

  return {
    nodes,
    edges,
    communities,
    updatedAt: new Date().toISOString(),
    builtBy: 'gemini_hybrid',
  };
}

function scoreNodeMatch(query: string, node: GraphNode): number {
  const cleanQ = normalizeKey(query);
  if (!cleanQ) return 0;
  const hay = normalizeKey(`${node.label} ${node.clauseRef ?? ''} ${node.summary ?? ''}`);
  if (!hay) return 0;

  let score = 0;
  if (hay.includes(normalizeKey(node.label)) && cleanQ.includes(normalizeKey(node.label))) {
    score += 3.0;
  }

  const labelClean = normalizeKey(node.label);
  let bigramHits = 0;
  for (let i = 0; i < cleanQ.length - 1; i++) {
    const bg = cleanQ.slice(i, i + 2);
    if (labelClean.includes(bg)) bigramHits += 1.4;
    else if (hay.includes(bg)) bigramHits += 0.35;
  }
  score += bigramHits / Math.max(3, Math.sqrt(cleanQ.length));

  if (node.type === 'role' || node.type === 'topic' || node.type === 'rule') {
    score *= 1.15;
  }
  return score;
}

export interface GraphRetrievalOutput {
  graphContext: RagGraphContext;
  clauseBoosts: Map<string, number>;
  subgraphTriplesText: string;
}

export function retrieveGraphRagSubgraph(
  query: string,
  graph: PolicyKnowledgeGraph,
  _policies: PolicyDocument[],
  _conflicts: PolicyConflict[],
  history: Array<{ role: 'user' | 'assistant'; content: string }> = []
): GraphRetrievalOutput {
  const recentContext = history
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content)
    .join(' ');
  const combinedQuery = recentContext ? `${recentContext} ${query}` : query;

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Array<{ neighborId: string; edge: GraphEdge }>>();

  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push({ neighborId: edge.target, edge });
    adj.get(edge.target)!.push({ neighborId: edge.source, edge });
  }

  // 1. Score all nodes to find top seed entities
  const scoredSeeds = graph.nodes
    .map((node) => ({ node, score: scoreNodeMatch(combinedQuery, node) }))
    .sort((a, b) => b.score - a.score);

  const seedNodes = scoredSeeds.filter((x) => x.score > 0.28).slice(0, 6);
  if (seedNodes.length === 0 && scoredSeeds.length > 0) {
    seedNodes.push(...scoredSeeds.slice(0, 3));
  }

  // 2. Multi-hop BFS (up to 2 hops), prioritizing conflict & rule edges
  const visitedNodes = new Set<string>();
  const visitedEdges = new Map<string, GraphEdge>();
  const clauseBoosts = new Map<string, number>();

  const queue: Array<{ id: string; hop: number; weight: number }> = [];
  for (const { node, score } of seedNodes) {
    visitedNodes.add(node.id);
    queue.push({ id: node.id, hop: 0, weight: score });
  }

  while (queue.length > 0 && visitedNodes.size < 28) {
    const current = queue.shift()!;
    const currentNode = nodeMap.get(current.id);
    if (currentNode?.type === 'clause') {
      const chunkId = currentNode.id.replace(/^cls:/, '');
      const prev = clauseBoosts.get(chunkId) ?? 0;
      const hopWeight = current.hop === 0 ? 0.55 : current.hop === 1 ? 0.36 : 0.2;
      clauseBoosts.set(chunkId, Math.max(prev, hopWeight));
    }

    if (current.hop >= 2) continue;

    const neighbors = [...(adj.get(current.id) ?? [])].sort((a, b) => {
      const priority = (e: GraphEdge) =>
        e.relation === 'conflicts_with'
          ? 5
          : e.relation === 'defines_rule'
          ? 4
          : e.relation === 'requires_approval'
          ? 3
          : e.relation === 'references'
          ? 3
          : 1;
      return priority(b.edge) - priority(a.edge);
    });

    for (const { neighborId, edge } of neighbors.slice(0, 8)) {
      visitedEdges.set(edge.id, edge);
      if (!visitedNodes.has(neighborId)) {
        visitedNodes.add(neighborId);
        // Always boost clauses connected by conflicts_with
        const nNode = nodeMap.get(neighborId);
        if (nNode?.type === 'clause' && edge.relation === 'conflicts_with') {
          const chunkId = nNode.id.replace(/^cls:/, '');
          clauseBoosts.set(chunkId, Math.max(clauseBoosts.get(chunkId) ?? 0, 0.5));
        }
        queue.push({ id: neighborId, hop: current.hop + 1, weight: current.weight * 0.7 });
      }
      if (visitedNodes.size >= 28) break;
    }
  }

  // 3. Build concise reasoning path strings
  const collectedEdges = Array.from(visitedEdges.values());
  const prioritizedEdges = [...collectedEdges].sort((a, b) => {
    const rank = (r: GraphRelationType) =>
      r === 'conflicts_with'
        ? 6
        : r === 'defines_rule'
        ? 5
        : r === 'requires_approval'
        ? 4
        : r === 'references'
        ? 3
        : r === 'applies_to'
        ? 2
        : 1;
    return rank(b.relation) - rank(a.relation);
  });

  const reasoningPaths: string[] = [];
  for (const edge of prioritizedEdges.slice(0, 12)) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) continue;
    const tag = edge.relation === 'conflicts_with' ? `【${edge.label}】` : edge.label;
    reasoningPaths.push(`${src.label} —[${tag}]→ ${tgt.label}`);
  }

  // 4. Matched community summaries
  const matchedCommIds = new Set<string>();
  for (const nId of visitedNodes) {
    const commId = nodeMap.get(nId)?.communityId;
    if (commId) matchedCommIds.add(commId);
  }
  const communitySummaries = graph.communities
    .filter((c) => matchedCommIds.has(c.id))
    .map((c) => `${c.name}：${c.summary}`);

  const subgraphTriplesText =
    reasoningPaths.length > 0
      ? reasoningPaths.map((p, idx) => `${idx + 1}. ${p}`).join('\n')
      : '暂无显式图谱跳转路径。';

  return {
    graphContext: {
      matchedEntities: seedNodes.map(({ node }) => ({
        id: node.id,
        label: node.label,
        type: node.type,
      })),
      reasoningPaths,
      subgraphNodeIds: Array.from(visitedNodes),
      subgraphEdgeIds: prioritizedEdges.map((e) => e.id),
      communitySummaries,
    },
    clauseBoosts,
    subgraphTriplesText,
  };
}
