import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  GitCompareArrows,
  ListTree,
  Maximize2,
  Network,
  Plus,
  Search,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import type { PolicyDocument, PolicyVersion } from '../types/policy';
import { formatEffectiveCycle } from '../utils/labels';

interface PolicyLibraryViewProps {
  policies: PolicyDocument[];
  selectedPolicyId: string | null;
  onSelectPolicy: (id: string) => void;
  onOpenNewPolicy: () => void;
  onOpenBatchUpload: () => void;
  onOpenPublishVersion: (policy: PolicyDocument) => void;
  onJumpToDiff: (policyId: string) => void;
  onJumpToGraph: (policyId: string) => void;
}

interface DocumentOutlineItem {
  id: string;
  label: string;
  level: 1 | 2 | 3;
  lineIndex: number;
}

function buildDocumentOutline(content: string): DocumentOutlineItem[] {
  const lines = content.split('\n');
  const items: DocumentOutlineItem[] = [];
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('# ')) {
      items.push({
        id: `doc-line-${idx}`,
        label: line.replace(/^#\s+/, ''),
        level: 1,
        lineIndex: idx,
      });
    } else if (line.startsWith('## ')) {
      items.push({
        id: `doc-line-${idx}`,
        label: line.replace(/^##\s+/, ''),
        level: 2,
        lineIndex: idx,
      });
    } else if (
      line.startsWith('### ') ||
      /^第[一二三四五六七八九十百千\d]+条(?:\s|$|：|:)/.test(line)
    ) {
      items.push({
        id: `doc-line-${idx}`,
        label: line.replace(/^###\s+/, ''),
        level: 3,
        lineIndex: idx,
      });
    }
  });
  return items;
}

function renderHighlightedLine(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQ, cursor);
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (idx > cursor) {
      parts.push({ text: text.slice(cursor, idx), hit: false });
    }
    parts.push({ text: text.slice(idx, idx + q.length), hit: true });
    cursor = idx + q.length;
  }
  return parts.map((p, i) =>
    p.hit ? (
      <mark key={i} className="bg-amber-200 text-slate-950 px-0.5 rounded-xs">
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    )
  );
}

