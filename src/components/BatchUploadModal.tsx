import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  FileText,
  FileUp,
  GitFork,
  Loader2,
  ShieldAlert,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  BatchImportResponse,
  BatchImportStreamEvent,
  EffectiveCycle,
  ImportPipelineStage,
  ParsedUploadFileItem,
  ParseStreamStage,
  PolicyDocument,
  UploadParseStreamEvent,
} from '../types/policy';
import { consumeNdjsonStream } from '../utils/api';
import { EFFECTIVE_CYCLE_OPTIONS } from '../utils/labels';

interface BatchUploadModalProps {
  open: boolean;
  existingPolicies: PolicyDocument[];
  onClose: () => void;
  onSwitchToManual: () => void;
  onImported: (result: BatchImportResponse) => void;
  onJumpToConflicts?: () => void;
}

interface LiveParseEntry {
  fileName: string;
  fileSize: number;
  stage: 'queued' | ParseStreamStage;
  detail: string;
  charCount?: number;
  clauseHeadings?: string[];
  matchedTitle?: string;
  elapsedMs?: number;
}

interface StageState {
  stage: ImportPipelineStage;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'warning';
  detail: string;
  elapsedMs?: number;
  metrics?: BatchImportStreamEvent['metrics'];
}

interface StreamLogEntry {
  id: string;
  offsetSec: string;
  stage: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const INITIAL_STAGES: StageState[] = [
  {
    stage: 'ingest',
    label: '01. 条文切片与版本识别',
    status: 'pending',
    detail: '等待切分制度结构化条款与版本号归档',
  },
  {
    stage: 'embeddings',
    label: '02. 语义向量索引（gemini-embedding-2）',
    status: 'pending',
    detail: '等待为新增条款生成高维语义向量',
  },
  {
    stage: 'graph',
    label: '03. 知识图谱实体与关系抽取',
    status: 'pending',
    detail: '等待抽取制度、条款、审批角色与数值规则连线',
  },
  {
    stage: 'conflicts',
    label: '04. 全库条款冲突智能排查',
    status: 'pending',
    detail: '等待与全库现行制度交叉比对矛盾条款',
  },
];

const PARSE_STAGE_STEPS: Array<{ key: ParseStreamStage; label: string }> = [
  { key: 'reading', label: '读取字节' },
  { key: 'extracting', label: '正文抽取' },
  { key: 'chunking', label: '条款切片' },
  { key: 'parsed', label: '完成' },
];

function getParseStepIndex(stage: LiveParseEntry['stage']): number {
  if (stage === 'queued') return -1;
  if (stage === 'reading') return 0;
  if (stage === 'extracting') return 1;
  if (stage === 'chunking') return 2;
  return 3;
}

export function BatchUploadModal({
  open,
  existingPolicies,
  onClose,
  onSwitchToManual,
  onImported,
  onJumpToConflicts,
}: BatchUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseQueue, setParseQueue] = useState<LiveParseEntry[]>([]);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  const [importing, setImporting] = useState(false);
  const [importCompleted, setImportCompleted] = useState<BatchImportResponse | null>(
    null
  );
  const [pipelineStages, setPipelineStages] = useState<StageState[]>(INITIAL_STAGES);
  const [streamLogs, setStreamLogs] = useState<StreamLogEntry[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ParsedUploadFileItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoScan, setAutoScan] = useState(true);

  const inPipelineView = importing || importCompleted !== null;

  // Real-time wall-clock timer while either parsing or importing is actively running
  useEffect(() => {
    if (!parsing && !importing) return;
    const started = performance.now();
    setLiveElapsedMs(0);
    const timer = window.setInterval(() => {
      setLiveElapsedMs(Math.round(performance.now() - started));
    }, 80);
    return () => window.clearInterval(timer);
  }, [parsing, importing]);

  // Auto-scroll real-time event log when new real server events arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [streamLogs]);

  if (!open) return null;

