export type PolicyStatus = 'active' | 'draft' | 'archived';

export type EffectiveCycle =
  | '6_months'
  | '1_year'
  | '2_years'
  | '3_years'
  | 'long_term'
  | 'unclear';

export interface PolicyChunk {
  id: string;
  policyId: string;
  versionId: string;
  clauseRef: string;
  heading: string;
  content: string;
  embedding?: number[];
}

export interface PolicyVersion {
  id: string;
  versionNumber: string;
  effectiveDate: string;
  effectiveCycle?: EffectiveCycle;
  effectiveCycleNote?: string;
  createdAt: string;
  author: string;
  changeSummary: string;
  content: string;
  chunks: PolicyChunk[];
}

export interface PolicyDocument {
  id: string;
  code: string;
  title: string;
  category: string;
  department: string;
  owner: string;
  status: PolicyStatus;
  currentVersionId: string;
  effectiveDate?: string;
  effectiveCycle?: EffectiveCycle;
  effectiveCycleNote?: string;
  reviewCycleMonths: number;
  nextReviewDate: string;
  updatedAt: string;
  versions: PolicyVersion[];
}

export type ConflictType =
  | 'numeric_threshold'
  | 'approval_authority'
  | 'scope_exclusion'
  | 'stale_reference'
  | 'ambiguity';

export type SeverityLevel = 'critical' | 'warning' | 'info';

export type ConflictStatus = 'open' | 'resolved' | 'ignored';

export interface ConflictPoint {
  dimension: string;
  valueA: string;
  valueB: string;
  impact?: string;
}

export interface PolicyConflict {
  id: string;
  type: ConflictType;
  severity: SeverityLevel;
  status: ConflictStatus;
  title: string;
  description: string;
  suggestedResolution: string;
  conflictPoints?: ConflictPoint[];
  policyAId: string;
  policyATitle: string;
  policyAVersion: string;
  clauseA: string;
  excerptA: string;
  policyBId: string;
  policyBTitle: string;
  policyBVersion: string;
  clauseB: string;
  excerptB: string;
  detectedAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export type AlertTriggerType =
  | 'new_conflict'
  | 'review_due'
  | 'version_impact'
  | 'unresolved_sla';

export interface AlertItem {
  id: string;
  type: AlertTriggerType;
  severity: SeverityLevel;
  title: string;
  message: string;
  targetDepartment: string;
  relatedPolicyId?: string;
  relatedConflictId?: string;
  createdAt: string;
  read: boolean;
  acknowledged: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  triggerType: AlertTriggerType;
  enabled: boolean;
  thresholdDays: number;
  minSeverity: SeverityLevel;
  notifyDepartments: string[];
  lastTriggeredAt?: string;
}

export interface RagCitation {
  policyId: string;
  policyTitle: string;
  versionNumber: string;
  clauseRef: string;
  excerpt: string;
  relevanceScore: number;
}

export interface RagConflictWarning {
  conflictId?: string;
  summary: string;
  clauseA: string;
  clauseB: string;
  severity: SeverityLevel;
}

export type GraphNodeType = 'policy' | 'clause' | 'role' | 'rule' | 'topic';

export type GraphRelationType =
  | 'contains'
  | 'requires_approval'
  | 'defines_rule'
  | 'applies_to'
  | 'references'
  | 'conflicts_with';

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  policyId?: string;
  policyTitle?: string;
  versionNumber?: string;
  clauseRef?: string;
  department?: string;
  summary?: string;
  communityId?: string;
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelationType;
  label: string;
  conflictId?: string;
  severity?: SeverityLevel;
  evidence?: string;
}

export interface GraphCommunity {
  id: string;
  name: string;
  summary: string;
  nodeIds: string[];
  policyIds: string[];
  openConflictCount: number;
}

export interface PolicyKnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  updatedAt: string;
  builtBy: 'deterministic' | 'gemini_hybrid';
}

export interface RagGraphContext {
  matchedEntities: Array<{
    id: string;
    label: string;
    type: GraphNodeType;
  }>;
  reasoningPaths: string[];
  subgraphNodeIds: string[];
  subgraphEdgeIds: string[];
  communitySummaries: string[];
}

