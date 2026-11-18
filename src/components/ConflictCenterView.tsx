import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileEdit,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import type { ConflictStatus, PolicyConflict } from '../types/policy';
import type { RevisionDraftReference } from './PolicyModals';
import { safeParseJsonResponse } from '../utils/api';
import {
  getConflictPoints,
  splitHighlightedExcerpt,
} from '../utils/conflictHighlight';
import { CONFLICT_TYPE_LABELS } from '../utils/labels';
import { SeverityLabel } from './SeverityLabel';

interface ConflictCenterViewProps {
  conflicts: PolicyConflict[];
  selectedConflictId: string | null;
  scanning: boolean;
  onSelectConflict: (id: string) => void;
  onRunFullScan: () => Promise<void>;
  onUpdateConflictStatus: (
    id: string,
    status: ConflictStatus
  ) => Promise<void>;
  onJumpToPolicy: (policyId: string) => void;
  onInspectConflictInGraph?: (conflict: PolicyConflict) => void;
  onOpenManualRevision?: (
    policyId: string,
    reference: RevisionDraftReference
  ) => void;
}

export function ConflictCenterView({
  conflicts,
  selectedConflictId,
  scanning,
  onSelectConflict,
  onRunFullScan,
  onUpdateConflictStatus,
  onJumpToPolicy,
  onInspectConflictInGraph,
  onOpenManualRevision,
}: ConflictCenterViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<
    Record<
      string,
      {
        recommendedPolicyToUpdate: string;
        revisedClauseText: string;
        rationale: string;
      }
    >
  >({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openCount = useMemo(
    () => conflicts.filter((c) => c.status === 'open').length,
    [conflicts]
  );
  const resolvedCount = useMemo(
    () => conflicts.filter((c) => c.status === 'resolved').length,
    [conflicts]
  );
  const criticalCount = useMemo(
    () =>
      conflicts.filter(
        (c) =>
          c.severity === 'critical' &&
          (statusFilter === 'all' || c.status === statusFilter)
      ).length,
    [conflicts, statusFilter]
  );

  const filteredConflicts = useMemo(() => {
    return conflicts.filter((c) => {
      if (statusFilter === 'open' && c.status !== 'open') return false;
      if (statusFilter === 'resolved' && c.status !== 'resolved') return false;
      if (severityFilter === 'critical' && c.severity !== 'critical') return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const pointsText = (c.conflictPoints ?? [])
          .map((p) => `${p.dimension} ${p.valueA} ${p.valueB} ${p.impact ?? ''}`)
          .join(' ');
        const hay = `${c.title} ${c.description} ${c.policyATitle} ${c.policyBTitle} ${pointsText}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [conflicts, statusFilter, severityFilter, searchTerm]);

  const activeConflict =
    filteredConflicts.find((c) => c.id === selectedConflictId) ??
    filteredConflicts[0] ??
    null;

  const activePoints = useMemo(
    () => (activeConflict ? getConflictPoints(activeConflict) : []),
    [activeConflict]
  );

  const excerptASegments = useMemo(
    () =>
      activeConflict
        ? splitHighlightedExcerpt(activeConflict.excerptA, activePoints, 'A')
        : [],
    [activeConflict, activePoints]
  );

  const excerptBSegments = useMemo(
    () =>
      activeConflict
        ? splitHighlightedExcerpt(activeConflict.excerptB, activePoints, 'B')
        : [],
    [activeConflict, activePoints]
  );

  const handleDraftResolution = async (conflictId: string) => {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/conflicts/${conflictId}/draft-fix`, {
        method: 'POST',
      });
      const data = await safeParseJsonResponse<{
        recommendedPolicyToUpdate: string;
        revisedClauseText: string;
        rationale: string;
      }>(res);
      setDraftResult((prev) => ({ ...prev, [conflictId]: data }));
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : '生成修订建议失败');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleCopyDraft = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
            {(
              [
                ['open', `待处理 (${openCount})`],
                ['resolved', `已解决 (${resolvedCount})`],
                ['all', `全部 (${conflicts.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap tabular-nums ${
                  statusFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
            <button
              type="button"
              onClick={() => setSeverityFilter('all')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                severityFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部等级
            </button>
            <button
              type="button"
              onClick={() => setSeverityFilter('critical')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap tabular-nums ${
                severityFilter === 'critical'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-red-700'
              }`}
            >
              仅看严重矛盾 ({criticalCount})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-1 lg:max-w-md justify-end">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索冲突内容、阈值或制度名称..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={() => void onRunFullScan()}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? '正在扫描...' : '立即扫描全库'}</span>
          </button>
        </div>
      </div>

      {filteredConflicts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-3" />
          <div className="text-sm font-medium text-slate-900">
            {statusFilter === 'open' ? '当前筛选下没有待处理的制度冲突' : '暂无匹配的冲突记录'}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            上传新制度后系统会自动识别矛盾条款，您也可以随时切换筛选或点击「立即扫描全库」进行排查。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
            {filteredConflicts.map((c) => {
              const isSelected = activeConflict?.id === c.id;
              const primaryPoint = getConflictPoints(c)[0];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConflict(c.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors ${
                    isSelected ? 'bg-blue-50/75' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <SeverityLabel severity={c.severity} />
                    <span className="text-xs text-slate-500">
                      {CONFLICT_TYPE_LABELS[c.type]}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 leading-5">
                    {c.title}
                  </div>
                  {primaryPoint && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs tabular-nums min-w-0">
                      <span className="text-rose-800 font-medium truncate">
                        {primaryPoint.valueA}
                      </span>
                      <ArrowLeftRight
                        className="w-3 h-3 text-slate-400 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="text-amber-800 font-medium truncate">
                        {primaryPoint.valueB}
                      </span>
                    </div>
                  )}
                  <div className="mt-1.5 text-xs text-slate-500 truncate">
                    《{c.policyATitle}》 vs 《{c.policyBTitle}》
                  </div>
                </button>
              );
            })}
          </div>

          {activeConflict && (
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
              {/* Top summary header */}
              <div className="pb-4 border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs">
                    <SeverityLabel severity={activeConflict.severity} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-slate-600 font-medium">
                      {CONFLICT_TYPE_LABELS[activeConflict.type]}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span
                      className={
                        activeConflict.status === 'resolved'
                          ? 'text-emerald-700 font-medium'
                          : 'text-slate-500'
                      }
                    >
                      {activeConflict.status === 'resolved' ? '已解决' : '待处理'}
                    </span>
                  </div>
                  {onInspectConflictInGraph && (
                    <button
                      type="button"
                      onClick={() => onInspectConflictInGraph(activeConflict)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:underline whitespace-nowrap"
                    >
                      <Network className="w-3.5 h-3.5" />
                      <span>在知识图谱中查看关联</span>
                    </button>
                  )}
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {activeConflict.title}
                </h2>
                <p className="text-sm text-slate-600 leading-6 mt-1.5">
                  {activeConflict.description}
                </p>
              </div>

              {/* Focal Anchor: Direct Contradiction Points Comparison Matrix */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-800">
                    核心矛盾点一目了然对照
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    共提炼 {activePoints.length} 处关键差异
                  </span>
                </div>

                <div className="border border-slate-200 rounded-md overflow-hidden">
                  {/* Table Header */}
                  <div className="hidden md:grid md:grid-cols-[minmax(120px,22%)_1fr_36px_1fr] bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <div className="px-3.5 py-2.5">冲突维度</div>
                    <div className="px-3.5 py-2.5 border-l border-slate-200 flex items-center justify-between gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => onJumpToPolicy(activeConflict.policyAId)}
                        className="inline-flex items-center gap-1 text-rose-800 font-semibold hover:underline truncate"
                      >
                        <span className="truncate">《{activeConflict.policyATitle}》</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                      <span className="font-mono text-slate-500 shrink-0">
                        {activeConflict.policyAVersion}
                      </span>
                    </div>
                    <div className="py-2.5 flex items-center justify-center text-slate-400 border-l border-slate-200">
                      对立
                    </div>
                    <div className="px-3.5 py-2.5 border-l border-slate-200 flex items-center justify-between gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => onJumpToPolicy(activeConflict.policyBId)}
                        className="inline-flex items-center gap-1 text-amber-800 font-semibold hover:underline truncate"
                      >
                        <span className="truncate">《{activeConflict.policyBTitle}》</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                      <span className="font-mono text-slate-500 shrink-0">
                        {activeConflict.policyBVersion}
                      </span>
                    </div>
                  </div>

                  {/* Comparison Rows */}
                  <div className="divide-y divide-slate-200">
                    {activePoints.map((point, idx) => (
                      <div key={`${activeConflict.id}-pt-${idx}`}>
                        {/* Desktop grid row */}
                        <div className="hidden md:grid md:grid-cols-[minmax(120px,22%)_1fr_36px_1fr] items-stretch">
                          <div className="px-3.5 py-3 text-xs font-semibold text-slate-800 bg-white flex items-center">
                            {point.dimension}
                          </div>
                          <div className="px-3.5 py-3 border-l border-slate-200 bg-rose-50/45 text-sm font-semibold text-rose-900 leading-5 tabular-nums flex items-center">
                            {point.valueA}
                          </div>
                          <div className="border-l border-slate-200 bg-slate-50/60 flex items-center justify-center text-xs font-semibold text-red-600">
                            ≠
                          </div>
                          <div className="px-3.5 py-3 border-l border-slate-200 bg-amber-50/45 text-sm font-semibold text-amber-950 leading-5 tabular-nums flex items-center">
                            {point.valueB}
                          </div>
                        </div>

                        {/* Mobile stacked layout */}
                        <div className="md:hidden p-3.5 space-y-2">
                          <div className="text-xs font-semibold text-slate-800">
                            {point.dimension}
                          </div>
                          <div className="grid grid-cols-1 gap-1.5 text-xs">
                            <div className="px-2.5 py-2 rounded bg-rose-50/60 text-rose-900 font-semibold tabular-nums">
                              <span className="text-rose-700 font-normal mr-1.5">
                                《{activeConflict.policyATitle}》:
                              </span>
                              {point.valueA}
                            </div>
                            <div className="px-2.5 py-2 rounded bg-amber-50/60 text-amber-950 font-semibold tabular-nums">
                              <span className="text-amber-700 font-normal mr-1.5">
                                《{activeConflict.policyBTitle}》:
                              </span>
                              {point.valueB}
                            </div>
                          </div>
                        </div>

                        {point.impact && (
                          <div className="px-3.5 py-2 bg-slate-50/50 border-t border-slate-100 text-xs text-slate-600">
                            <span className="font-medium text-slate-700">冲突后果：</span>
                            {point.impact}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Original Clauses with inline highlighted opposing tokens */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-800">
                    原条款对比（关键冲突语句已标亮）
                  </h3>
                  <span className="text-xs text-slate-500">
                    点击制度名称可跳转原文库
                  </span>
                </div>

                <div className="border border-slate-200 rounded-md overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  <div className="p-4 space-y-2 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => onJumpToPolicy(activeConflict.policyAId)}
                          className="text-xs font-semibold text-rose-800 hover:underline text-left truncate"
                        >
                          《{activeConflict.policyATitle}》
                        </button>
                        <span className="text-xs font-mono text-slate-500 shrink-0 tabular-nums">
                          {activeConflict.policyAVersion}
                        </span>
                      </div>
                      {onOpenManualRevision && (
                        <button
                          type="button"
                          onClick={() => {
                            const draft = draftResult[activeConflict.id];
                            onOpenManualRevision(activeConflict.policyAId, {
                              conflictId: activeConflict.id,
                              conflictTitle: activeConflict.title,
                              conflict: activeConflict,
                              editingSide: 'A',
                              targetClauseRef: activeConflict.clauseA,
                              conflictExcerpt: activeConflict.excerptA,
                              recommendedPolicyToUpdate: draft?.recommendedPolicyToUpdate,
                              revisedClauseText: draft?.revisedClauseText,
                              rationale: draft?.rationale,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <FileEdit className="w-3 h-3" />
                          <span>人工修改</span>
                        </button>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-600">
                      {activeConflict.clauseA}
                    </div>
                    <p className="text-xs text-slate-700 leading-6 pt-1 tabular-nums">
                      “
                      {excerptASegments.map((seg, i) =>
                        seg.highlighted ? (
                          <mark
                            key={i}
                            className="bg-rose-100/90 text-rose-950 font-semibold px-1 rounded-xs border-b border-rose-400"
                          >
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        )
                      )}
                      ”
                    </p>
                  </div>

                  <div className="p-4 space-y-2 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => onJumpToPolicy(activeConflict.policyBId)}
                          className="text-xs font-semibold text-amber-800 hover:underline text-left truncate"
                        >
                          《{activeConflict.policyBTitle}》
                        </button>
                        <span className="text-xs font-mono text-slate-500 shrink-0 tabular-nums">
                          {activeConflict.policyBVersion}
                        </span>
                      </div>
                      {onOpenManualRevision && (
                        <button
                          type="button"
                          onClick={() => {
                            const draft = draftResult[activeConflict.id];
                            onOpenManualRevision(activeConflict.policyBId, {
                              conflictId: activeConflict.id,
                              conflictTitle: activeConflict.title,
                              conflict: activeConflict,
                              editingSide: 'B',
                              targetClauseRef: activeConflict.clauseB,
                              conflictExcerpt: activeConflict.excerptB,
                              recommendedPolicyToUpdate: draft?.recommendedPolicyToUpdate,
                              revisedClauseText: draft?.revisedClauseText,
                              rationale: draft?.rationale,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <FileEdit className="w-3 h-3" />
                          <span>人工修改</span>
                        </button>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-600">
                      {activeConflict.clauseB}
                    </div>
                    <p className="text-xs text-slate-700 leading-6 pt-1 tabular-nums">
                      “
                      {excerptBSegments.map((seg, i) =>
                        seg.highlighted ? (
                          <mark
                            key={i}
                            className="bg-amber-100/90 text-amber-950 font-semibold px-1 rounded-xs border-b border-amber-400"
                          >
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        )
                      )}
                      ”
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">解决建议</div>
                <p className="text-xs text-slate-600 leading-6">
                  {activeConflict.suggestedResolution}
                </p>

                {draftError && (
                  <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                    {draftError}
                  </div>
                )}

                {draftResult[activeConflict.id] && (
                  <div className="pt-3 border-t border-slate-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-900">
                        AI 辅助参考草案 · 建议修订：《{draftResult[activeConflict.id].recommendedPolicyToUpdate}》
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyDraft(
                            activeConflict.id,
                            draftResult[activeConflict.id].revisedClauseText
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedId === activeConflict.id ? '已复制' : '复制条款'}</span>
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap leading-5">
                      {draftResult[activeConflict.id].revisedClauseText}
                    </pre>
                    <div className="text-xs text-slate-500">
                      依据：{draftResult[activeConflict.id].rationale}
                    </div>
                    {onOpenManualRevision && (
                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        {(() => {
                          const rec = draftResult[activeConflict.id].recommendedPolicyToUpdate;
                          const preferB =
                            rec.includes(activeConflict.policyBTitle) &&
                            !rec.includes(activeConflict.policyATitle);
                          const primaryId = preferB
                            ? activeConflict.policyBId
                            : activeConflict.policyAId;
                          const primaryTitle = preferB
                            ? activeConflict.policyBTitle
                            : activeConflict.policyATitle;
                          const secondaryId = preferB
                            ? activeConflict.policyAId
                            : activeConflict.policyBId;
                          const secondaryTitle = preferB
                            ? activeConflict.policyATitle
                            : activeConflict.policyBTitle;
                          const primarySide: 'A' | 'B' = preferB ? 'B' : 'A';
                          const secondarySide: 'A' | 'B' = preferB ? 'A' : 'B';
                          const primaryRefPayload: RevisionDraftReference = {
                            conflictId: activeConflict.id,
                            conflictTitle: activeConflict.title,
                            conflict: activeConflict,
                            editingSide: primarySide,
                            targetClauseRef:
                              primarySide === 'A'
                                ? activeConflict.clauseA
                                : activeConflict.clauseB,
                            conflictExcerpt:
                              primarySide === 'A'
                                ? activeConflict.excerptA
                                : activeConflict.excerptB,
                            recommendedPolicyToUpdate: rec,
                            revisedClauseText:
                              draftResult[activeConflict.id].revisedClauseText,
                            rationale: draftResult[activeConflict.id].rationale,
                          };
                          const secondaryRefPayload: RevisionDraftReference = {
                            ...primaryRefPayload,
                            editingSide: secondarySide,
                            targetClauseRef:
                              secondarySide === 'A'
                                ? activeConflict.clauseA
                                : activeConflict.clauseB,
                            conflictExcerpt:
                              secondarySide === 'A'
                                ? activeConflict.excerptA
                                : activeConflict.excerptB,
                          };
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenManualRevision(primaryId, primaryRefPayload)
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors whitespace-nowrap"
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                                <span>人工修订《{primaryTitle}》</span>
                              </button>
                              {secondaryId !== primaryId && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenManualRevision(secondaryId, secondaryRefPayload)
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                                >
                                  <FileEdit className="w-3.5 h-3.5" />
                                  <span>人工修订《{secondaryTitle}》</span>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {onOpenManualRevision && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const draft = draftResult[activeConflict.id];
                            onOpenManualRevision(activeConflict.policyAId, {
                              conflictId: activeConflict.id,
                              conflictTitle: activeConflict.title,
                              conflict: activeConflict,
                              editingSide: 'A',
                              targetClauseRef: activeConflict.clauseA,
                              conflictExcerpt: activeConflict.excerptA,
                              recommendedPolicyToUpdate: draft?.recommendedPolicyToUpdate,
                              revisedClauseText: draft?.revisedClauseText,
                              rationale: draft?.rationale,
                            });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                        >
                          <FileEdit className="w-3.5 h-3.5 text-blue-700" />
                          <span>人工修改《{activeConflict.policyATitle}》</span>
                        </button>
                        {activeConflict.policyBId !== activeConflict.policyAId && (
                          <button
                            type="button"
                            onClick={() => {
                              const draft = draftResult[activeConflict.id];
                              onOpenManualRevision(activeConflict.policyBId, {
                                conflictId: activeConflict.id,
                                conflictTitle: activeConflict.title,
                                conflict: activeConflict,
                                editingSide: 'B',
                                targetClauseRef: activeConflict.clauseB,
                                conflictExcerpt: activeConflict.excerptB,
                                recommendedPolicyToUpdate: draft?.recommendedPolicyToUpdate,
                                revisedClauseText: draft?.revisedClauseText,
                                rationale: draft?.rationale,
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                          >
                            <FileEdit className="w-3.5 h-3.5 text-blue-700" />
                            <span>人工修改《{activeConflict.policyBTitle}》</span>
                          </button>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleDraftResolution(activeConflict.id)}
                      disabled={draftLoading}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {draftLoading ? '正在起草条款...' : 'AI 生成修订参考'}
                      </span>
                    </button>
                  </div>

                  {activeConflict.status !== 'resolved' ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateConflictStatus(activeConflict.id, 'resolved')
                      }
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>人工确认已解决</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateConflictStatus(activeConflict.id, 'open')
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>恢复待处理</span>
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  修订原则：AI 仅作起草辅助，最终内容编辑与版本确认由人工审校执行。
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
