import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  Bell,
  BookMarked,
  GitCompareArrows,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { AlertCenterView } from './components/AlertCenterView';
import { BatchUploadModal } from './components/BatchUploadModal';
import { ConflictCenterView } from './components/ConflictCenterView';
import {
  KnowledgeGraphView,
  type GraphHighlightState,
} from './components/KnowledgeGraphView';
import { PolicyLibraryView } from './components/PolicyLibraryView';
import {
  NewPolicyModal,
  PublishVersionModal,
  type RevisionDraftReference,
} from './components/PolicyModals';
import { RagAssistantView } from './components/RagAssistantView';
import { SettingsView } from './components/SettingsView';
import { VersionDiffView } from './components/VersionDiffView';
import type {
  AlertRule,
  BatchImportResponse,
  ConflictStatus,
  EffectiveCycle,
  LlmProviderPreset,
  LlmSettingsPublic,
  PolicyConflict,
  PolicyDocument,
  StoreState,
} from './types/policy';
import { safeParseJsonResponse } from './utils/api';
import { getProviderPreset } from './utils/llmProviders';

type NavTab =
  | 'rag'
  | 'graph'
  | 'conflicts'
  | 'diff'
  | 'library'
  | 'alerts'
  | 'settings';

export default function App() {
  const [store, setStore] = useState<StoreState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('rag');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [diffPolicyId, setDiffPolicyId] = useState<string | null>(null);
  const [graphPolicyScope, setGraphPolicyScope] = useState<string>('all');
  const [highlightSubgraph, setHighlightSubgraph] =
    useState<GraphHighlightState | null>(null);
  const [pendingRagQuestion, setPendingRagQuestion] = useState<string | null>(null);

  const [newPolicyOpen, setNewPolicyOpen] = useState(false);
  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const [publishVersionTarget, setPublishVersionTarget] =
    useState<PolicyDocument | null>(null);
  const [publishVersionReference, setPublishVersionReference] =
    useState<RevisionDraftReference | null>(null);

  const [scanning, setScanning] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LlmSettingsPublic | null>(null);
  const [llmProviders, setLlmProviders] = useState<LlmProviderPreset[]>([]);
  const [banner, setBanner] = useState<{
    type: 'info' | 'error';
    message: string;
  } | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      const data = await safeParseJsonResponse<StoreState>(res);
      setStore(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await safeParseJsonResponse<{
        settings: LlmSettingsPublic;
        providers: LlmProviderPreset[];
      }>(res);
      setLlmSettings(data.settings);
      setLlmProviders(data.providers);
    } catch {
      // Non-blocking settings metadata fetch
    }
  }, []);

  useEffect(() => {
    void fetchState();
    void fetchSettings();
  }, [fetchState, fetchSettings]);

  const counts = useMemo(() => {
    if (!store) {
      return {
        openConflicts: 0,
        unreadAlerts: 0,
        totalPolicies: 0,
        graphNodes: 0,
      };
    }
    return {
      openConflicts: store.conflicts.filter((c) => c.status === 'open').length,
      unreadAlerts: store.alerts.filter((a) => !a.read).length,
      totalPolicies: store.policies.length,
      graphNodes: store.knowledgeGraph?.nodes.length ?? 0,
    };
  }, [store]);

  const handleRebuildGraph = async () => {
    const res = await fetch('/api/graph/rebuild', { method: 'POST' });
    const data = await safeParseJsonResponse<{
      nodeCount: number;
      edgeCount: number;
      state: StoreState;
    }>(res);
    setStore(data.state);
  };

  const handleRunFullScan = async () => {
    if (scanning) return;
    setScanning(true);
    setBanner(null);
    try {
      const res = await fetch('/api/conflicts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await safeParseJsonResponse<{
        detectedCount: number;
        newlyAddedCount: number;
        state: StoreState;
      }>(res);
      setStore(data.state);
      setActiveTab('conflicts');
      setBanner({
        type: 'info',
        message: `冲突扫描完成：共识别 ${data.detectedCount} 处制度矛盾（新增 ${data.newlyAddedCount} 项待处理）。`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : '冲突扫描失败',
      });
    } finally {
      setScanning(false);
    }
  };

  const handleCreatePolicy = async (payload: {
    title: string;
    versionNumber: string;
    effectiveDate: string;
    effectiveCycle: EffectiveCycle;
    content: string;
    autoScan: boolean;
  }) => {
    const res = await fetch('/api/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await safeParseJsonResponse<{
      policy?: PolicyDocument;
      addedConflicts: number;
      scanWarning?: string;
      state: StoreState;
    }>(res);
    setStore(data.state);
    if (data.policy?.id) {
      setSelectedPolicyId(data.policy.id);
    }
    setActiveTab('library');
    setBanner({
      type: data.scanWarning ? 'error' : 'info',
      message: data.scanWarning
        ? data.scanWarning
        : `《${payload.title}》已入库${
            data.addedConflicts > 0
              ? `，自动检测到 ${data.addedConflicts} 项新增冲突并生成提醒`
              : '，未发现新增冲突'
          }。`,
    });
  };

  const handleBatchImported = (result: BatchImportResponse) => {
    setStore(result.state);
    setActiveTab('library');
    setBanner({
      type: result.scanWarning ? 'error' : 'info',
      message: result.scanWarning
        ? result.scanWarning
        : `批量导入完成：新制度 ${result.importedPoliciesCount} 份、版本更新 ${result.updatedVersionsCount} 份${
            result.addedConflicts > 0
              ? `，自动识别 ${result.addedConflicts} 项新冲突并发送提醒`
              : '，未发现新增冲突'
          }。`,
    });
  };

  const handlePublishVersion = async (
    policyId: string,
    payload: {
      versionNumber: string;
      effectiveDate: string;
      effectiveCycle: EffectiveCycle;
      changeSummary: string;
      content: string;
      autoScan: boolean;
    }
  ) => {
    const res = await fetch(`/api/policies/${policyId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await safeParseJsonResponse<{
      addedConflicts: number;
      scanWarning?: string;
      state: StoreState;
    }>(res);
    setStore(data.state);
    setDiffPolicyId(policyId);
    setActiveTab('diff');
    setBanner({
      type: data.scanWarning ? 'error' : 'info',
      message: data.scanWarning
        ? data.scanWarning
        : `已发布 ${payload.versionNumber}，可直接查看版本差异${
            data.addedConflicts > 0
              ? `（检测到 ${data.addedConflicts} 项新增冲突）`
              : ''
          }。`,
    });
  };

  const handleUpdateConflictStatus = async (
    id: string,
    status: ConflictStatus
  ) => {
    const res = await fetch(`/api/conflicts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await safeParseJsonResponse<{ state: StoreState }>(res);
    setStore(data.state);
  };

  const handleMarkAlertRead = async (id: string) => {
    const res = await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    const data = await safeParseJsonResponse<{ state: StoreState }>(res);
    setStore(data.state);
  };

  const handleAcknowledgeAlert = async (id: string) => {
    const res = await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledged: true, read: true }),
    });
    const data = await safeParseJsonResponse<{ state: StoreState }>(res);
    setStore(data.state);
  };

  const handleMarkAllAlertsRead = async () => {
    const res = await fetch('/api/alerts/mark-all-read', { method: 'POST' });
    const data = await safeParseJsonResponse<StoreState>(res);
    setStore(data);
  };

  const handleEvaluateRules = async () => {
    const res = await fetch('/api/alerts/evaluate', { method: 'POST' });
    const data = await safeParseJsonResponse<{
      generatedCount: number;
      state: StoreState;
    }>(res);
    setStore(data.state);
    return { generatedCount: data.generatedCount };
  };

  const handleUpdateRule = async (
    id: string,
    updates: Partial<Pick<AlertRule, 'enabled'>>
  ) => {
    const res = await fetch(`/api/alert-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await safeParseJsonResponse<{ state: StoreState }>(res);
    setStore(data.state);
  };

  const jumpToConflict = (conflictId?: string) => {
    if (conflictId) setSelectedConflictId(conflictId);
    setActiveTab('conflicts');
  };

  const jumpToPolicy = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setActiveTab('library');
  };

  const jumpToDiff = (policyId: string) => {
    setDiffPolicyId(policyId);
    setActiveTab('diff');
  };

  const jumpToPolicyGraph = (policyId: string) => {
    setHighlightSubgraph(null);
    setGraphPolicyScope(policyId);
    setActiveTab('graph');
  };

  const inspectConflictInGraph = (conflict: PolicyConflict) => {
    const graph = store?.knowledgeGraph;
    if (graph) {
      const edge = graph.edges.find((e) => e.conflictId === conflict.id);
      if (edge) {
        setHighlightSubgraph({
          label: conflict.title,
          nodeIds: [edge.source, edge.target],
          edgeIds: [edge.id],
        });
      }
    }
    setGraphPolicyScope('all');
    setActiveTab('graph');
  };

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof ShieldAlert;
    count?: number;
    highlight?: boolean;
  }> = [
    { id: 'rag', label: 'AI 制度问答', icon: MessageSquareText },
    {
      id: 'graph',
      label: '知识图谱',
      icon: Network,
      count: counts.graphNodes,
    },
    {
      id: 'conflicts',
      label: '冲突检测',
      icon: ShieldAlert,
      count: counts.openConflicts,
      highlight: counts.openConflicts > 0,
    },
    { id: 'diff', label: '版本对比', icon: GitCompareArrows },
    {
      id: 'library',
      label: '文档与上传',
      icon: BookMarked,
      count: counts.totalPolicies,
    },
    {
      id: 'alerts',
      label: '自动提醒',
      icon: Bell,
      count: counts.unreadAlerts,
      highlight: counts.unreadAlerts > 0,
    },
  ];

  const renderSidebarContent = (collapsed: boolean, isMobile = false) => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div
        className={`h-14 flex items-center border-b border-slate-200 shrink-0 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        {!collapsed && (
          <span className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap truncate">
            制度 GraphRAG
          </span>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors shrink-0"
            title={collapsed ? '展开菜单栏' : '收起菜单栏'}
            aria-label={collapsed ? '展开菜单栏' : '收起菜单栏'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          const tooltip = `${item.label}${item.count !== undefined ? ` (${item.count})` : ''}`;
          return (
            <button
              key={item.id}
              type="button"
              title={collapsed ? tooltip : undefined}
              aria-label={item.label}
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center rounded-md transition-colors whitespace-nowrap ${
                collapsed
                  ? 'justify-center px-2 py-2.5'
                  : 'justify-between gap-2 px-3 py-2 text-sm'
              } ${
                active
                  ? 'bg-blue-50 text-blue-800 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </span>
              {!collapsed && item.count !== undefined && (
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${
                    item.highlight ? 'text-red-700 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-2 border-t border-slate-200 shrink-0">
        <button
          type="button"
          title={collapsed ? '模型设置' : undefined}
          aria-label="模型设置"
          onClick={() => {
            setActiveTab('settings');
            setMobileMenuOpen(false);
          }}
          className={`w-full flex items-center rounded-md transition-colors whitespace-nowrap ${
            collapsed
              ? 'justify-center px-2 py-2.5'
              : 'justify-between gap-2 px-3 py-2 text-sm'
          } ${
            activeTab === 'settings'
              ? 'bg-blue-50 text-blue-800 font-medium'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Settings className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="truncate">模型设置</span>}
          </span>
          {!collapsed && llmSettings && (
            <span className="text-[11px] font-mono text-slate-400 truncate max-w-[74px]">
              {getProviderPreset(llmSettings.provider).shortName}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <aside
        className={`hidden md:block shrink-0 sticky top-0 h-screen transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-16' : 'w-48'
        }`}
      >
        {renderSidebarContent(sidebarCollapsed)}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-52 max-w-full h-full z-50">
            {renderSidebarContent(false, true)}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-slate-200 px-4 sm:px-5 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="打开菜单"
            >
              <Menu className="w-5 h-5" />
            </button>
            {store && (
              <div className="flex items-center gap-2.5 text-xs text-slate-500 overflow-x-auto whitespace-nowrap tabular-nums">
                <button
                  type="button"
                  onClick={() => setActiveTab('library')}
                  className="hover:text-slate-900 transition-colors"
                >
                  制度 <span className="font-mono font-medium text-slate-800">{counts.totalPolicies}</span> 份
                </button>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('graph')}
                  className="hover:text-slate-900 transition-colors"
                >
                  图谱 <span className="font-mono font-medium text-slate-800">{counts.graphNodes}</span> 节点
                </button>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('conflicts')}
                  className="hover:text-slate-900 transition-colors"
                >
                  待处理冲突{' '}
                  <span
                    className={`font-mono font-semibold ${
                      counts.openConflicts > 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {counts.openConflicts}
                  </span>{' '}
                  项
                </button>
                <span className="hidden sm:inline text-slate-300" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('alerts')}
                  className="hidden sm:inline hover:text-slate-900 transition-colors"
                >
                  未读提醒{' '}
                  <span
                    className={`font-mono font-medium ${
                      counts.unreadAlerts > 0 ? 'text-amber-700 font-semibold' : 'text-slate-800'
                    }`}
                  >
                    {counts.unreadAlerts}
                  </span>{' '}
                  条
                </button>
                {llmSettings && (
                  <>
                    <span className="hidden lg:inline text-slate-300" aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="hidden lg:inline hover:text-slate-900 transition-colors"
                    >
                      模型{' '}
                      <span className="font-mono font-medium text-slate-800">
                        {llmSettings.model}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setBatchUploadOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>上传文件</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunFullScan()}
              disabled={scanning || !store}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              <span>{scanning ? '正在扫描...' : '扫描冲突'}</span>
            </button>
          </div>
        </header>

        <main
          className={`flex-1 w-full min-w-0 ${
            activeTab === 'rag'
              ? 'p-0 flex flex-col h-[calc(100vh-3rem)] min-h-[520px]'
              : 'p-2.5 sm:p-3 space-y-3'
          }`}
        >
          {banner && (
            <div
              className={`px-4 py-3 rounded-md border flex items-center justify-between gap-3 text-xs ${
                activeTab === 'rag' ? 'mx-3 mt-3' : ''
              } ${
                banner.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {banner.type === 'error' && (
                  <AlertOctagon className="w-4 h-4 shrink-0 text-red-700" />
                )}
                <span>{banner.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="p-1 hover:opacity-70"
                aria-label="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-4">
              <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
              <div className="h-24 w-full bg-slate-100 rounded animate-pulse" />
            </div>
          ) : loadError || !store ? (
            <div className="bg-white border border-red-200 rounded-lg p-8 text-center space-y-3">
              <div className="text-sm font-medium text-red-800">
                {loadError || '无法加载制度文档库'}
              </div>
              <button
                type="button"
                onClick={() => void fetchState()}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md"
              >
                重试加载
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'conflicts' && (
                <ConflictCenterView
                  conflicts={store.conflicts}
                  selectedConflictId={selectedConflictId}
                  scanning={scanning}
                  onSelectConflict={setSelectedConflictId}
                  onRunFullScan={handleRunFullScan}
                  onUpdateConflictStatus={handleUpdateConflictStatus}
                  onJumpToPolicy={jumpToPolicy}
                  onInspectConflictInGraph={inspectConflictInGraph}
                  onOpenManualRevision={(policyId, reference) => {
                    const target = store.policies.find((p) => p.id === policyId);
                    if (target) {
                      setPublishVersionReference(reference);
                      setPublishVersionTarget(target);
                    }
                  }}
                />
              )}

              {activeTab === 'diff' && (
                <VersionDiffView
                  policies={store.policies}
                  initialPolicyId={diffPolicyId}
                  onOpenPublishVersion={(policy) => setPublishVersionTarget(policy)}
                />
              )}

              {activeTab === 'rag' && (
                <RagAssistantView
                  policyCount={counts.totalPolicies}
                  graphNodeCount={counts.graphNodes}
                  openConflictCount={counts.openConflicts}
                  pendingQuestion={pendingRagQuestion}
                  onConsumePendingQuestion={() => setPendingRagQuestion(null)}
                  onJumpToConflict={jumpToConflict}
                  onJumpToPolicy={jumpToPolicy}
                  onInspectGraphSubgraph={(highlight) => {
                    setHighlightSubgraph(highlight);
                    setGraphPolicyScope('all');
                    setActiveTab('graph');
                  }}
                />
              )}

              {activeTab === 'graph' && (
                <KnowledgeGraphView
                  graph={store.knowledgeGraph}
                  policies={store.policies}
                  conflicts={store.conflicts}
                  selectedPolicyScope={graphPolicyScope}
                  onSelectPolicyScope={(policyId) => {
                    setGraphPolicyScope(policyId);
                    if (policyId !== 'all') {
                      setHighlightSubgraph(null);
                    }
                  }}
                  highlightSubgraph={highlightSubgraph}
                  onClearHighlight={() => setHighlightSubgraph(null)}
                  onRebuildGraph={handleRebuildGraph}
                  onJumpToConflict={jumpToConflict}
                  onJumpToPolicy={jumpToPolicy}
                  onAskAboutNode={(q) => {
                    setPendingRagQuestion(q);
                    setActiveTab('rag');
                  }}
                />
              )}

              {activeTab === 'library' && (
                <PolicyLibraryView
                  policies={store.policies}
                  selectedPolicyId={selectedPolicyId}
                  onSelectPolicy={setSelectedPolicyId}
                  onOpenNewPolicy={() => setNewPolicyOpen(true)}
                  onOpenBatchUpload={() => setBatchUploadOpen(true)}
                  onOpenPublishVersion={(policy) => setPublishVersionTarget(policy)}
                  onJumpToDiff={jumpToDiff}
                  onJumpToGraph={jumpToPolicyGraph}
                />
              )}

              {activeTab === 'alerts' && (
                <AlertCenterView
                  alerts={store.alerts}
                  alertRules={store.alertRules}
                  onMarkRead={handleMarkAlertRead}
                  onAcknowledge={handleAcknowledgeAlert}
                  onMarkAllRead={handleMarkAllAlertsRead}
                  onEvaluateRules={handleEvaluateRules}
                  onUpdateRule={handleUpdateRule}
                  onJumpToConflict={(id) => jumpToConflict(id)}
                  onJumpToPolicy={jumpToPolicy}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  settings={llmSettings}
                  providers={llmProviders}
                  onSettingsUpdated={(next) => setLlmSettings(next)}
                />
              )}
            </>
          )}
        </main>
      </div>

      <NewPolicyModal
        open={newPolicyOpen}
        onClose={() => setNewPolicyOpen(false)}
        onSwitchToBatch={() => setBatchUploadOpen(true)}
        onCreated={handleCreatePolicy}
      />

      <BatchUploadModal
        open={batchUploadOpen}
        existingPolicies={store?.policies ?? []}
        onClose={() => setBatchUploadOpen(false)}
        onSwitchToManual={() => setNewPolicyOpen(true)}
        onImported={handleBatchImported}
        onJumpToConflicts={() => setActiveTab('conflicts')}
      />

      <PublishVersionModal
        key={`${publishVersionTarget?.id ?? 'closed'}-${publishVersionReference?.conflictId ?? 'plain'}-${publishVersionReference?.editingSide ?? 'A'}`}
        policy={publishVersionTarget}
        revisionReference={publishVersionReference}
        onClose={() => {
          setPublishVersionTarget(null);
          setPublishVersionReference(null);
        }}
        onPublished={handlePublishVersion}
      />
    </div>
  );
}