export interface RagQueryResult {
  answer: string;
  hasConflict: boolean;
  conflictWarnings: RagConflictWarning[];
  citations: RagCitation[];
  retrievedChunks: number;
  usedEmbeddings: boolean;
  graphContext?: RagGraphContext;
}

export interface DiffLineItem {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

export interface SemanticDiffAnalysis {
  summary: string;
  impactLevel: SeverityLevel;
  keyChanges: Array<{
    clause: string;
    changeType: 'modified' | 'added' | 'removed';
    description: string;
    downstreamRisk: string;
  }>;
  affectedPolicies: string[];
  potentialConflicts: string[];
}

export interface StoreState {
  policies: PolicyDocument[];
  conflicts: PolicyConflict[];
  alerts: AlertItem[];
  alertRules: AlertRule[];
  knowledgeGraph?: PolicyKnowledgeGraph;
  lastAuditAt: string;
}

export interface ParsedUploadFileItem {
  tempId: string;
  fileName: string;
  fileSize: number;
  title: string;
  code: string;
  category: string;
  department: string;
  owner: string;
  versionNumber: string;
  effectiveDate: string;
  effectiveDateExtracted?: boolean;
  effectiveDateSource?: string;
  effectiveCycle: EffectiveCycle | '';
  effectiveCycleExtracted?: boolean;
  effectiveCycleSource?: string;
  nextReviewDate: string;
  changeSummary: string;
  content: string;
  chunkCount: number;
  clauseHeadings?: string[];
  mode: 'new_policy' | 'new_version';
  matchedExistingPolicyId?: string;
  matchedExistingPolicyTitle?: string;
  parseError?: string;
}

export interface BatchImportResponse {
  importedPoliciesCount: number;
  updatedVersionsCount: number;
  addedConflicts: number;
  scanWarning?: string;
  state: StoreState;
}

export type ParseStreamStage = 'reading' | 'extracting' | 'chunking' | 'parsed' | 'error';

export interface UploadParseStreamEvent {
  type: 'stage';
  stage: ParseStreamStage;
  fileName: string;
  fileSize?: number;
  detail: string;
  charCount?: number;
  clauseHeadings?: string[];
  matchedTitle?: string;
  effectiveDate?: string;
  effectiveCycle?: EffectiveCycle | '';
  elapsedMs?: number;
  file?: ParsedUploadFileItem;
}

export type ImportPipelineStage = 'ingest' | 'embeddings' | 'graph' | 'conflicts';

export interface BatchImportStreamEvent {
  type: 'stage' | 'complete' | 'error';
  stage?: ImportPipelineStage;
  status?: 'running' | 'done' | 'skipped' | 'warning';
  detail?: string;
  elapsedMs?: number;
  metrics?: {
    policiesCount?: number;
    chunksCount?: number;
    clauseHeadings?: string[];
    completedEmbeddings?: number;
    totalEmbeddings?: number;
    dimensions?: number;
    addedNodes?: number;
    addedEdges?: number;
    totalNodes?: number;
    totalEdges?: number;
    sampleEntities?: string[];
    detectedConflicts?: number;
    addedConflicts?: number;
    conflictTitles?: string[];
  };
  result?: BatchImportResponse;
  error?: string;
}

export type LlmProviderId =
  | 'deepseek'
  | 'gemini'
  | 'openai'
  | 'qwen'
  | 'glm'
  | 'kimi'
  | 'custom';

export type LlmProtocol = 'gemini' | 'openai';

export interface LlmProviderPreset {
  id: LlmProviderId;
  name: string;
  shortName: string;
  protocol: LlmProtocol;
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
  description: string;
  baseUrlPlaceholder: string;
  supportsBuiltInKey?: boolean;
}

export interface LlmSettingsPublic {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  hasCustomApiKey: boolean;
  hasBuiltInGeminiKey: boolean;
  apiKeyMasked: string;
  source: 'built_in' | 'custom' | 'unconfigured';
  updatedAt: string;
}

export interface LlmSettingsInput {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  latencyMs: number;
  replyPreview?: string;
  error?: string;
}