  const resetAllPipelineState = () => {
    setImportCompleted(null);
    setImporting(false);
    setPipelineStages(INITIAL_STAGES);
    setStreamLogs([]);
    setParseQueue([]);
    setError(null);
  };

  const handleSafeClose = () => {
    if (importCompleted) {
      resetAllPipelineState();
    }
    onClose();
  };

  const uploadAndParseFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    if (items.length + files.length > 20) {
      setError('单批次最多支持同时上传 20 个文件。');
      return;
    }

    setParsing(true);
    setError(null);
    setImportCompleted(null);

    const initialEntries: LiveParseEntry[] = files.map((f) => ({
      fileName: f.name,
      fileSize: f.size,
      stage: 'queued',
      detail: `等待上传 (${formatBytes(f.size)})`,
    }));
    setParseQueue(initialEntries);

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const fileStart = performance.now();

        setParseQueue((prev) =>
          prev.map((entry, idx) =>
            idx === i
              ? {
                  ...entry,
                  stage: 'reading',
                  detail: `正在上传 ${formatBytes(f.size)} 至解析服务...`,
                }
              : entry
          )
        );

        const formData = new FormData();
        formData.append('files', f);

        const res = await fetch('/api/policies/parse-files-stream', {
          method: 'POST',
          body: formData,
        });

