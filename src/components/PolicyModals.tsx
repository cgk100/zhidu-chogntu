import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  Crosshair,
  FileUp,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  EffectiveCycle,
  ParsedUploadFileItem,
  PolicyConflict,
  PolicyDocument,
} from '../types/policy';
import { safeParseJsonResponse } from '../utils/api';
import {
  findConflictLocateRange,
  getConflictPoints,
  splitHighlightedExcerpt,
} from '../utils/conflictHighlight';
import { CONFLICT_TYPE_LABELS, EFFECTIVE_CYCLE_OPTIONS } from '../utils/labels';
import { SeverityLabel } from './SeverityLabel';

interface NewPolicyModalProps {
  open: boolean;
  onClose: () => void;
  onSwitchToBatch: () => void;
  onCreated: (payload: {
    title: string;
    versionNumber: string;
    effectiveDate: string;
    effectiveCycle: EffectiveCycle;
    content: string;
    autoScan: boolean;
  }) => Promise<void>;
}

export function NewPolicyModal({
  open,
  onClose,
  onSwitchToBatch,
  onCreated,
}: NewPolicyModalProps) {
  const [title, setTitle] = useState('');
  const [versionNumber, setVersionNumber] = useState('v1.0');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [effectiveDateExtracted, setEffectiveDateExtracted] = useState(false);
  const [effectiveCycle, setEffectiveCycle] = useState<EffectiveCycle | ''>('');
  const [effectiveCycleExtracted, setEffectiveCycleExtracted] = useState(false);
  const [content, setContent] = useState('');
  const [autoScan, setAutoScan] = useState(true);
  const [parsingFile, setParsingFile] = useState(false);
  const [extractingMeta, setExtractingMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const runMetadataExtraction = async (text: string) => {
    if (!text.trim()) return;
    setExtractingMeta(true);
    try {
      const res = await fetch('/api/policies/extract-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await safeParseJsonResponse<{
        effectiveDate: string;
        effectiveDateExtracted: boolean;
        effectiveCycle: EffectiveCycle | '';
        effectiveCycleExtracted: boolean;
      }>(res);
      setEffectiveDate(data.effectiveDate || '');
      setEffectiveDateExtracted(Boolean(data.effectiveDateExtracted));
      setEffectiveCycle(data.effectiveCycle || '');
      setEffectiveCycleExtracted(Boolean(data.effectiveCycleExtracted));
    } catch {
      // Non-fatal; user can select manually
    } finally {
      setExtractingMeta(false);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    if (fileList.length > 1) {
      onClose();
      onSwitchToBatch();
      return;
    }

    const file = fileList[0];
    setParsingFile(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('files', file);
      const res = await fetch('/api/policies/parse-files', {
        method: 'POST',
        body: formData,
      });
      const data = await safeParseJsonResponse<{ files?: ParsedUploadFileItem[] }>(res);
      const first = data.files?.[0];
      if (!first) throw new Error('未能解析文件内容');
      if (first.parseError) throw new Error(first.parseError);

      setContent(first.content);
      if (!title.trim() && first.title) setTitle(first.title);
      if (first.versionNumber) setVersionNumber(first.versionNumber);
      setEffectiveDate(first.effectiveDate || '');
      setEffectiveDateExtracted(Boolean(first.effectiveDateExtracted));
      setEffectiveCycle(first.effectiveCycle || '');
      setEffectiveCycleExtracted(Boolean(first.effectiveCycleExtracted));
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败');
    } finally {
      setParsingFile(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('请填写制度名称与制度正文。');
      return;
    }
    if (!effectiveDate.trim()) {
      setError('请选择“开始生效时间”。');
      return;
    }
    if (!effectiveCycle) {
      setError('请选择“生效周期”（如周期未确定可选择“周期不明确”）。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreated({
        title,
        versionNumber,
        effectiveDate,
        effectiveCycle,
        content,
        autoScan,
      });
      setTitle('');
      setContent('');
      setEffectiveDate('');
      setEffectiveCycle('');
      setEffectiveDateExtracted(false);
      setEffectiveCycleExtracted(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存制度失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-policy-title"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <h2 id="new-policy-title" className="text-base font-semibold text-slate-900">
              手动录入制度文档
            </h2>
            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchToBatch();
              }}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              改为批量文件上传 →
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                制度名称 *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：员工差旅与住宿管理规定"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                版本号
              </label>
              <input
                type="text"
                value={versionNumber}
                onChange={(e) => setVersionNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium text-slate-700">
                  开始生效时间 *
                </label>
                {effectiveDateExtracted && effectiveDate ? (
                  <span className="text-[11px] text-emerald-700">已从正文提取</span>
                ) : !effectiveDate ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-amber-700">未提取到 · 请选择</span>
                    <button
                      type="button"
                      onClick={() =>
                        setEffectiveDate(new Date().toISOString().slice(0, 10))
                      }
                      className="text-[11px] text-blue-700 hover:underline"
                    >
                      设为今天
                    </button>
                  </div>
                ) : null}
              </div>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => {
                  setEffectiveDate(e.target.value);
                  setEffectiveDateExtracted(false);
                }}
                className={`w-full px-3 py-2 text-xs font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                  !effectiveDate
                    ? 'border-amber-400 bg-amber-50/40'
                    : 'border-slate-300 bg-white'
                }`}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium text-slate-700">
                  生效周期 *
                </label>
                {effectiveCycleExtracted && effectiveCycle ? (
                  <span
                    className={`text-[11px] ${
                      effectiveCycle === 'unclear' ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {effectiveCycle === 'unclear' ? '已识别：周期不明确' : '已从正文提取'}
                  </span>
                ) : !effectiveCycle ? (
                  <span className="text-[11px] text-amber-700">未提取到 · 请选择</span>
                ) : null}
              </div>
              <select
                value={effectiveCycle}
                onChange={(e) => {
                  setEffectiveCycle(e.target.value as EffectiveCycle | '');
                  setEffectiveCycleExtracted(false);
                }}
                className={`w-full px-3 py-2 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                  !effectiveCycle
                    ? 'border-amber-400 bg-amber-50/40 text-slate-600'
                    : 'border-slate-300 bg-white text-slate-900'
                }`}
                required
              >
                <option value="">请选择生效周期（含周期不明确）...</option>
                {EFFECTIVE_CYCLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">
                制度正文内容 *
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runMetadataExtraction(content)}
                  disabled={extractingMeta || !content.trim()}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-700 disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{extractingMeta ? '正在识别...' : '提取生效时间/周期'}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer">
                  <FileUp className="w-3.5 h-3.5" />
                  <span>
                    {parsingFile ? '正在解析文件...' : '导入文件 (.md / .txt / .docx / .pdf)'}
                  </span>
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,.docx,.pdf,.png,.jpg,.jpeg"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`# 制度标题\n\n第一条 ...\n\n附则：本制度自 2026 年 12 月 1 日起生效，有效期 1 年。`}
              className="w-full px-3 py-2 text-sm font-mono leading-6 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={(e) => setAutoScan(e.target.checked)}
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span>入库后自动检测与现行制度之间的内容冲突并生成提醒</span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {submitting ? '正在入库...' : '确认入库'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface RevisionDraftReference {
  conflictId?: string;
  conflictTitle: string;
  conflict?: PolicyConflict;
  editingSide?: 'A' | 'B';
  targetClauseRef?: string;
  conflictExcerpt?: string;
  recommendedPolicyToUpdate?: string;
  revisedClauseText?: string;
  rationale?: string;
}

interface PublishVersionModalProps {
  policy: PolicyDocument | null;
  revisionReference?: RevisionDraftReference | null;
  onClose: () => void;
  onPublished: (
    policyId: string,
    payload: {
      versionNumber: string;
      effectiveDate: string;
      effectiveCycle: EffectiveCycle;
      changeSummary: string;
      content: string;
      autoScan: boolean;
    }
  ) => Promise<void>;
}

export function PublishVersionModal({
  policy,
  revisionReference,
  onClose,
  onPublished,
}: PublishVersionModalProps) {
  const latestVersion =
    policy?.versions.find((v) => v.id === policy.currentVersionId) ??
    policy?.versions[policy.versions.length - 1];

  const [versionNumber, setVersionNumber] = useState(() => {
    if (!latestVersion) return 'v1.1';
    const match = latestVersion.versionNumber.match(/^v?(\d+)\.(\d+)$/i);
    if (match) return `v${match[1]}.${Number(match[2]) + 1}`;
    return `${latestVersion.versionNumber}.1`;
  });
  const [effectiveDate, setEffectiveDate] = useState('');
  const [effectiveDateExtracted, setEffectiveDateExtracted] = useState(false);
  const [effectiveCycle, setEffectiveCycle] = useState<EffectiveCycle | ''>(
    latestVersion?.effectiveCycle ?? policy?.effectiveCycle ?? ''
  );
  const [effectiveCycleExtracted, setEffectiveCycleExtracted] = useState(false);
  const [changeSummary, setChangeSummary] = useState(() =>
    revisionReference ? `人工修订（解决冲突：${revisionReference.conflictTitle}）` : ''
  );
  const [content, setContent] = useState(latestVersion?.content ?? '');
  const [autoScan, setAutoScan] = useState(true);
  const [parsingFile, setParsingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locateNotice, setLocateNotice] = useState<{
    matched: boolean;
    message: string;
  } | null>(null);
  const [activeLocateKey, setActiveLocateKey] = useState<string | null>(null);
  const [editorFlash, setEditorFlash] = useState(false);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const conflict = revisionReference?.conflict;
  const editingSide: 'A' | 'B' = useMemo(() => {
    if (revisionReference?.editingSide) return revisionReference.editingSide;
    if (conflict && policy) {
      if (conflict.policyBId === policy.id && conflict.policyAId !== policy.id) {
        return 'B';
      }
    }
    return 'A';
  }, [revisionReference, conflict, policy]);

  const conflictPoints = useMemo(
    () => (conflict ? getConflictPoints(conflict) : []),
    [conflict]
  );

  const currentSideMeta = useMemo(() => {
    if (!conflict) return null;
    const isA = editingSide === 'A';
    return {
      title: isA ? conflict.policyATitle : conflict.policyBTitle,
      version: isA ? conflict.policyAVersion : conflict.policyBVersion,
      clause: isA ? conflict.clauseA : conflict.clauseB,
      excerpt: isA ? conflict.excerptA : conflict.excerptB,
      segments: splitHighlightedExcerpt(
        isA ? conflict.excerptA : conflict.excerptB,
        conflictPoints,
        isA ? 'A' : 'B'
      ),
      counterpartTitle: isA ? conflict.policyBTitle : conflict.policyATitle,
      counterpartVersion: isA ? conflict.policyBVersion : conflict.policyAVersion,
      counterpartClause: isA ? conflict.clauseB : conflict.clauseA,
      counterpartExcerpt: isA ? conflict.excerptB : conflict.excerptA,
      counterpartSegments: splitHighlightedExcerpt(
        isA ? conflict.excerptB : conflict.excerptA,
        conflictPoints,
        isA ? 'B' : 'A'
      ),
    };
  }, [conflict, editingSide, conflictPoints]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  if (!policy) return null;

  const isSplitMode = Boolean(revisionReference);

  const scrollTextareaToOffset = (
    textarea: HTMLTextAreaElement,
    fullText: string,
    start: number,
    end: number
  ) => {
    const style = window.getComputedStyle(textarea);
    const mirror = document.createElement('div');
    const copiedProps = [
      'boxSizing',
      'width',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'letterSpacing',
      'lineHeight',
      'textTransform',
      'wordSpacing',
      'tabSize',
    ] as const;

    mirror.style.position = 'absolute';
    mirror.style.top = '-9999px';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.overflow = 'hidden';

    for (const prop of copiedProps) {
      mirror.style[prop] = style[prop];
    }

    mirror.appendChild(document.createTextNode(fullText.slice(0, start)));
    const anchor = document.createElement('span');
    anchor.textContent = fullText.slice(start, end) || '\u200b';
    mirror.appendChild(anchor);
    mirror.appendChild(document.createTextNode(fullText.slice(end)));

    document.body.appendChild(mirror);
    const targetScrollTop = Math.max(
      0,
      anchor.offsetTop - textarea.clientHeight * 0.35
    );
    document.body.removeChild(mirror);

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    textarea.scrollTop = targetScrollTop;
    window.requestAnimationFrame(() => {
      textarea.scrollTop = targetScrollTop;
    });
  };

  const jumpToConflictInEditor = (params: {
    key: string;
    label?: string;
    focusText?: string;
    dimension?: string;
    excerpt?: string;
    clauseRef?: string;
  }) => {
    const textarea = contentTextareaRef.current;
    if (!textarea) return;

    setActiveLocateKey(params.key);

    const located = findConflictLocateRange(content, {
      excerpt: params.excerpt,
      clauseRef: params.clauseRef,
      focusText: params.focusText,
      dimension: params.dimension,
    });

    if (located) {
      scrollTextareaToOffset(textarea, content, located.start, located.end);
      setEditorFlash(true);
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setEditorFlash(false);
      }, 900);

      const preview =
        located.matchedText.length > 26
          ? `${located.matchedText.slice(0, 26)}…`
          : located.matchedText;
      setLocateNotice({
        matched: true,
        message: params.label
          ? `已跳转至「${params.label}」对应原文（第 ${located.lineNumber} 行：“${preview}”），可直接编辑修改。`
          : `已跳转至正文第 ${located.lineNumber} 行对应位置，可直接编辑修改。`,
      });
    } else {
      textarea.focus();
      setLocateNotice({
        matched: false,
        message: '当前正文中暂未匹配到完全一致的原文片段（可能已被修改），请结合左侧条款编号人工调整。',
      });
    }
  };

  const handleVersionFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingFile(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('files', file);
      const res = await fetch('/api/policies/parse-files', {
        method: 'POST',
        body: formData,
      });
      const data = await safeParseJsonResponse<{ files?: ParsedUploadFileItem[] }>(res);
      const first = data.files?.[0];
      if (!first) throw new Error('未能解析文件内容');
      if (first.parseError) throw new Error(first.parseError);
      setContent(first.content);
      setEffectiveDate(first.effectiveDate || '');
      setEffectiveDateExtracted(Boolean(first.effectiveDateExtracted));
      setEffectiveCycle(first.effectiveCycle || '');
      setEffectiveCycleExtracted(Boolean(first.effectiveCycleExtracted));
      if (!changeSummary.trim()) {
        setChangeSummary(`从文件 ${first.fileName} 导入修订内容`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败');
    } finally {
      setParsingFile(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!versionNumber.trim() || !content.trim()) {
      setError('请填写新版本号和修订后的正文内容。');
      return;
    }
    if (!effectiveDate.trim()) {
      setError('请选择新版本的“开始生效时间”。');
      return;
    }
    if (!effectiveCycle) {
      setError('请选择新版本的“生效周期”（如周期未确定可选择“周期不明确”）。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onPublished(policy.id, {
        versionNumber,
        effectiveDate,
        effectiveCycle,
        changeSummary: changeSummary.trim() || '版本修订更新',
        content,
        autoScan,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布新版本失败');
    } finally {
      setSubmitting(false);
    }
  };

  const targetExcerpt =
    currentSideMeta?.excerpt ?? revisionReference?.conflictExcerpt ?? '';
  const targetClause =
    currentSideMeta?.clause ?? revisionReference?.targetClauseRef ?? '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-version-title"
    >
      <div
        className={`w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col ${
          isSplitMode ? 'max-w-6xl h-[90vh] max-h-[880px]' : 'max-w-2xl max-h-[90vh]'
        }`}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-slate-200 shrink-0 bg-white">
          <div className="min-w-0">
            <h2
              id="publish-version-title"
              className="text-base font-semibold text-slate-900 truncate"
            >
              {isSplitMode ? '人工修订制度' : '发布新版本'} · 《{policy.title}》
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              当前现行版本 {latestVersion?.versionNumber}
              {isSplitMode && (
                <>
                  <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                  <span>左侧对照矛盾点，右侧直接修订制度正文并发布新版本</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors shrink-0"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div
            className={`flex-1 min-h-0 ${
              isSplitMode
                ? 'grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden'
                : 'overflow-y-auto'
            }`}
          >
            {/* Left Pane: Highlighted Contradiction Points & Clause Context */}
            {isSplitMode && revisionReference && (
              <div className="lg:col-span-5 bg-slate-50/75 border-b lg:border-b-0 lg:border-r border-slate-200 p-5 space-y-4 lg:overflow-y-auto">
                <div className="space-y-2 pb-3.5 border-b border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      {conflict ? (
                        <>
                          <SeverityLabel severity={conflict.severity} />
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="text-slate-600 font-medium">
                            {CONFLICT_TYPE_LABELS[conflict.type]}
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>待解决冲突</span>
                        </span>
                      )}
                    </div>
                    {(targetExcerpt || targetClause) && (
                      <button
                        type="button"
                        onClick={() =>
                          jumpToConflictInEditor({
                            key: 'clause-main',
                            label: targetClause || '冲突条款',
                            excerpt: targetExcerpt,
                            clauseRef: targetClause,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>定位到右侧正文</span>
                      </button>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 leading-5">
                    {revisionReference.conflictTitle}
                  </h3>
                  {conflict?.description && (
                    <p className="text-xs text-slate-600 leading-5">
                      {conflict.description}
                    </p>
                  )}
                </div>

                {/* Extracted Contradiction Points (clickable to jump to corresponding text in editor) */}
                {conflictPoints.length > 0 && currentSideMeta && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        矛盾点标识（共 {conflictPoints.length} 处）
                      </span>
                      <span className="text-[11px] text-blue-700">
                        点击矛盾点自动跳转右侧原文
                      </span>
                    </div>
                    <div className="space-y-2">
                      {conflictPoints.map((pt, idx) => {
                        const myValue = editingSide === 'A' ? pt.valueA : pt.valueB;
                        const otherValue = editingSide === 'A' ? pt.valueB : pt.valueA;
                        const pointKey = `pt-${idx}`;
                        const isActivePoint = activeLocateKey === pointKey;
                        return (
                          <button
                            key={`modal-pt-${idx}`}
                            type="button"
                            onClick={() =>
                              jumpToConflictInEditor({
                                key: pointKey,
                                label: pt.dimension,
                                focusText: myValue,
                                dimension: pt.dimension,
                                excerpt: targetExcerpt,
                                clauseRef: targetClause,
                              })
                            }
                            className={`w-full text-left bg-white border rounded-md p-3 space-y-2 transition-colors cursor-pointer group ${
                              isActivePoint
                                ? 'border-blue-500 ring-1 ring-blue-500'
                                : 'border-slate-200 hover:border-blue-400'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900">
                                {pt.dimension}
                              </span>
                              <span
                                className={`inline-flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                                  isActivePoint
                                    ? 'text-blue-700'
                                    : 'text-slate-500 group-hover:text-blue-700'
                                }`}
                              >
                                <span>{isActivePoint ? '已定位原文' : '跳转原文'}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </span>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              <div className="px-2.5 py-1.5 rounded bg-rose-50/75 border border-rose-200 text-rose-950">
                                <div className="text-[11px] text-rose-700 font-medium mb-0.5">
                                  正在修改 · 《{currentSideMeta.title}》
                                </div>
                                <div className="font-semibold leading-5 tabular-nums">
                                  {myValue}
                                </div>
                              </div>
                              <div className="flex items-center justify-center text-[11px] text-red-600 font-medium gap-1">
                                <ArrowLeftRight className="w-3 h-3" />
                                <span>存在冲突</span>
                              </div>
                              <div className="px-2.5 py-1.5 rounded bg-amber-50/75 border border-amber-200 text-amber-950">
                                <div className="text-[11px] text-amber-800 font-medium mb-0.5">
                                  对立制度 · 《{currentSideMeta.counterpartTitle}》
                                </div>
                                <div className="font-semibold leading-5 tabular-nums">
                                  {otherValue}
                                </div>
                              </div>
                            </div>
                            {pt.impact && (
                              <div className="text-[11px] text-slate-600 leading-4 pt-1 border-t border-slate-100">
                                冲突后果：{pt.impact}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Highlighted Original Clauses */}
                {currentSideMeta ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        矛盾原条款标亮对照
                      </span>
                      <span className="text-[11px] text-slate-500">
                        点击标亮词句亦可精准跳转
                      </span>
                    </div>
                    <div
                      className={`bg-white border rounded-md p-3 space-y-1.5 transition-colors ${
                        activeLocateKey === 'clause-main'
                          ? 'border-blue-500 ring-1 ring-blue-500'
                          : 'border-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-rose-800 truncate">
                          待修改条款 · 《{currentSideMeta.title}》
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-slate-500 tabular-nums">
                            {currentSideMeta.version}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              jumpToConflictInEditor({
                                key: 'clause-main',
                                label: currentSideMeta.clause,
                                excerpt: currentSideMeta.excerpt,
                                clauseRef: currentSideMeta.clause,
                              })
                            }
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                          >
                            <span>跳转条款</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-medium text-slate-600">
                        {currentSideMeta.clause}
                      </div>
                      <p className="text-xs text-slate-700 leading-6 tabular-nums">
                        “
                        {currentSideMeta.segments.map((seg, i) =>
                          seg.highlighted ? (
                            <button
                              key={i}
                              type="button"
                              onClick={() =>
                                jumpToConflictInEditor({
                                  key: `seg-${i}`,
                                  label: seg.text,
                                  focusText: seg.text,
                                  excerpt: currentSideMeta.excerpt,
                                  clauseRef: currentSideMeta.clause,
                                })
                              }
                              title="点击跳转到右侧对应原文"
                              className="inline bg-rose-100 hover:bg-rose-200 text-rose-950 font-semibold px-1 rounded-xs border-b border-rose-400 cursor-pointer transition-colors"
                            >
                              {seg.text}
                            </button>
                          ) : (
                            <span key={i}>{seg.text}</span>
                          )
                        )}
                        ”
                      </p>
                    </div>

                    <div className="bg-white border border-amber-200 rounded-md p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-amber-800 truncate">
                          对立条款 · 《{currentSideMeta.counterpartTitle}》
                        </span>
                        <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                          {currentSideMeta.counterpartVersion}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-slate-600">
                        {currentSideMeta.counterpartClause}
                      </div>
                      <p className="text-xs text-slate-700 leading-6 tabular-nums">
                        “
                        {currentSideMeta.counterpartSegments.map((seg, i) =>
                          seg.highlighted ? (
                            <mark
                              key={i}
                              className="bg-amber-100 text-amber-950 font-semibold px-1 rounded-xs border-b border-amber-400"
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
                ) : (
                  revisionReference.conflictExcerpt && (
                    <button
                      type="button"
                      onClick={() =>
                        jumpToConflictInEditor({
                          key: 'clause-main',
                          label: revisionReference.targetClauseRef || '冲突条款',
                          excerpt: revisionReference.conflictExcerpt,
                          clauseRef: revisionReference.targetClauseRef,
                        })
                      }
                      className="w-full text-left bg-white border border-rose-200 hover:border-blue-400 rounded-md p-3 space-y-1.5 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-rose-900">
                        <span>待修订冲突条款（{revisionReference.targetClauseRef}）</span>
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-blue-700 font-medium">
                          <span>跳转原文</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-6">
                        “{revisionReference.conflictExcerpt}”
                      </p>
                    </button>
                  )
                )}

                {conflict?.suggestedResolution && (
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-xs font-semibold text-slate-800">解决建议</div>
                    <p className="text-xs text-slate-600 leading-5">
                      {conflict.suggestedResolution}
                    </p>
                  </div>
                )}

                {revisionReference.revisedClauseText && (
                  <div className="bg-blue-50/70 border border-blue-200 rounded-md p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-blue-950">
                        AI 辅助参考条款（仅作参考）
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setContent((prev) =>
                            prev.trim()
                              ? `${prev.trimEnd()}\n\n${revisionReference.revisedClauseText}`
                              : revisionReference.revisedClauseText ?? ''
                          )
                        }
                        className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                      >
                        插入到右侧正文末尾
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-slate-800 bg-white border border-blue-200/80 rounded p-2.5 whitespace-pre-wrap leading-5 max-h-36 overflow-y-auto">
                      {revisionReference.revisedClauseText}
                    </pre>
                    {revisionReference.rationale && (
                      <div className="text-[11px] text-slate-600 leading-5">
                        参考依据：{revisionReference.rationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Right Pane (or full body when plain version publish): Editable Policy Content & Metadata */}
            <div
              className={`p-5 sm:p-6 space-y-4 flex flex-col ${
                isSplitMode ? 'lg:col-span-7 lg:overflow-y-auto' : ''
              }`}
            >
              {error && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    新版本号 *
                  </label>
                  <input
                    type="text"
                    value={versionNumber}
                    onChange={(e) => setVersionNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    本次修改说明
                  </label>
                  <input
                    type="text"
                    value={changeSummary}
                    onChange={(e) => setChangeSummary(e.target.value)}
                    placeholder="简述本次修订的关键条款"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-xs font-medium text-slate-700">
                      开始生效时间 *
                    </label>
                    {effectiveDateExtracted && effectiveDate ? (
                      <span className="text-[11px] text-emerald-700">已从文档提取</span>
                    ) : !effectiveDate ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-amber-700">请选择</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEffectiveDate(new Date().toISOString().slice(0, 10))
                          }
                          className="text-[11px] text-blue-700 hover:underline"
                        >
                          设为今天
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => {
                      setEffectiveDate(e.target.value);
                      setEffectiveDateExtracted(false);
                    }}
                    className={`w-full px-3 py-2 text-xs font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                      !effectiveDate
                        ? 'border-amber-400 bg-amber-50/40'
                        : 'border-slate-300 bg-white'
                    }`}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-xs font-medium text-slate-700">
                      生效周期 *
                    </label>
                    {effectiveCycleExtracted && effectiveCycle ? (
                      <span
                        className={`text-[11px] ${
                          effectiveCycle === 'unclear' ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {effectiveCycle === 'unclear' ? '已识别：周期不明确' : '已从文档提取'}
                      </span>
                    ) : !effectiveCycle ? (
                      <span className="text-[11px] text-amber-700">未提取到 · 请选择</span>
                    ) : null}
                  </div>
                  <select
                    value={effectiveCycle}
                    onChange={(e) => {
                      setEffectiveCycle(e.target.value as EffectiveCycle | '');
                      setEffectiveCycleExtracted(false);
                    }}
                    className={`w-full px-3 py-2 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                      !effectiveCycle
                        ? 'border-amber-400 bg-amber-50/40 text-slate-600'
                        : 'border-slate-300 bg-white text-slate-900'
                    }`}
                    required
                  >
                    <option value="">请选择生效周期（含周期不明确）...</option>
                    {EFFECTIVE_CYCLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-[240px]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    制度正文编辑区（新版本内容） *
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer">
                    <FileUp className="w-3.5 h-3.5" />
                    <span>
                      {parsingFile ? '正在解析文件...' : '从文件导入 (.md / .txt / .docx / .pdf)'}
                    </span>
                    <input
                      type="file"
                      accept=".md,.markdown,.txt,.docx,.pdf,.png,.jpg,.jpeg"
                      onChange={handleVersionFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                {locateNotice && (
                  <div
                    className={`mb-1.5 px-2.5 py-1.5 text-[11px] rounded border ${
                      locateNotice.matched
                        ? 'text-blue-900 bg-blue-50 border-blue-200'
                        : 'text-amber-900 bg-amber-50 border-amber-200'
                    }`}
                  >
                    {locateNotice.message}
                  </div>
                )}
                <textarea
                  ref={contentTextareaRef}
                  rows={isSplitMode ? 15 : 9}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className={`w-full flex-1 min-h-[220px] px-3.5 py-2.5 text-sm font-mono leading-6 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y transition-all ${
                    editorFlash
                      ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50/20'
                      : 'border-slate-300 bg-white'
                  }`}
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={autoScan}
                  onChange={(e) => setAutoScan(e.target.checked)}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>发布后自动检测冲突并生成变更提醒</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50/60 shrink-0">
            <span className="text-[11px] text-slate-500">
              {isSplitMode
                ? '修订原则：矛盾点仅供人工审校参照，最终制度文本与版本发布由人工编辑确认。'
                : '发布新版本后，可在「版本对比」查看修订差异。'}
            </span>
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {submitting
                  ? '正在发布...'
                  : revisionReference
                    ? '人工确认并发布'
                    : '发布新版本'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