function FormattedDocumentContent({
  content,
  searchQuery,
  idPrefix,
}: {
  content: string;
  searchQuery: string;
  idPrefix: string;
}) {
  const lines = useMemo(() => content.split('\n'), [content]);

  return (
    <div className="space-y-2.5 text-sm text-slate-700 leading-7">
      {lines.map((raw, idx) => {
        const line = raw.trimEnd();
        const trimmed = line.trim();
        const anchorId = `${idPrefix}-line-${idx}`;
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1
              key={idx}
              id={anchorId}
              className="text-base font-bold text-slate-950 pb-2 border-b border-slate-200 pt-1"
            >
              {renderHighlightedLine(trimmed.replace(/^#\s+/, ''), searchQuery)}
            </h1>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2
              key={idx}
              id={anchorId}
              className="text-sm font-semibold text-slate-900 pt-3 pb-1"
            >
              {renderHighlightedLine(trimmed.replace(/^##\s+/, ''), searchQuery)}
            </h2>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h3
              key={idx}
              id={anchorId}
              className="text-xs font-semibold text-slate-800 pt-2"
            >
              {renderHighlightedLine(trimmed.replace(/^###\s+/, ''), searchQuery)}
            </h3>
          );
        }
        if (/^第[一二三四五六七八九十百千\d]+条(?:\s|$|：|:)/.test(trimmed)) {
          return (
            <div
              key={idx}
              id={anchorId}
              className="text-xs font-semibold text-slate-900 pt-2"
            >
              {renderHighlightedLine(trimmed, searchQuery)}
            </div>
          );
        }
        return (
          <p key={idx} id={anchorId} className="text-xs text-slate-700 leading-6">
            {renderHighlightedLine(line, searchQuery)}
          </p>
        );
      })}
    </div>
  );
}

function RawDocumentContent({
  content,
  searchQuery,
  idPrefix,
}: {
  content: string;
  searchQuery: string;
  idPrefix: string;
}) {
  const lines = useMemo(() => content.split('\n'), [content]);

  return (
    <div className="font-mono text-xs leading-6 text-slate-800">
      {lines.map((line, idx) => (
        <div
          key={idx}
          id={`${idPrefix}-line-${idx}`}
          className="flex items-start gap-3 hover:bg-slate-50 px-2 rounded-xs"
        >
          <span className="w-8 shrink-0 text-right text-slate-400 select-none tabular-nums">
            {idx + 1}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-words">
            {line ? renderHighlightedLine(line, searchQuery) : '\u00a0'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PolicyLibraryView({
  policies,
  selectedPolicyId,
  onSelectPolicy,
  onOpenNewPolicy,
  onOpenBatchUpload,
  onOpenPublishVersion,
  onJumpToDiff,
  onJumpToGraph,
}: PolicyLibraryViewProps) {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'full' | 'chunks'>('full');
  const [fullFormat, setFullFormat] = useState<'formatted' | 'raw'>('formatted');
  const [docSearch, setDocSearch] = useState('');
  const [selectedVersionMap, setSelectedVersionMap] = useState<
    Record<string, string>
  >({});
  const [fullReaderOpen, setFullReaderOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return policies;
    const q = search.trim().toLowerCase();
    return policies.filter((p) => {
      const currentVer =
        p.versions.find((v) => v.id === p.currentVersionId) ??
        p.versions[p.versions.length - 1];
      return (
        p.title.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        (currentVer?.content.toLowerCase().includes(q) ?? false)
      );
    });
  }, [policies, search]);

  const activePolicy =
    filtered.find((p) => p.id === selectedPolicyId) ?? filtered[0] ?? null;

  const currentEffectiveVersion = activePolicy
    ? activePolicy.versions.find((v) => v.id === activePolicy.currentVersionId) ??
      activePolicy.versions[activePolicy.versions.length - 1]
    : null;

  const viewingVersion: PolicyVersion | null = useMemo(() => {
    if (!activePolicy) return null;
    const chosenId = selectedVersionMap[activePolicy.id];
    if (chosenId) {
      const matched = activePolicy.versions.find((v) => v.id === chosenId);
      if (matched) return matched;
    }
    return currentEffectiveVersion;
  }, [activePolicy, selectedVersionMap, currentEffectiveVersion]);

  const outlineItems = useMemo(
    () => (viewingVersion ? buildDocumentOutline(viewingVersion.content) : []),
    [viewingVersion]
  );

  const handleCopyFullText = async (ver: PolicyVersion) => {
    await navigator.clipboard.writeText(ver.content);
    setCopiedId(ver.id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const handleDownloadFile = (policy: PolicyDocument, ver: PolicyVersion) => {
    const blob = new Blob([ver.content], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${policy.title}_${ver.versionNumber}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scrollToModalLine = (lineIndex: number) => {
    const container = modalBodyRef.current;
    if (!container) return;
    const target = document.getElementById(`modal-doc-line-${lineIndex}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isViewingHistorical = Boolean(
    activePolicy &&
      viewingVersion &&
      currentEffectiveVersion &&
      viewingVersion.id !== currentEffectiveVersion.id
  );

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索制度名称、文件编号或正文关键词..."
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenNewPolicy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>手动录入</span>
          </button>
          <button
            type="button"
            onClick={onOpenBatchUpload}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>上传 / 批量导入文件</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-4">制度 / 文件名称</th>
                <th className="py-2.5 px-3 text-right">当前版本</th>
                <th className="py-2.5 px-4 text-right">条款</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filtered.map((p) => {
                const ver =
                  p.versions.find((v) => v.id === p.currentVersionId) ??
                  p.versions[p.versions.length - 1];
                const isSelected = activePolicy?.id === p.id;
                return (
                  <tr
                    key={p.id}
                    onClick={() => {
                      onSelectPolicy(p.id);
                      setDocSearch('');
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/75' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 text-sm">
                        {p.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                        <span className="font-mono">{p.code}</span>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        <span>{p.department}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <span className="font-mono font-medium text-slate-900">
                        {ver?.versionNumber}
                      </span>
                      <span className="text-slate-400 ml-1.5 tabular-nums">
                        ({p.versions.length}版)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {ver?.chunks.length ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {activePolicy && viewingVersion && (
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    《{activePolicy.title}》
                  </h2>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {activePolicy.code}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                  <span className="font-mono text-slate-800">
                    {isViewingHistorical ? '历史版本' : '当前版本'} {viewingVersion.versionNumber}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span>
                    开始生效时间：
                    <span className="font-mono text-slate-800">
                      {viewingVersion.effectiveDate || activePolicy.effectiveDate || '未指定'}
                    </span>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span>
                    生效周期：
                    <span
                      className={
                        (viewingVersion.effectiveCycle ?? activePolicy.effectiveCycle) === 'unclear'
                          ? 'text-amber-700 font-medium'
                          : 'text-slate-800'
                      }
                    >
                      {formatEffectiveCycle(
                        viewingVersion.effectiveCycle ?? activePolicy.effectiveCycle
                      )}
                    </span>
                  </span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span>
                    全文 {viewingVersion.content.length.toLocaleString()} 字
                  </span>
                  {activePolicy.nextReviewDate && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span>
                        下次复审：<span className="font-mono text-slate-700">{activePolicy.nextReviewDate}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setFullReaderOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>全屏查看完整文件</span>
                </button>
                {activePolicy.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() => onJumpToGraph(activePolicy.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>查看图谱</span>
                  </button>
                )}
                {activePolicy.versions.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => onJumpToDiff(activePolicy.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <GitCompareArrows className="w-3.5 h-3.5" />
                    <span>对比版本差异</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenPublishVersion(activePolicy)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>发布新版本</span>
                </button>
              </div>
            </div>

            {activePolicy.versions.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-700">
                    版本记录（点击切换查看对应版本完整文档）
                  </h3>
                  {isViewingHistorical && currentEffectiveVersion && (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedVersionMap((prev) => ({
                          ...prev,
                          [activePolicy.id]: currentEffectiveVersion.id,
                        }))
                      }
                      className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                    >
                      回到当前生效版 ({currentEffectiveVersion.versionNumber})
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-200 border-y border-slate-200">
                  {[...activePolicy.versions].reverse().map((v) => {
                    const isSelectedVersion = v.id === viewingVersion.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setSelectedVersionMap((prev) => ({
                            ...prev,
                            [activePolicy.id]: v.id,
                          }))
                        }
                        className={`w-full text-left py-2.5 px-2 text-xs flex items-center justify-between gap-3 transition-colors ${
                          isSelectedVersion
                            ? 'bg-blue-50/75'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-semibold text-slate-900">
                            {v.versionNumber}
                          </span>
                          {v.id === activePolicy.currentVersionId && (
                            <span className="text-emerald-700 font-medium ml-2">
                              当前生效
                            </span>
                          )}
                          {isSelectedVersion && (
                            <span className="text-blue-700 font-medium ml-2">
                              · 正在查看
                            </span>
                          )}
                          <span className="text-slate-600 ml-2.5">
                            {v.changeSummary}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-slate-400 shrink-0">
                          生效 {v.effectiveDate || '—'} ·{' '}
                          <span
                            className={
                              v.effectiveCycle === 'unclear'
                                ? 'text-amber-700 font-sans'
                                : 'font-sans'
                            }
                          >
                            {formatEffectiveCycle(v.effectiveCycle ?? activePolicy.effectiveCycle)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Complete Document & Clause Structure Viewer */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                    <button
                      type="button"
                      onClick={() => setViewMode('full')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        viewMode === 'full'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>完整制度文件</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('chunks')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap tabular-nums ${
                        viewMode === 'chunks'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <ListTree className="w-3.5 h-3.5" />
                      <span>条款拆解 ({viewingVersion.chunks.length} 条)</span>
                    </button>
                  </div>

                  {viewMode === 'full' && (
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                      <button
                        type="button"
                        onClick={() => setFullFormat('formatted')}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                          fullFormat === 'formatted'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        排版阅读
                      </button>
                      <button
                        type="button"
                        onClick={() => setFullFormat('raw')}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                          fullFormat === 'raw'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        原始文本
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {viewMode === 'full' && (
                    <div className="relative w-44 sm:w-52">
                      <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={docSearch}
                        onChange={(e) => setDocSearch(e.target.value)}
                        placeholder="文档内搜索..."
                        className="w-full pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCopyFullText(viewingVersion)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    {copiedId === viewingVersion.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        <span>已复制全文</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>复制全文</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(activePolicy, viewingVersion)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载文件</span>
                  </button>
                </div>
              </div>

              {viewMode === 'full' ? (
                <div className="border border-slate-200 rounded-md bg-slate-50/40 p-5 max-h-[600px] overflow-y-auto">
                  {fullFormat === 'formatted' ? (
                    <FormattedDocumentContent
                      content={viewingVersion.content}
                      searchQuery={docSearch}
                      idPrefix="inline-doc"
                    />
                  ) : (
                    <RawDocumentContent
                      content={viewingVersion.content}
                      searchQuery={docSearch}
                      idPrefix="inline-doc"
                    />
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border-t border-slate-200 max-h-[560px] overflow-y-auto">
                  {viewingVersion.chunks.map((chunk) => (
                    <div key={chunk.id} className="py-3.5 space-y-1">
                      <div className="text-xs font-semibold text-slate-800">
                        {chunk.heading}
                      </div>
                      <p className="text-xs text-slate-600 leading-6 whitespace-pre-line">
                        {chunk.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full-Screen Complete Policy Document Reader Modal */}
      {fullReaderOpen && activePolicy && viewingVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-policy-reader-title"
        >
          <div className="w-full max-w-6xl h-[90vh] max-h-[880px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
              <div className="min-w-0">
                <h2
                  id="full-policy-reader-title"
                  className="text-base font-semibold text-slate-900 truncate"
                >
                  完整制度文件 · 《{activePolicy.title}》
                </h2>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                  <span className="font-mono">{activePolicy.code}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activePolicy.department}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-800">
                    {viewingVersion.versionNumber}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    生效 {viewingVersion.effectiveDate || activePolicy.effectiveDate || '未指定'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {formatEffectiveCycle(
                      viewingVersion.effectiveCycle ?? activePolicy.effectiveCycle
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{viewingVersion.content.length.toLocaleString()} 字</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => setFullFormat('formatted')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      fullFormat === 'formatted'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    排版阅读
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullFormat('raw')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      fullFormat === 'raw'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    原始文本
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleCopyFullText(viewingVersion)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  {copiedId === viewingVersion.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制全文</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadFile(activePolicy, viewingVersion)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFullReaderOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
                  aria-label="关闭完整文件视图"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              {/* Left Outline & Version Switcher */}
              <div className="lg:col-span-4 bg-slate-50/75 border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-4 overflow-y-auto">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    placeholder="在当前文件中搜索关键词..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {activePolicy.versions.length > 1 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700">
                      切换版本 ({activePolicy.versions.length})
                    </div>
                    <div className="space-y-1">
                      {[...activePolicy.versions].reverse().map((v) => {
                        const active = v.id === viewingVersion.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              setSelectedVersionMap((prev) => ({
                                ...prev,
                                [activePolicy.id]: v.id,
                              }))
                            }
                            className={`w-full text-left px-2.5 py-2 rounded border text-xs transition-colors ${
                              active
                                ? 'bg-white border-blue-400 text-slate-900 font-medium'
                                : 'bg-transparent border-transparent hover:bg-white hover:border-slate-200 text-slate-600'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold">
                                {v.versionNumber}
                              </span>
                              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                                {v.effectiveDate}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {v.changeSummary}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    文件目录导航 ({outlineItems.length})
                  </div>
                  {outlineItems.length === 0 ? (
                    <div className="text-xs text-slate-400 py-2">
                      未检测到标题层级，可在右侧浏览全文。
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {outlineItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => scrollToModalLine(item.lineIndex)}
                          className={`w-full text-left py-1.5 px-2 rounded text-xs hover:bg-white hover:text-blue-700 transition-colors truncate ${
                            item.level === 1
                              ? 'font-semibold text-slate-900'
                              : item.level === 2
                                ? 'font-medium text-slate-800 pl-4'
                                : 'text-slate-600 pl-6'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Full Document Body */}
              <div
                ref={modalBodyRef}
                className="lg:col-span-8 p-6 sm:p-8 overflow-y-auto bg-white"
              >
                <div className="max-w-3xl mx-auto">
                  {fullFormat === 'formatted' ? (
                    <FormattedDocumentContent
                      content={viewingVersion.content}
                      searchQuery={docSearch}
                      idPrefix="modal-doc"
                    />
                  ) : (
                    <RawDocumentContent
                      content={viewingVersion.content}
                      searchQuery={docSearch}
                      idPrefix="modal-doc"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


