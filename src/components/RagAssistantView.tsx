import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Network,
  Send,
  Trash2,
} from 'lucide-react';
import type { RagQueryResult } from '../types/policy';
import { safeParseJsonResponse } from '../utils/api';
import type { GraphHighlightState } from './KnowledgeGraphView';
import { SeverityLabel } from './SeverityLabel';

interface RagAssistantViewProps {
  policyCount: number;
  graphNodeCount: number;
  openConflictCount: number;
  pendingQuestion?: string | null;
  onConsumePendingQuestion?: () => void;
  onJumpToConflict: (conflictId?: string) => void;
  onJumpToPolicy: (policyId: string) => void;
  onInspectGraphSubgraph: (highlight: GraphHighlightState) => void;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  queryText?: string;
  result?: RagQueryResult;
  error?: string;
  retryQuery?: string;
}

const PRESET_QUESTIONS = [
  '连续病假 4 天需要提交什么级别的医院证明？',
  '出差报销 3800 元由谁审批？差旅细则和财务红线有冲突吗？',
  '研发中心员工每周五可以固定居家远程办公吗？',
  '远程办公期间处理线上故障算加班吗？',
];

export function RagAssistantView({
  policyCount,
  graphNodeCount,
  openConflictCount,
  pendingQuestion,
  onConsumePendingQuestion,
  onJumpToConflict,
  onJumpToPolicy,
  onInspectGraphSubgraph,
}: RagAssistantViewProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [expandedGraphs, setExpandedGraphs] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (pendingQuestion && pendingQuestion.trim() && !loading) {
      const q = pendingQuestion.trim();
      onConsumePendingQuestion?.();
      void sendQuestion(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

  const sendQuestion = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const historyPayload = messages
      .filter((m) => !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          history: historyPayload,
        }),
      });
      const data = await safeParseJsonResponse<RagQueryResult>(res);
      const assistantMsg: ChatTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        queryText: trimmed,
        result: data,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantErr: ChatTurn = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: '',
        error: err instanceof Error ? err.message : '检索回答失败，请稍后重试',
        retryQuery: trimmed,
      };
      setMessages((prev) => [...prev, assistantErr]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  const toggleCitations = (msgId: string) => {
    setExpandedCitations((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const toggleGraphPaths = (msgId: string) => {
    setExpandedGraphs((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div className="bg-white flex-1 min-h-0 flex flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 bg-slate-50/40">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-5 py-6">
            <div className="space-y-2">
              <MessageSquareText className="w-9 h-9 text-blue-700 mx-auto" />
              <h2 className="text-base font-semibold text-slate-900">
                向 AI 提问制度规范，支持多轮追问与冲突提示
              </h2>
              <p className="text-xs text-slate-500 leading-5 tabular-nums">
                基于 GraphRAG 已索引 {policyCount} 份制度与 {graphNodeCount} 个图谱实体；若存在 {openConflictCount} 项待处理冲突中的相关条款将主动对比警示。
              </p>
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
              {PRESET_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendQuestion(q)}
                  disabled={loading}
                  className="p-3 text-xs text-slate-700 bg-white hover:bg-blue-50/50 hover:border-blue-300 border border-slate-200 rounded-md transition-colors leading-5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] sm:max-w-xl bg-blue-700 text-white text-sm leading-6 px-4 py-2.5 rounded-lg">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.error) {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-2xl bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-xs flex items-start justify-between gap-4">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                      <div>
                        <div className="font-semibold">AI 问答请求失败</div>
                        <div className="mt-0.5 leading-5">{msg.error}</div>
                      </div>
                    </div>
                    {msg.retryQuery && (
                      <button
                        type="button"
                        onClick={() => void sendQuestion(msg.retryQuery!)}
                        disabled={loading}
                        className="px-3 py-1.5 text-xs font-medium text-red-800 bg-white border border-red-300 rounded-md hover:bg-red-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        重试提问
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const result = msg.result;
            const isExpanded = Boolean(expandedCitations[msg.id]);

            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  {result?.hasConflict && result.conflictWarnings.length > 0 && (
                    <div className="bg-red-50/70 border border-red-200 rounded-md p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>注意：相关制度条款存在冲突</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onJumpToConflict(result.conflictWarnings[0]?.conflictId)
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-red-800 hover:text-red-950 underline underline-offset-2 whitespace-nowrap"
                        >
                          <span>去冲突检测处理</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="divide-y divide-red-200/70">
                        {result.conflictWarnings.map((warn, idx) => (
                          <div key={idx} className="pt-2 first:pt-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <SeverityLabel severity={warn.severity} />
                              <span className="text-xs font-medium text-slate-900">
                                {warn.summary}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                              <div className="bg-white/80 border border-red-200/60 rounded px-2.5 py-1.5">
                                <span className="font-medium text-slate-900">条款 A：</span>
                                {warn.clauseA}
                              </div>
                              <div className="bg-white/80 border border-red-200/60 rounded px-2.5 py-1.5">
                                <span className="font-medium text-slate-900">条款 B：</span>
                                {warn.clauseB}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-sm leading-7 text-slate-800 whitespace-pre-line">
                    {msg.content}
                  </div>

                  {result?.graphContext && result.graphContext.reasoningPaths.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleGraphPaths(msg.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900"
                        >
                          <Network className="w-3.5 h-3.5" />
                          <span>
                            GraphRAG 推理路径 ({result.graphContext.reasoningPaths.length} 条)
                          </span>
                          {expandedGraphs[msg.id] ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onInspectGraphSubgraph({
                              label: msg.queryText ?? 'AI 问答检索',
                              nodeIds: result.graphContext!.subgraphNodeIds,
                              edgeIds: result.graphContext!.subgraphEdgeIds,
                            })
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                        >
                          <span>在知识图谱中定位</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {expandedGraphs[msg.id] && (
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2 text-xs">
                          {result.graphContext.matchedEntities.length > 0 && (
                            <div className="text-slate-600">
                              <span className="font-medium text-slate-800">命中核心实体：</span>
                              {result.graphContext.matchedEntities
                                .map((e) => e.label)
                                .join(' · ')}
                            </div>
                          )}
                          <ul className="space-y-1 text-slate-700 font-mono">
                            {result.graphContext.reasoningPaths.map((pathStr, pIdx) => (
                              <li key={pIdx} className="leading-5">
                                {pathStr}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {result && result.citations.length > 0 && (
                    <div className="pt-3 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => toggleCitations(msg.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        <span>引用制度原文 ({result.citations.length} 条)</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-2.5 divide-y divide-slate-200 border border-slate-200 rounded-md">
                          {result.citations.map((cit, idx) => (
                            <div key={idx} className="p-3 bg-slate-50/50 space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <button
                                  type="button"
                                  onClick={() => onJumpToPolicy(cit.policyId)}
                                  className="font-medium text-blue-700 hover:underline text-left"
                                >
                                  《{cit.policyTitle}》
                                </button>
                                <span className="text-slate-400" aria-hidden="true">·</span>
                                <span className="font-mono text-slate-600">{cit.versionNumber}</span>
                                <span className="text-slate-400" aria-hidden="true">·</span>
                                <span className="text-slate-700 font-medium">{cit.clauseRef}</span>
                              </div>
                              <p className="text-xs text-slate-600 leading-5 whitespace-pre-line">
                                {cit.excerpt}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-500">
              正在通过知识图谱多跳检索关联条款并校验冲突路径...
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3.5 bg-white border-t border-slate-200 flex items-center gap-2.5 shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入制度问题（例如：病假超过几天需要三甲医院证明？），支持连续追问..."
          className="flex-1 px-3.5 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0"
            title="清空对话"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">清空</span>
          </button>
        )}
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Send className="w-4 h-4" />
          <span>发送提问</span>
        </button>
      </form>
    </div>
  );
}