        await consumeNdjsonStream<UploadParseStreamEvent>(res, (evt) => {
          const clientElapsed = Math.round(performance.now() - fileStart);
          setParseQueue((prev) =>
            prev.map((entry, idx) =>
              idx === i
                ? {
                    ...entry,
                    stage: evt.stage,
                    detail: evt.detail,
                    charCount: evt.charCount ?? entry.charCount,
                    clauseHeadings: evt.clauseHeadings ?? entry.clauseHeadings,
                    matchedTitle: evt.matchedTitle ?? entry.matchedTitle,
                    elapsedMs: evt.elapsedMs ?? clientElapsed,
                  }
                : entry
            )
          );

          if (evt.file) {
            setItems((prev) => [...prev, evt.file!]);
          }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败');
    } finally {
      setParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void uploadAndParseFiles(e.target.files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadAndParseFiles(e.dataTransfer.files);
    }
  };

  const updateItem = (
    tempId: string,
    patch: Partial<ParsedUploadFileItem>
  ) => {
    setItems((prev) =>
      prev.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it))
    );
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((it) => it.tempId !== tempId));
  };

  const validItems = items.filter(
    (it) => !it.parseError && it.title.trim() && it.content.trim()
  );
  const missingMetadataItems = validItems.filter(
    (it) => !it.effectiveDate?.trim() || !it.effectiveCycle
  );
  const newPolicyCount = validItems.filter(
    (it) => it.mode === 'new_policy'
  ).length;
  const newVersionCount = validItems.filter(
    (it) => it.mode === 'new_version'
  ).length;

  const appendLog = (
    startedAt: number,
    stage: string,
    message: string,
    tone: StreamLogEntry['tone']
  ) => {
    const offsetSec = ((performance.now() - startedAt) / 1000).toFixed(2);
    setStreamLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        offsetSec: `+${offsetSec}s`,
        stage,
        message,
        tone,
      },
    ]);
  };

  const handleConfirmImport = async () => {
    if (validItems.length === 0) {
      setError('当前没有可入库的有效制度文件。');
      return;
    }
    if (missingMetadataItems.length > 0) {
      setError(
        `《${missingMetadataItems[0].title}》未提取到“开始生效时间”或“生效周期”，请先手动选择后再确认入库（如周期尚未确定可选择“周期不明确”）。`
      );
      return;
    }

    const pipelineStart = performance.now();
    setImporting(true);
    setImportCompleted(null);
    setError(null);
    setPipelineStages(
      INITIAL_STAGES.map((s) =>
        s.stage === 'conflicts' && !autoScan
          ? { ...s, status: 'skipped', detail: '已设置跳过入库后自动扫描' }
          : s
      )
    );
    setStreamLogs([
      {
        id: 'init',
        offsetSec: '+0.00s',
        stage: 'INIT',
        message: `启动入库流水线：待处理 ${validItems.length} 份制度（新制度 ${newPolicyCount} · 版本修订 ${newVersionCount}）`,
        tone: 'info',
      },
    ]);

    try {
      const res = await fetch('/api/policies/batch-import-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: validItems, autoScan }),
      });

      await consumeNdjsonStream<BatchImportStreamEvent>(res, (evt) => {
        if (evt.type === 'stage' && evt.stage && evt.status) {
          setPipelineStages((prev) =>
            prev.map((s) =>
              s.stage === evt.stage
                ? {
                    ...s,
                    status: evt.status!,
                    detail: evt.detail ?? s.detail,
                    elapsedMs: evt.elapsedMs ?? s.elapsedMs,
                    metrics: evt.metrics ?? s.metrics,
                  }
                : s
            )
          );

          if (evt.detail) {
            const stageCode =
              evt.stage === 'ingest'
                ? 'CHUNK'
                : evt.stage === 'embeddings'
                  ? 'EMBED'
                  : evt.stage === 'graph'
                    ? 'GRAPH'
                    : 'SCAN';
            const tone: StreamLogEntry['tone'] =
              evt.status === 'warning'
                ? 'warning'
                : evt.status === 'done'
                  ? 'success'
                  : 'info';
            appendLog(pipelineStart, stageCode, evt.detail, tone);
          }
        } else if (evt.type === 'complete' && evt.result) {
          appendLog(
            pipelineStart,
            'DONE',
            `全部数据处理完成：新增制度 ${evt.result.importedPoliciesCount} 份、版本更新 ${evt.result.updatedVersionsCount} 份、新增冲突 ${evt.result.addedConflicts} 项。`,
            evt.result.addedConflicts > 0 ? 'warning' : 'success'
          );
          setImportCompleted(evt.result);
          setItems([]);
          setParseQueue([]);
          onImported(evt.result);
        } else if (evt.type === 'error') {
          const msg = evt.error || '批量入库过程中发生错误';
          appendLog(pipelineStart, 'ERROR', msg, 'error');
          setError(msg);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '批量入库失败';
      appendLog(pipelineStart, 'ERROR', msg, 'error');
      setError(msg);
    } finally {
      setImporting(false);
    }
  };

  const completedStagesCount = pipelineStages.filter(
    (s) => s.status === 'done' || s.status === 'warning' || s.status === 'skipped'
  ).length;
  const overallPercent = Math.round(
    (completedStagesCount / pipelineStages.length) * 100
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-upload-title"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <h2
              id="batch-upload-title"
              className="text-base font-semibold text-slate-900"
            >
              {inPipelineView
                ? importCompleted
                  ? '文件入库与 GraphRAG 索引完成'
                  : '正在实时处理制度数据...'
                : '上传制度文件（支持单文件或批量）'}
            </h2>
            {!inPipelineView && (
              <button
                type="button"
                onClick={() => {
                  handleSafeClose();
                  onSwitchToManual();
                }}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                改为手动粘贴文本 →
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSafeClose}
            disabled={importing}
            className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-40 rounded-md transition-colors"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 shrink-0 text-red-700" />
              <span>{error}</span>
            </div>
          )}

          {inPipelineView ? (
            <div className="space-y-4">
              {/* Overall real-time pipeline header */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    {importing ? (
                      <Loader2 className="w-4 h-4 text-blue-700 animate-spin shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    )}
                    <span>
                      {importing
                        ? '实时数据流水线执行中'
                        : '全部结构化切片、向量、图谱与冲突排查已同步'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 font-mono tabular-nums text-slate-600">
                    <span>{overallPercent}%</span>
                    {importing && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span>已耗时 {formatMs(liveElapsedMs)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="relative h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      importCompleted ? 'bg-emerald-600' : 'bg-blue-700'
                    }`}
                    style={{ width: `${Math.max(8, overallPercent)}%` }}
                  />
                  {importing && (
                    <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-scan-sweep" />
                  )}
                </div>
              </div>

              {/* 4 real backend stages with live metrics */}
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
                {pipelineStages.map((s) => {
                  const StageIcon =
                    s.stage === 'ingest'
                      ? Database
                      : s.stage === 'embeddings'
                        ? Cpu
                        : s.stage === 'graph'
                          ? GitFork
                          : ShieldAlert;

                  return (
                    <div
                      key={s.stage}
                      className={`relative px-4 py-3.5 transition-colors ${
                        s.status === 'running' ? 'bg-blue-50/50' : 'bg-white'
                      }`}
                    >
                      {s.status === 'running' && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-100 overflow-hidden">
                          <div className="h-full w-1/3 bg-blue-600 animate-scan-sweep" />
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="mt-0.5 shrink-0">
                            {s.status === 'running' ? (
                              <Loader2 className="w-4 h-4 text-blue-700 animate-spin" />
                            ) : s.status === 'done' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : s.status === 'warning' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                            ) : (
                              <StageIcon className="w-4 h-4 text-slate-400" />
                            )}
                          </div>

                          <div className="min-w-0 space-y-1">
                            <div className="text-xs font-semibold text-slate-900">
                              {s.label}
                            </div>
                            <div className="text-xs text-slate-600 leading-5 tabular-nums">
                              {s.detail}
                            </div>

                            {/* Real clause headings extracted during ingest */}
                            {s.stage === 'ingest' &&
                              s.metrics?.clauseHeadings &&
                              s.metrics.clauseHeadings.length > 0 && (
                                <div className="text-[11px] text-slate-500 pt-0.5 truncate">
                                  已切分条款：{s.metrics.clauseHeadings.join(' · ')}
                                </div>
                              )}

                            {/* Real embedding progress bar */}
                            {s.stage === 'embeddings' &&
                              s.metrics?.totalEmbeddings !== undefined &&
                              s.metrics.totalEmbeddings > 0 && (
                                <div className="pt-1 flex items-center gap-2 max-w-sm">
                                  <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-700 transition-all duration-200"
                                      style={{
                                        width: `${Math.round(
                                          ((s.metrics.completedEmbeddings ?? 0) /
                                            s.metrics.totalEmbeddings) *
                                            100
                                        )}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-mono tabular-nums text-slate-500">
                                    {s.metrics.completedEmbeddings ?? 0}/
                                    {s.metrics.totalEmbeddings}
                                    {s.metrics.dimensions
                                      ? ` (${s.metrics.dimensions}维)`
                                      : ''}
                                  </span>
                                </div>
                              )}

                            {/* Real newly extracted graph entities */}
                            {s.stage === 'graph' &&
                              s.metrics?.sampleEntities &&
                              s.metrics.sampleEntities.length > 0 && (
                                <div className="text-[11px] text-indigo-800 pt-0.5 truncate">
                                  新增图谱节点：{s.metrics.sampleEntities.join(' · ')}
                                </div>
                              )}

                            {/* Real conflict titles detected */}
                            {s.stage === 'conflicts' &&
                              s.metrics?.conflictTitles &&
                              s.metrics.conflictTitles.length > 0 && (
                                <div className="text-[11px] text-red-700 font-medium pt-0.5">
                                  新识别冲突：{s.metrics.conflictTitles.join('；')}
                                </div>
                              )}
                          </div>
                        </div>

                        <div className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {s.status === 'running'
                            ? '处理中'
                            : s.elapsedMs !== undefined
                              ? formatMs(s.elapsedMs)
                              : s.status === 'skipped'
                                ? '已跳过'
                                : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Real-time NDJSON server event stream console */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">实时处理数据流</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {streamLogs.length} 条真实事件
                  </span>
                </div>
                <div
                  ref={logContainerRef}
                  className="bg-slate-950 text-slate-200 rounded-md p-3.5 max-h-40 overflow-y-auto space-y-1.5 font-mono text-[11px] leading-5"
                >
                  {streamLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span className="text-slate-500 shrink-0 tabular-nums">
                        {log.offsetSec}
                      </span>
                      <span
                        className={`shrink-0 font-semibold ${
                          log.tone === 'success'
                            ? 'text-emerald-400'
                            : log.tone === 'warning'
                              ? 'text-amber-400'
                              : log.tone === 'error'
                                ? 'text-red-400'
                                : 'text-blue-400'
                        }`}
                      >
                        [{log.stage}]
                      </span>
                      <span className="text-slate-200 break-all">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => !parsing && fileInputRef.current?.click()}
                className={`relative overflow-hidden border-2 border-dashed rounded-lg p-7 text-center transition-colors ${
                  parsing
                    ? 'border-blue-400 bg-blue-50/40 cursor-wait'
                    : dragging
                      ? 'border-blue-600 bg-blue-50/70 cursor-pointer'
                      : 'border-slate-300 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-400 cursor-pointer'
                }`}
              >
                {parsing && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-blue-100 overflow-hidden">
                    <div className="h-full w-1/3 bg-blue-600 animate-scan-sweep" />
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.txt,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {parsing ? (
                  <Loader2 className="w-8 h-8 text-blue-700 mx-auto mb-2 animate-spin" />
                ) : (
                  <UploadCloud className="w-8 h-8 text-blue-700 mx-auto mb-2" />
                )}
                <div className="text-sm font-medium text-slate-900">
                  {parsing
                    ? `正在实时抽取与切分制度条款...（已用时 ${formatMs(liveElapsedMs)}）`
                    : '将 1 个或多个制度文件拖拽至此，或点击选择文件'}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  支持 .md / .txt / .docx / .pdf / .png / .jpg · 同名文件将自动识别为版本更新
                </p>
              </div>

              {/* Real-time live parse telemetry queue */}
              {parseQueue.length > 0 && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
                    <span className="font-medium">
                      实时解析进度（{parseQueue.filter((q) => q.stage === 'parsed').length} /{' '}
                      {parseQueue.length}）
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      真实流式回传
                    </span>
                  </div>
                  {parseQueue.map((entry, idx) => {
                    const stepIdx = getParseStepIndex(entry.stage);
                    const isActive =
                      entry.stage === 'reading' ||
                      entry.stage === 'extracting' ||
                      entry.stage === 'chunking';
                    return (
                      <div
                        key={`${entry.fileName}-${idx}`}
                        className={`relative px-4 py-3 space-y-2 ${
                          isActive ? 'bg-blue-50/40' : 'bg-white'
                        }`}
                      >
                        {isActive && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-100 overflow-hidden">
                            <div className="h-full w-1/3 bg-blue-600 animate-scan-sweep" />
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {isActive ? (
                              <Loader2 className="w-3.5 h-3.5 text-blue-700 animate-spin shrink-0" />
                            ) : entry.stage === 'parsed' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : entry.stage === 'error' ? (
                              <AlertOctagon className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span className="text-xs font-medium text-slate-900 truncate">
                              {entry.fileName}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                              {formatBytes(entry.fileSize)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] shrink-0">
                            {PARSE_STAGE_STEPS.map((st, sIdx) => (
                              <span
                                key={st.key}
                                className={
                                  sIdx < stepIdx || entry.stage === 'parsed'
                                    ? 'text-emerald-700 font-medium'
                                    : sIdx === stepIdx
                                      ? 'text-blue-700 font-semibold'
                                      : 'text-slate-300'
                                }
                              >
                                {st.label}
                              </span>
                            ))}
                            {entry.elapsedMs !== undefined && (
                              <span className="font-mono text-slate-400 tabular-nums ml-1">
                                {formatMs(entry.elapsedMs)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 tabular-nums">
                          {entry.detail}
                        </div>

                        {entry.clauseHeadings && entry.clauseHeadings.length > 0 && (
                          <div className="text-[11px] text-slate-500 truncate">
                            提取条款：{entry.clauseHeadings.join(' · ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {items.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      已解析 {items.length} 份文件（可核对元数据后确认入库）
                    </span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={parsing}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>继续添加</span>
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                    {items.map((item) => {
                      const isExpanded = expandedId === item.tempId;
                      return (
                        <div key={item.tempId} className="p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="text-xs font-medium text-slate-900 truncate">
                                {item.fileName}
                              </span>
                              <span className="text-xs text-slate-400 font-mono tabular-nums shrink-0">
                                {formatBytes(item.fileSize)}
                              </span>
                              {!item.parseError && (
                                <span className="text-xs text-emerald-700 shrink-0 tabular-nums">
                                  · {item.content.length.toLocaleString()} 字 · {item.chunkCount} 条款
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {!item.parseError && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedId(isExpanded ? null : item.tempId)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded"
                                >
                                  <span>{isExpanded ? '收起正文' : '查看正文'}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeItem(item.tempId)}
                                className="p-1.5 text-slate-400 hover:text-red-700 rounded transition-colors"
                                aria-label={`移除 ${item.fileName}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {item.parseError ? (
                            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                              解析失败：{item.parseError}
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                <div className="sm:col-span-5">
                                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                    制度名称
                                  </label>
                                  <input
                                    type="text"
                                    value={item.title}
                                    onChange={(e) =>
                                      updateItem(item.tempId, { title: e.target.value })
                                    }
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                                  />
                                </div>

                                <div className="sm:col-span-5">
                                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                    入库方式
                                  </label>
                                  <select
                                    value={
                                      item.mode === 'new_version' &&
                                      item.matchedExistingPolicyId
                                        ? `ver:${item.matchedExistingPolicyId}`
                                        : 'new_policy'
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'new_policy') {
                                        updateItem(item.tempId, {
                                          mode: 'new_policy',
                                          matchedExistingPolicyId: undefined,
                                        });
                                      } else if (val.startsWith('ver:')) {
                                        const pid = val.slice(4);
                                        const pol = existingPolicies.find(
                                          (p) => p.id === pid
                                        );
                                        updateItem(item.tempId, {
                                          mode: 'new_version',
                                          matchedExistingPolicyId: pid,
                                          matchedExistingPolicyTitle: pol?.title,
                                          title: pol?.title ?? item.title,
                                        });
                                      }
                                    }}
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                                  >
                                    <option value="new_policy">作为新制度入库</option>
                                    {existingPolicies.map((pol) => (
                                      <option key={pol.id} value={`ver:${pol.id}`}>
                                        更新《{pol.title}》为新版本
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="sm:col-span-2">
                                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                    版本号
                                  </label>
                                  <input
                                    type="text"
                                    value={item.versionNumber}
                                    onChange={(e) =>
                                      updateItem(item.tempId, {
                                        versionNumber: e.target.value,
                                      })
                                    }
                                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className="text-[11px] font-medium text-slate-600">
                                      开始生效时间 *
                                    </label>
                                    {item.effectiveDateExtracted && item.effectiveDate ? (
                                      <span
                                        className="text-[11px] text-emerald-700 truncate"
                                        title={item.effectiveDateSource}
                                      >
                                        已提取{item.effectiveDateSource ? `（${item.effectiveDateSource}）` : ''}
                                      </span>
                                    ) : !item.effectiveDate ? (
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[11px] text-amber-700 font-medium">
                                          未提取到 · 请选择
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateItem(item.tempId, {
                                              effectiveDate: new Date().toISOString().slice(0, 10),
                                            })
                                          }
                                          className="text-[11px] text-blue-700 hover:underline"
                                        >
                                          设为今天
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[11px] text-slate-500">
                                        已手动选择
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    type="date"
                                    value={item.effectiveDate}
                                    onChange={(e) =>
                                      updateItem(item.tempId, {
                                        effectiveDate: e.target.value,
                                      })
                                    }
                                    className={`w-full px-2.5 py-1.5 text-xs font-mono border rounded focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                                      !item.effectiveDate
                                        ? 'border-amber-400 bg-amber-50/40'
                                        : 'border-slate-300 bg-white'
                                    }`}
                                  />
                                </div>

                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className="text-[11px] font-medium text-slate-600">
                                      生效周期 *
                                    </label>
                                    {item.effectiveCycleExtracted && item.effectiveCycle ? (
                                      <span
                                        className={`text-[11px] truncate ${
                                          item.effectiveCycle === 'unclear'
                                            ? 'text-amber-700 font-medium'
                                            : 'text-emerald-700'
                                        }`}
                                        title={item.effectiveCycleSource}
                                      >
                                        {item.effectiveCycle === 'unclear'
                                          ? '已识别：周期不明确'
                                          : '已从正文提取'}
                                      </span>
                                    ) : !item.effectiveCycle ? (
                                      <span className="text-[11px] text-amber-700 font-medium">
                                        未提取到 · 请选择
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-500">
                                        {item.effectiveCycle === 'unclear'
                                          ? '已标注为周期不明确'
                                          : '已手动选择'}
                                      </span>
                                    )}
                                  </div>
                                  <select
                                    value={item.effectiveCycle}
                                    onChange={(e) =>
                                      updateItem(item.tempId, {
                                        effectiveCycle: e.target.value as EffectiveCycle | '',
                                      })
                                    }
                                    className={`w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                                      !item.effectiveCycle
                                        ? 'border-amber-400 bg-amber-50/40 text-slate-600'
                                        : 'border-slate-300 bg-white text-slate-900'
                                    }`}
                                  >
                                    <option value="">请选择生效周期（支持周期不明确）...</option>
                                    {EFFECTIVE_CYCLE_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {isExpanded && (
                                <textarea
                                  rows={6}
                                  value={item.content}
                                  onChange={(e) =>
                                    updateItem(item.tempId, { content: e.target.value })
                                  }
                                  className="w-full px-3 py-2 text-xs font-mono leading-5 border border-slate-300 rounded bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {items.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoScan}
                    onChange={(e) => setAutoScan(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>入库后自动检测制度内容冲突并发送提醒</span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {importCompleted ? (
            <>
              <div className="text-xs text-slate-700 tabular-nums">
                已完成：新制度 {importCompleted.importedPoliciesCount} 份 · 版本更新{' '}
                {importCompleted.updatedVersionsCount} 份 · 新增冲突{' '}
                <span
                  className={
                    importCompleted.addedConflicts > 0
                      ? 'font-semibold text-red-700'
                      : 'font-semibold text-emerald-700'
                  }
                >
                  {importCompleted.addedConflicts}
                </span>{' '}
                项
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={resetAllPipelineState}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  继续上传
                </button>
                {importCompleted.addedConflicts > 0 && onJumpToConflicts && (
                  <button
                    type="button"
                    onClick={() => {
                      resetAllPipelineState();
                      onClose();
                      onJumpToConflicts();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 transition-colors whitespace-nowrap"
                  >
                    <span>查看新增冲突 ({importCompleted.addedConflicts})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  完成并查看制度库
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-600 tabular-nums">
                {importing
                  ? '正在执行实时向量索引、图谱抽取与冲突扫描，请勿关闭窗口...'
                  : missingMetadataItems.length > 0
                    ? `尚有 ${missingMetadataItems.length} 份文件缺少“开始生效时间”或“生效周期”，请先选择`
                    : validItems.length > 0
                      ? `共 ${validItems.length} 份待入库（新制度 ${newPolicyCount} · 版本更新 ${newVersionCount}）`
                      : '请选择要上传的文件'}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSafeClose}
                  disabled={importing}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmImport()}
                  disabled={
                    importing ||
                    parsing ||
                    validItems.length === 0 ||
                    missingMetadataItems.length > 0
                  }
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {importing
                    ? '正在实时入库处理...'
                    : `确认入库 (${validItems.length})`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
