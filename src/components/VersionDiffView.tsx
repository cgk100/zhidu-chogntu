import { useEffect, useState } from 'react';
import { GitCompareArrows, Sparkles, Upload } from 'lucide-react';
import type {
  DiffLineItem,
  PolicyDocument,
  SemanticDiffAnalysis,
} from '../types/policy';
import { safeParseJsonResponse } from '../utils/api';
import { SeverityLabel } from './SeverityLabel';

interface VersionDiffViewProps {
  policies: PolicyDocument[];
  initialPolicyId: string | null;
  onOpenPublishVersion: (policy: PolicyDocument) => void;
}

interface DiffPayload {
  policyTitle: string;
  oldVersion: {
    id: string;
    versionNumber: string;
    effectiveDate: string;
  };
  newVersion: {
    id: string;
    versionNumber: string;
    effectiveDate: string;
  };
  stats: { addedCount: number; removedCount: number };
  lines: DiffLineItem[];
}

export function VersionDiffView({
  policies,
  initialPolicyId,
  onOpenPublishVersion,
}: VersionDiffViewProps) {
  const multiVersionPolicies = policies.filter((p) => p.versions.length >= 2);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>(() => {
    if (initialPolicyId && policies.some((p) => p.id === initialPolicyId)) {
      return initialPolicyId;
    }
    return multiVersionPolicies[0]?.id ?? policies[0]?.id ?? '';
  });

  useEffect(() => {
    if (initialPolicyId && policies.some((p) => p.id === initialPolicyId)) {
      setSelectedPolicyId(initialPolicyId);
    }
  }, [initialPolicyId, policies]);

  const selectedPolicy =
    policies.find((p) => p.id === selectedPolicyId) ?? policies[0] ?? null;

  const [oldVersionId, setOldVersionId] = useState<string>('');
  const [newVersionId, setNewVersionId] = useState<string>('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [diffData, setDiffData] = useState<DiffPayload | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [semanticAnalysis, setSemanticAnalysis] =
    useState<SemanticDiffAnalysis | null>(null);
  const [loadingSemantic, setLoadingSemantic] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPolicy) return;
    const versions = selectedPolicy.versions;
    if (versions.length >= 2) {
      setOldVersionId(versions[versions.length - 2].id);
      setNewVersionId(versions[versions.length - 1].id);
    } else if (versions.length === 1) {
      setOldVersionId(versions[0].id);
      setNewVersionId(versions[0].id);
    }
    setSemanticAnalysis(null);
    setSemanticError(null);
  }, [selectedPolicy]);

  useEffect(() => {
    if (!selectedPolicy || !oldVersionId || !newVersionId) return;
    if (selectedPolicy.versions.length < 2) {
      setDiffData(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    fetch(
      `/api/diff?policyId=${encodeURIComponent(selectedPolicy.id)}&oldVersionId=${encodeURIComponent(oldVersionId)}&newVersionId=${encodeURIComponent(newVersionId)}`
    )
      .then((res) => safeParseJsonResponse<DiffPayload>(res))
      .then((data) => {
        if (!cancelled && data.lines) {
          setDiffData(data);
        }
      })
      .catch(() => {
        // Keep clean state
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPolicy, oldVersionId, newVersionId]);

  const handleRunSemantic = async () => {
    if (!selectedPolicy || !oldVersionId || !newVersionId) return;
    setLoadingSemantic(true);
    setSemanticError(null);
    try {
      const res = await fetch('/api/diff/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyId: selectedPolicy.id,
          oldVersionId,
          newVersionId,
        }),
      });
      const data = await safeParseJsonResponse<SemanticDiffAnalysis>(res);
      setSemanticAnalysis(data);
    } catch (err) {
      setSemanticError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setLoadingSemantic(false);
    }
  };

  if (!selectedPolicy) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-sm text-slate-500">
        暂无可对比的制度文档。
      </div>
    );
  }

  const displayedLines = diffData
    ? onlyChanged
      ? diffData.lines.filter((l) => l.type !== 'unchanged')
      : diffData.lines
    : [];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                制度文档
              </label>
              <select
                value={selectedPolicy.id}
                onChange={(e) => setSelectedPolicyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}（{p.versions.length} 版）
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                旧版本
              </label>
              <select
                value={oldVersionId}
                onChange={(e) => {
                  setOldVersionId(e.target.value);
                  setSemanticAnalysis(null);
                }}
                disabled={selectedPolicy.versions.length < 2}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
              >
                {selectedPolicy.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.versionNumber} · {v.effectiveDate}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                新版本
              </label>
              <select
                value={newVersionId}
                onChange={(e) => {
                  setNewVersionId(e.target.value);
                  setSemanticAnalysis(null);
                }}
                disabled={selectedPolicy.versions.length < 2}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
              >
                {selectedPolicy.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.versionNumber} · {v.effectiveDate}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenPublishVersion(selectedPolicy)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>发布新版本</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunSemantic()}
              disabled={
                loadingSemantic ||
                selectedPolicy.versions.length < 2 ||
                oldVersionId === newVersionId
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{loadingSemantic ? '正在解析...' : 'AI 总结变更与冲突影响'}</span>
            </button>
          </div>
        </div>

        {semanticError && (
          <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
            {semanticError}
          </div>
        )}
      </div>

      {selectedPolicy.versions.length < 2 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <GitCompareArrows className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-medium text-slate-900">
            《{selectedPolicy.title}》当前仅有 1 个版本
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            上传同名新版本文件或点击「发布新版本」后，即可在此对比版本逐行差异。
          </p>
          <button
            type="button"
            onClick={() => onOpenPublishVersion(selectedPolicy)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>发布新版本</span>
          </button>
        </div>
      ) : (
        <>
          {semanticAnalysis && (
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    AI 变更摘要与冲突影响
                  </h2>
                  <SeverityLabel severity={semanticAnalysis.impactLevel} />
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {diffData?.oldVersion.versionNumber} → {diffData?.newVersion.versionNumber}
                </span>
              </div>

              <p className="text-sm text-slate-700 leading-6">
                {semanticAnalysis.summary}
              </p>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                {semanticAnalysis.keyChanges.map((chg, idx) => (
                  <div key={idx} className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {chg.clause}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        {chg.changeType === 'added'
                          ? '新增'
                          : chg.changeType === 'removed'
                            ? '删除'
                            : '修改'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-5">
                      {chg.description}
                    </p>
                    <p className="text-xs text-amber-800">
                      影响：{chg.downstreamRisk}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {diffData && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-slate-900">
                    《{diffData.policyTitle}》
                  </span>
                  <span className="text-slate-400" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600">
                    {diffData.oldVersion.versionNumber} → {diffData.newVersion.versionNumber}
                  </span>
                  <span className="text-slate-400" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-emerald-700">
                    +{diffData.stats.addedCount} 新增
                  </span>
                  <span className="font-mono tabular-nums text-red-700">
                    -{diffData.stats.removedCount} 删除
                  </span>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-md">
                  <button
                    type="button"
                    onClick={() => setOnlyChanged(false)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      !onlyChanged
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    全部内容
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyChanged(true)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      onlyChanged
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    仅看变更行
                  </button>
                </div>
              </div>

              {loadingDiff ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  正在对比版本差异...
                </div>
              ) : (
                <div className="overflow-x-auto font-mono text-xs leading-6">
                  <table className="w-full border-collapse">
                    <tbody>
                      {displayedLines.map((line, idx) => {
                        const rowBg =
                          line.type === 'added'
                            ? 'bg-emerald-50/80 text-emerald-950'
                            : line.type === 'removed'
                              ? 'bg-red-50/80 text-red-950'
                              : 'bg-white text-slate-700';
                        const marker =
                          line.type === 'added'
                            ? '+'
                            : line.type === 'removed'
                              ? '-'
                              : ' ';
                        return (
                          <tr key={idx} className={`border-b border-slate-100 ${rowBg}`}>
                            <td className="w-12 px-2 py-0.5 text-right text-slate-400 select-none tabular-nums border-r border-slate-200/80">
                              {line.oldLineNumber ?? ''}
                            </td>
                            <td className="w-12 px-2 py-0.5 text-right text-slate-400 select-none tabular-nums border-r border-slate-200/80">
                              {line.newLineNumber ?? ''}
                            </td>
                            <td className="w-6 px-2 py-0.5 text-center select-none font-semibold">
                              {marker}
                            </td>
                            <td className="px-3 py-0.5 whitespace-pre-wrap break-words">
                              {line.text || '\u00A0'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
