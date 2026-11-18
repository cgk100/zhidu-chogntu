import {
  GoogleGenAI,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Schema,
} from '@google/genai';
import {
  buildPolicyKnowledgeGraph,
  mergeAiGraphEnrichment,
  retrieveGraphRagSubgraph,
  type AiGraphEnrichmentPayload,
} from './graphService.ts';
import { getBuiltInGeminiKey, getLlmSettingsRaw } from './settingsStore.ts';
import { getProviderPreset } from '../src/utils/llmProviders.ts';
import type {
  LlmProviderId,
  LlmSettingsInput,
  LlmTestResult,
  PolicyChunk,
  PolicyConflict,
  PolicyDocument,
  PolicyKnowledgeGraph,
  RagCitation,
  RagQueryResult,
  SemanticDiffAnalysis,
} from '../src/types/policy.ts';

interface ResolvedLlmConfig {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function resolveActiveLlmConfig(
  override?: Partial<LlmSettingsInput>
): ResolvedLlmConfig {
  const saved = getLlmSettingsRaw();
  const provider: LlmProviderId = override?.provider ?? saved.provider;
  const preset = getProviderPreset(provider);

  const rawModel =
    override?.model !== undefined ? override.model : saved.model;
  const model = rawModel.trim() || preset.defaultModel;

  const rawBaseUrl =
    override?.baseUrl !== undefined ? override.baseUrl : saved.baseUrl;
  const baseUrl =
    rawBaseUrl.trim().replace(/\/+$/, '') ||
    (provider === 'gemini' ? '' : preset.defaultBaseUrl);

  let apiKey = '';
  if (override?.clearApiKey) {
    apiKey = '';
  } else if (typeof override?.apiKey === 'string' && override.apiKey.trim()) {
    apiKey = override.apiKey.trim();
  } else if (provider === saved.provider && saved.apiKey) {
    apiKey = saved.apiKey;
  }

  if (provider === 'gemini' && !apiKey) {
    apiKey = getBuiltInGeminiKey();
  }

  if (!model) {
    throw new Error('请先在“模型设置”中填写或选择模型名称（Model ID）。');
  }
  if (provider !== 'gemini' && !baseUrl) {
    throw new Error(`请先在“模型设置”中填写 ${preset.name} 的 Base URL。`);
  }
  if (!apiKey) {
    throw new Error(
      provider === 'gemini'
        ? 'GEMINI_API_KEY 未配置，请在“模型设置”中填写 API Key 或在系统 Secrets 中配置。'
        : `当前模型 (${preset.name}) 尚未配置 API Key，请先在“模型设置”中填写。`
    );
  }

  return { provider, model, baseUrl, apiKey };
}

function createGeminiClient(apiKey: string, baseUrl?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(baseUrl ? { baseUrl } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGeminiEmbeddingClient(): GoogleGenAI | null {
  const saved = getLlmSettingsRaw();
  if (saved.provider === 'gemini') {
    const key = saved.apiKey.trim() || getBuiltInGeminiKey();
    if (!key) return null;
    return createGeminiClient(key, saved.baseUrl.trim() || undefined);
  }
  const builtInKey = getBuiltInGeminiKey();
  if (!builtInKey) return null;
  return createGeminiClient(builtInKey);
}

function isTransientHighDemandError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

function formatProviderError(err: unknown, provider: LlmProviderId): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const preset = getProviderPreset(provider);

  if (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand')
  ) {
    return new Error(
      `${preset.shortName} 模型服务当前处于高峰并发期（503 临时繁忙），请稍候几秒后重试。`
    );
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return new Error(
      `${preset.shortName} 接口请求频率或配额暂时受限（429），请稍候再试或检查 API Key 配额。`
    );
  }
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('invalid_api_key') ||
    msg.includes('Authentication')
  ) {
    return new Error(
      `${preset.shortName} API Key 无效或权限不足，请前往“模型设置”检查并更新您的 Key。`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function generateGeminiContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, 'model'>,
  primaryModel = 'gemini-4-hydrogen',
  allowFallback = true
): Promise<GenerateContentResponse> {
  const modelsToTry =
    allowFallback && primaryModel === 'gemini-4-hydrogen'
      ? [primaryModel, 'gemini-3.1-flash-lite']
      : [primaryModel];
  const delaysMs = [600];
  let lastError: unknown;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      try {
        return await ai.models.generateContent({
          ...params,
          model,
        });
      } catch (err) {
        lastError = err;
        if (!isTransientHighDemandError(err)) {
          throw formatProviderError(err, 'gemini');
        }
        if (attempt < delaysMs.length) {
          const jitter = Math.floor(Math.random() * 250);
          await new Promise((resolve) =>
            setTimeout(resolve, delaysMs[attempt] + jitter)
          );
        }
      }
    }
  }

  throw formatProviderError(lastError, 'gemini');
}

function extractJsonText(raw: string): string {
  let trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) {
    trimmed = fenceMatch[1].trim();
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function extractOpenAiMessageText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

async function callOpenAiCompatibleJson<T>(params: {
  config: ResolvedLlmConfig;
  systemInstruction: string;
  userPrompt: string;
  schemaHint: string;
  timeoutMs?: number;
}): Promise<T> {
  const { config, systemInstruction, userPrompt, schemaHint, timeoutMs = 90000 } =
    params;

  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`;

  const fullSystemPrompt = `${systemInstruction}\n\n【严格输出格式要求】\n你必须且仅输出合法的 JSON 对象，不要包含任何 Markdown 代码块标记（如 \`\`\`json）、前缀解释或后缀说明。必须严格包含以下 JSON 结构与字段：\n${schemaHint}`;

  const supportsJsonObjectMode =
    !config.model.startsWith('o1') &&
    !config.model.startsWith('o3') &&
    config.model !== 'deepseek-reasoner';

  const sendRequest = async (useResponseFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.model.startsWith('o1') || config.model.startsWith('o3') ? 1 : 0.2,
    };
    if (useResponseFormat) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rawBody = await res.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = null;
    }

    if (!res.ok) {
      const apiErrMsg =
        parsedBody &&
        typeof parsedBody === 'object' &&
        'error' in parsedBody &&
        typeof (parsedBody as { error?: { message?: unknown } }).error?.message ===
          'string'
          ? (parsedBody as { error: { message: string } }).error.message
          : rawBody.slice(0, 240) || `HTTP ${res.status}`;
      const err = new Error(`HTTP ${res.status}: ${apiErrMsg}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    return parsedBody;
  };

  let responsePayload: unknown;
  try {
    responsePayload = await sendRequest(supportsJsonObjectMode);
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status?: number }).status
        : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    if (
      supportsJsonObjectMode &&
      status === 400 &&
      msg.toLowerCase().includes('response_format')
    ) {
      responsePayload = await sendRequest(false);
    } else {
      throw formatProviderError(err, config.provider);
    }
  }

  const text = extractOpenAiMessageText(responsePayload);
  if (!text.trim()) {
    throw new Error('模型返回内容为空，请检查模型名称与 Base URL 是否正确。');
  }

  const jsonStr = extractJsonText(text);
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(
      `模型返回的 JSON 格式解析失败，请更换支持结构化输出的模型重试。原始片段：${text.slice(0, 140)}`
    );
  }
}

async function generateStructuredJson<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Schema;
  schemaHint: string;
  override?: Partial<LlmSettingsInput>;
  timeoutMs?: number;
}): Promise<T> {
  const config = resolveActiveLlmConfig(params.override);

  if (config.provider === 'gemini') {
    const ai = createGeminiClient(config.apiKey, config.baseUrl || undefined);
    const response = await generateGeminiContentWithRetry(
      ai,
      {
        contents: params.userPrompt,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      },
      config.model,
      !params.override
    );
    const rawJson = extractJsonText(response.text ?? '{}');
    return JSON.parse(rawJson || '{}') as T;
  }

  return callOpenAiCompatibleJson<T>({
    config,
    systemInstruction: params.systemInstruction,
    userPrompt: params.userPrompt,
    schemaHint: params.schemaHint,
    timeoutMs: params.timeoutMs,
  });
}

export async function testLlmConnection(
  override?: Partial<LlmSettingsInput>
): Promise<LlmTestResult> {
  const startedAt = Date.now();
  const saved = getLlmSettingsRaw();
  const targetProvider = override?.provider ?? saved.provider;
  const preset = getProviderPreset(targetProvider);
  const targetModel =
    (override?.model !== undefined ? override.model : saved.model).trim() ||
    preset.defaultModel;
  const targetBaseUrl =
    (override?.baseUrl !== undefined ? override.baseUrl : saved.baseUrl)
      .trim()
      .replace(/\/+$/, '') ||
    (targetProvider === 'gemini' ? '' : preset.defaultBaseUrl);

  try {
    const res = await generateStructuredJson<{ status?: string; reply?: string }>({
      systemInstruction:
        '你是系统连通性测试助手。请简短返回 JSON 响应，确认模型接口工作正常。',
      userPrompt: '请严格返回 JSON：{"status":"ok","reply":"连接成功"}',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          reply: { type: Type.STRING },
        },
        required: ['status', 'reply'],
      },
      schemaHint: '{"status": "ok", "reply": "连接成功"}',
      override,
      timeoutMs: 25000,
    });

    return {
      ok: true,
      provider: targetProvider,
      model: targetModel,
      baseUrl: targetBaseUrl,
      latencyMs: Date.now() - startedAt,
      replyPreview: res.reply || res.status || '连接成功',
    };
  } catch (err) {
    return {
      ok: false,
      provider: targetProvider,
      model: targetModel,
      baseUrl: targetBaseUrl,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalScore(query: string, text: string): number {
  const cleanQuery = query.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  const cleanText = text.toLowerCase();
  if (!cleanQuery) return 0;

  let hits = 0;
  for (let i = 0; i < cleanQuery.length; i++) {
    const ch = cleanQuery[i];
    if (cleanText.includes(ch)) hits += 0.3;
    if (i < cleanQuery.length - 1) {
      const bigram = cleanQuery.slice(i, i + 2);
      if (cleanText.includes(bigram)) hits += 1.2;
    }
  }
  return hits / Math.max(4, cleanQuery.length);
}

/**
 * Generates embeddings for policy chunks via gemini-embedding-2 when a Gemini key is available,
 * and caches them in place. Returns false when embeddings are skipped cleanly.
 */
export async function ensureChunkEmbeddings(
  chunks: PolicyChunk[],
  onProgress?: (completed: number, total: number, dimensions?: number) => void
): Promise<boolean> {
  const missing = chunks.filter((c) => !c.embedding || c.embedding.length === 0);
  if (missing.length === 0) {
    onProgress?.(chunks.length, chunks.length, chunks[0]?.embedding?.length);
    return true;
  }

  const ai = getGeminiEmbeddingClient();
  if (!ai) {
    return false;
  }

  const batchSize = 16;
  let completed = 0;
  let dimensions: number | undefined;
  for (let i = 0; i < missing.length; i += batchSize) {
    const slice = missing.slice(i, i + batchSize);
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: slice.map((c) => `${c.heading}\n${c.content}`),
    });
    const vectors = result.embeddings ?? [];
    for (let j = 0; j < slice.length; j++) {
      const vec = vectors[j]?.values;
      if (vec && vec.length > 0) {
        slice[j].embedding = vec;
        dimensions = vec.length;
      }
    }
    completed += slice.length;
    onProgress?.(completed, missing.length, dimensions);
  }
  return true;
}

interface IndexedChunk {
  policy: PolicyDocument;
  versionNumber: string;
  chunk: PolicyChunk;
}

export async function answerPolicyQuery(
  query: string,
  policies: PolicyDocument[],
  existingConflicts: PolicyConflict[],
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  knowledgeGraph?: PolicyKnowledgeGraph
): Promise<RagQueryResult> {
  const activeGraph =
    knowledgeGraph && knowledgeGraph.nodes.length > 0
      ? knowledgeGraph
      : buildPolicyKnowledgeGraph(policies, existingConflicts);

  const { graphContext, clauseBoosts, subgraphTriplesText } =
    retrieveGraphRagSubgraph(query, activeGraph, policies, existingConflicts, history);

  const recentUserContext = history
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content)
    .join(' ');
  const retrievalQuery = recentUserContext ? `${recentUserContext} ${query}` : query;

  const activeIndexed: IndexedChunk[] = [];
  for (const policy of policies) {
    if (policy.status === 'archived') continue;
    const currentVer =
      policy.versions.find((v) => v.id === policy.currentVersionId) ??
      policy.versions[policy.versions.length - 1];
    if (!currentVer) continue;
    for (const chunk of currentVer.chunks) {
      activeIndexed.push({
        policy,
        versionNumber: currentVer.versionNumber,
        chunk,
      });
    }
  }

  let usedEmbeddings = false;
  let queryEmbedding: number[] | undefined;
  try {
    const embClient = getGeminiEmbeddingClient();
    if (embClient) {
      await ensureChunkEmbeddings(activeIndexed.map((x) => x.chunk));
      const qEmbedRes = await embClient.models.embedContent({
        model: 'gemini-embedding-2',
        contents: retrievalQuery,
      });
      queryEmbedding = qEmbedRes.embeddings?.[0]?.values;
      if (queryEmbedding && queryEmbedding.length > 0) {
        usedEmbeddings = true;
      }
    }
  } catch {
    usedEmbeddings = false;
  }

  const scored = activeIndexed.map((item) => {
    const lex = lexicalScore(
      retrievalQuery,
      `${item.policy.title} ${item.chunk.heading} ${item.chunk.content}`
    );
    const vec =
      usedEmbeddings && queryEmbedding && item.chunk.embedding
        ? Math.max(0, cosineSimilarity(queryEmbedding, item.chunk.embedding))
        : 0;
    const graphBoost = clauseBoosts.get(item.chunk.id) ?? 0;
    const combined = usedEmbeddings
      ? vec * 0.56 + Math.min(1, lex) * 0.22 + graphBoost * 0.42
      : lex * 0.68 + graphBoost * 0.65;
    return { item, score: combined };
  });

  scored.sort((a, b) => b.score - a.score);
  const topChunks = scored.slice(0, 9);

  const openConflicts = existingConflicts.filter((c) => c.status === 'open');
  const contextText = topChunks
    .map(
      ({ item, score }, idx) =>
        `[片段 ${idx + 1}] 制度：《${item.policy.title}》(${item.policy.code}) 版本：${item.versionNumber} | 条款：${item.chunk.clauseRef} | 匹配度：${score.toFixed(3)}\n内容：${item.chunk.content}`
    )
    .join('\n\n');

  const conflictContext =
    openConflicts.length > 0
      ? openConflicts
          .map(
            (c) =>
              `- [${c.id} | ${c.severity}] ${c.title}: 《${c.policyATitle} ${c.policyAVersion}》(${c.clauseA}) 与 《${c.policyBTitle} ${c.policyBVersion}》(${c.clauseB}) -> ${c.description}`
          )
          .join('\n')
      : '当前暂无已登记的未决冲突。';

  const communityText =
    graphContext.communitySummaries.length > 0
      ? graphContext.communitySummaries.join('\n')
      : '暂无特定社区摘要。';

  const historyText =
    history.length > 0
      ? `\n\n近期对话上下文：\n${history
          .slice(-6)
          .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
          .join('\n')}`
      : '';

  const parsed = await generateStructuredJson<{
    answer: string;
    hasConflict: boolean;
    conflictWarnings: Array<{
      conflictId?: string;
      summary: string;
      clauseA: string;
      clauseB: string;
      severity: 'critical' | 'warning' | 'info';
    }>;
    citedIndices?: number[];
  }>({
    systemInstruction:
      '你是基于 GraphRAG 的企业制度治理与合规审计专家。请结合多跳知识图谱关系路径、社区摘要与检索到的制度条款原文回答用户问题。必须做到：1）用清晰、专业、简洁的中文作答，明确引用来源格式如《制度名称 vX.X · 第X条》；2）沿图谱关系（如审批归属、援引制度、冲突矛盾边）进行跨文档联合推理，若检索子图或冲突台账中存在口径矛盾、阈值不一致、审批权限冲突或旧版本引用问题，必须主动在回答和 conflictWarnings 字段中明确警示用户，并说明执行优先级建议；3）绝不编造条款中未出现的数字或规定。',
    userPrompt: `用户当前问题：${query}${historyText}\n\nGraphRAG 多跳知识图谱关系路径：\n${subgraphTriplesText}\n\n关联知识社区摘要：\n${communityText}\n\n图谱与向量混合检索到的制度条款片段：\n${contextText}\n\n系统已识别的现存冲突台账：\n${conflictContext}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description: '基于检索条款的详尽中文解答，包含准确引用与差异说明。',
        },
        hasConflict: {
          type: Type.BOOLEAN,
          description: '与当前问题相关的条款中是否存在矛盾或冲突。',
        },
        conflictWarnings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              conflictId: {
                type: Type.STRING,
                description: '如果匹配已登记冲突台账请填写对应 conflictId，否则留空。',
              },
              summary: {
                type: Type.STRING,
                description: '矛盾核心概要。',
              },
              clauseA: {
                type: Type.STRING,
                description: '冲突条款 A（制度名称 + 版本 + 条款号）。',
              },
              clauseB: {
                type: Type.STRING,
                description: '冲突条款 B（制度名称 + 版本 + 条款号）。',
              },
              severity: {
                type: Type.STRING,
                description: '必须为 critical、warning 或 info 之一。',
              },
            },
            required: ['summary', 'clauseA', 'clauseB', 'severity'],
          },
        },
        citedIndices: {
          type: Type.ARRAY,
          items: { type: Type.INTEGER },
          description: '实际支撑本次回答的检索片段序号（从 1 开始）。',
        },
      },
      required: ['answer', 'hasConflict', 'conflictWarnings', 'citedIndices'],
    },
    schemaHint: `{
  "answer": "基于检索条款的详尽中文解答（string）",
  "hasConflict": true,
  "conflictWarnings": [
    {
      "conflictId": "匹配台账ID，无则留空字符串",
      "summary": "矛盾核心概要",
      "clauseA": "《制度A vX.X》第X条",
      "clauseB": "《制度B vX.X》第X条",
      "severity": "critical | warning | info"
    }
  ],
  "citedIndices": [1, 2]
}`,
  });

  const citedIndices =
    parsed.citedIndices && parsed.citedIndices.length > 0
      ? parsed.citedIndices
      : [1, 2, 3];

  const citations: RagCitation[] = citedIndices
    .map((idx) => topChunks[idx - 1])
    .filter(Boolean)
    .map(({ item, score }) => ({
      policyId: item.policy.id,
      policyTitle: item.policy.title,
      versionNumber: item.versionNumber,
      clauseRef: item.chunk.clauseRef,
      excerpt: item.chunk.content,
      relevanceScore: Number(Math.min(0.99, Math.max(0.12, score)).toFixed(2)),
    }));

  return {
    answer: parsed.answer,
    hasConflict: Boolean(parsed.hasConflict),
    conflictWarnings: (parsed.conflictWarnings ?? []).map((w) => ({
      conflictId: w.conflictId || undefined,
      summary: w.summary,
      clauseA: w.clauseA,
      clauseB: w.clauseB,
      severity:
        w.severity === 'critical' || w.severity === 'warning' || w.severity === 'info'
          ? w.severity
          : 'warning',
    })),
    citations,
    retrievedChunks: topChunks.length,
    usedEmbeddings,
    graphContext,
  };
}

export async function detectPolicyConflicts(
  policies: PolicyDocument[],
  focusPolicyId?: string
): Promise<Omit<PolicyConflict, 'id' | 'status' | 'detectedAt'>[]> {
  const activeDocs = policies
    .filter((p) => p.status !== 'archived')
    .map((p) => {
      const ver =
        p.versions.find((v) => v.id === p.currentVersionId) ??
        p.versions[p.versions.length - 1];
      return {
        policyId: p.id,
        code: p.code,
        title: p.title,
        versionNumber: ver?.versionNumber ?? 'v1.0',
        content: ver?.content ?? '',
      };
    });

  const focusNote = focusPolicyId
    ? `请重点排查制度 ID "${focusPolicyId}" 与库内其他所有制度（及其自身内部条款）之间存在的任何矛盾、冲突或滞后引用。`
    : '请对以下全部现行有效制度进行交叉比对与内部自检，全面识别所有存在实质性矛盾、口径不一致或滞后引用的条款对。';

  const docsPayload = activeDocs
    .map(
      (d) =>
        `=== 制度ID: ${d.policyId} | 编号: ${d.code} | 名称: 《${d.title}》 | 当前版本: ${d.versionNumber} ===\n${d.content}`
    )
    .join('\n\n');

  const parsed = await generateStructuredJson<{
    conflicts: Array<Omit<PolicyConflict, 'id' | 'status' | 'detectedAt'>>;
  }>({
    systemInstruction:
      '你是资深企业内控合规审计专家。请仔细逐条比对各制度文件，精准识别：1) numeric_threshold（数值/天数/金额/等级阈值冲突）；2) approval_authority（审批权限/流程节点冲突）；3) scope_exclusion（适用范围或时间安排互斥）；4) stale_reference（引用了已过期或已被覆盖的旧制度版本）；5) ambiguity（同一制度内部或跨制度定义歧义）。只输出真实存在的冲突，不要捏造不存在的矛盾，确保 excerptA 与 excerptB 尽量保留原句。同时必须提取 1 到 3 项高度凝练的 conflictPoints（每项拆出具体冲突维度 dimension、A方直接规定 valueA、B方直接规定 valueB 及直接影响 impact），让审核人一眼看穿核心矛盾数值/权限/对象差异。',
    userPrompt: `${focusNote}\n\n${docsPayload}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        conflicts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description:
                  'numeric_threshold | approval_authority | scope_exclusion | stale_reference | ambiguity',
              },
              severity: {
                type: Type.STRING,
                description: 'critical | warning | info',
              },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              suggestedResolution: { type: Type.STRING },
              conflictPoints: {
                type: Type.ARRAY,
                description: '1到3条结构化矛盾点对照，直接提炼双方冲突的阈值、权限、对象或版本差异。',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    dimension: {
                      type: Type.STRING,
                      description: '冲突维度，例如“连续病假天数门槛”“审批金额上限”“周五办公地点”。',
                    },
                    valueA: {
                      type: Type.STRING,
                      description: '制度A的直接规定值（简明扼要，保留精确数字或核心动作，不超过22字）。',
                    },
                    valueB: {
                      type: Type.STRING,
                      description: '制度B的直接规定值（与valueA形成直接反差，不超过22字）。',
                    },
                    impact: {
                      type: Type.STRING,
                      description: '一句话说明该矛盾点导致的执行困惑或合规风险。',
                    },
                  },
                  required: ['dimension', 'valueA', 'valueB'],
                },
              },
              policyAId: { type: Type.STRING },
              policyATitle: { type: Type.STRING },
              policyAVersion: { type: Type.STRING },
              clauseA: { type: Type.STRING },
              excerptA: { type: Type.STRING },
              policyBId: { type: Type.STRING },
              policyBTitle: { type: Type.STRING },
              policyBVersion: { type: Type.STRING },
              clauseB: { type: Type.STRING },
              excerptB: { type: Type.STRING },
            },
            required: [
              'type',
              'severity',
              'title',
              'description',
              'suggestedResolution',
              'conflictPoints',
              'policyAId',
              'policyATitle',
              'policyAVersion',
              'clauseA',
              'excerptA',
              'policyBId',
              'policyBTitle',
              'policyBVersion',
              'clauseB',
              'excerptB',
            ],
          },
        },
      },
      required: ['conflicts'],
    },
    schemaHint: `{
  "conflicts": [
    {
      "type": "numeric_threshold | approval_authority | scope_exclusion | stale_reference | ambiguity",
      "severity": "critical | warning | info",
      "title": "冲突标题",
      "description": "冲突详细说明",
      "suggestedResolution": "建议修订方向",
      "conflictPoints": [
        { "dimension": "对比维度", "valueA": "A方规定", "valueB": "B方规定", "impact": "执行影响" }
      ],
      "policyAId": "制度A的ID",
      "policyATitle": "制度A名称",
      "policyAVersion": "vX.X",
      "clauseA": "第X条",
      "excerptA": "条款A原文",
      "policyBId": "制度B的ID",
      "policyBTitle": "制度B名称",
      "policyBVersion": "vX.X",
      "clauseB": "第X条",
      "excerptB": "条款B原文"
    }
  ]
}`,
  });

  return parsed.conflicts ?? [];
}

export async function analyzeVersionDiff(
  policyTitle: string,
  oldVersionNumber: string,
  oldContent: string,
  newVersionNumber: string,
  newContent: string,
  otherPolicies: PolicyDocument[]
): Promise<SemanticDiffAnalysis> {
  const otherTitles = otherPolicies
    .map((p) => {
      const v = p.versions.find((x) => x.id === p.currentVersionId) ?? p.versions[p.versions.length - 1];
      return `- 《${p.title}》(${v?.versionNumber ?? 'v1.0'})：${v?.content.slice(0, 260).replace(/\n+/g, ' ')}...`;
    })
    .join('\n');

  return generateStructuredJson<SemanticDiffAnalysis>({
    systemInstruction:
      '你是企业制度版本审计专家。请对比同一制度的新旧两个版本，提炼实质性的合规变更（金额、天数、审批权、适用对象、生效限制等），并结合库内其他关联制度判断本次版本修订是否引发跨制度联动影响或新冲突。',
    userPrompt: `对比制度：《${policyTitle}》\n旧版本（${oldVersionNumber}）：\n${oldContent}\n\n新版本（${newVersionNumber}）：\n${newContent}\n\n库内其他关联制度摘要：\n${otherTitles}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        impactLevel: { type: Type.STRING, description: 'critical | warning | info' },
        keyChanges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              clause: { type: Type.STRING },
              changeType: { type: Type.STRING, description: 'modified | added | removed' },
              description: { type: Type.STRING },
              downstreamRisk: { type: Type.STRING },
            },
            required: ['clause', 'changeType', 'description', 'downstreamRisk'],
          },
        },
        affectedPolicies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        potentialConflicts: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: [
        'summary',
        'impactLevel',
        'keyChanges',
        'affectedPolicies',
        'potentialConflicts',
      ],
    },
    schemaHint: `{
  "summary": "版本变更总体影响摘要",
  "impactLevel": "critical | warning | info",
  "keyChanges": [
    {
      "clause": "第X条",
      "changeType": "modified | added | removed",
      "description": "实质变更内容",
      "downstreamRisk": "对业务或合规的下游影响"
    }
  ],
  "affectedPolicies": ["受影响的关联制度名称"],
  "potentialConflicts": ["潜在联动冲突说明"]
}`,
  });
}

export async function draftConflictResolution(conflict: PolicyConflict): Promise<{
  recommendedPolicyToUpdate: string;
  revisedClauseText: string;
  rationale: string;
}> {
  return generateStructuredJson<{
    recommendedPolicyToUpdate: string;
    revisedClauseText: string;
    rationale: string;
  }>({
    systemInstruction:
      '请作为企业法务合规顾问，针对上述制度矛盾起草一份可直接发布落地的条款修订建议稿，明确指出应当修订哪一份制度、给出完整的新条款措辞及修订依据。',
    userPrompt: `冲突标题：${conflict.title}
冲突描述：${conflict.description}
条款 A（《${conflict.policyATitle}》${conflict.policyAVersion} ${conflict.clauseA}）：${conflict.excerptA}
条款 B（《${conflict.policyBTitle}》${conflict.policyBVersion} ${conflict.clauseB}）：${conflict.excerptB}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        recommendedPolicyToUpdate: { type: Type.STRING },
        revisedClauseText: { type: Type.STRING },
        rationale: { type: Type.STRING },
      },
      required: ['recommendedPolicyToUpdate', 'revisedClauseText', 'rationale'],
    },
    schemaHint: `{
  "recommendedPolicyToUpdate": "建议修订的制度名称及条款号",
  "revisedClauseText": "完整的新条款修订措辞文本",
  "rationale": "修订依据与风控理由"
}`,
  });
}

export async function extractDocumentMarkdownWithGemini(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const config = resolveActiveLlmConfig();
  const promptText = `请完整提取这份企业制度文档（文件名：${fileName}）的全部文本条款内容，并整理为结构清晰的 Markdown 格式（保留章节标题如 "## 第一章" 与条款编号如 "第一条"、"第1条"，完整保留数字金额、天数、审批角色与适用条件，不要遗漏或总结删减原文）。仅输出整理后的 Markdown 正文。`;

  if (config.provider === 'gemini') {
    const ai = createGeminiClient(config.apiKey, config.baseUrl || undefined);
    const response = await generateGeminiContentWithRetry(
      ai,
      {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
            { text: promptText },
          ],
        },
      },
      config.model,
      true
    );

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error(`未能从文件 ${fileName} 中提取到有效文本内容。`);
    }
    return text;
  }

  // Fallback for PDF / scanned images when non-Gemini provider is selected
  if (mimeType.startsWith('image/')) {
    const endpoint = config.baseUrl.endsWith('/chat/completions')
      ? config.baseUrl
      : `${config.baseUrl}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${buffer.toString('base64')}`,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (res.ok) {
      const data = await res.json();
      const text = extractOpenAiMessageText(data).trim();
      if (text) return text;
    }
  }

  const builtInGeminiKey = getBuiltInGeminiKey();
  if (builtInGeminiKey) {
    const ai = createGeminiClient(builtInGeminiKey);
    const response = await generateGeminiContentWithRetry(
      ai,
      {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
            { text: promptText },
          ],
        },
      },
      'gemini-4-hydrogen',
      true
    );
    const text = (response.text ?? '').trim();
    if (text) return text;
  }

  throw new Error(
    `文件 ${fileName} 为扫描件或图片格式，当前所选模型 (${config.model}) 不支持直接多模态 PDF 解析。请切换为 Google Gemini 模型，或上传可提取文本的 PDF / DOCX / TXT / MD 文件。`
  );
}

export async function extractKnowledgeGraphWithGemini(
  policies: PolicyDocument[],
  conflicts: PolicyConflict[]
): Promise<PolicyKnowledgeGraph> {
  const baseGraph = buildPolicyKnowledgeGraph(policies, conflicts);

  const activePolicies = policies.filter((p) => p.status !== 'archived');
  const corpus = activePolicies
    .map((p) => {
      const ver =
        p.versions.find((v) => v.id === p.currentVersionId) ??
        p.versions[p.versions.length - 1];
      if (!ver) return '';
      return `【${p.title} (${ver.versionNumber}) | ${p.category}】\n${ver.content}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  const existingCommNames = baseGraph.communities.map((c) => c.name).join('、');
  const existingNodeSample = baseGraph.nodes
    .filter((n) => n.type !== 'clause')
    .slice(0, 40)
    .map((n) => `${n.label}(${n.type})`)
    .join('、');

  const aiPayload = await generateStructuredJson<AiGraphEnrichmentPayload>({
    systemInstruction:
      '你是 GraphRAG 知识图谱构建专家。请从企业制度文档中抽取高价值结构化实体与跨文档关系，避免重复抽取冗长无意义的通用词。entity type 仅限 role / rule / topic；relation 仅限 requires_approval / defines_rule / applies_to / references；sourceLabel 和 targetLabel 尽量与现有节点或制度/条款名称对齐。',
    userPrompt: `已有核心图谱节点参考：${existingNodeSample}\n已有知识社区名称：${existingCommNames}\n\n请基于以下全部现行企业制度原文，补充抽取深层业务实体、跨制度隐含语义关联（特别是跨文档的审批依赖、适用条件互斥、制度援引），并撰写各知识社区的精炼洞察摘要：\n\n${corpus}`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        entities: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              type: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['label', 'type', 'summary'],
          },
        },
        relations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              sourceLabel: { type: Type.STRING },
              targetLabel: { type: Type.STRING },
              relation: { type: Type.STRING },
              label: { type: Type.STRING },
              evidence: { type: Type.STRING },
            },
            required: ['sourceLabel', 'targetLabel', 'relation', 'label', 'evidence'],
          },
        },
        communityInsights: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              communityName: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['communityName', 'summary'],
          },
        },
      },
      required: ['entities', 'relations', 'communityInsights'],
    },
    schemaHint: `{
  "entities": [
    { "label": "实体名称", "type": "role | rule | topic", "summary": "简短说明" }
  ],
  "relations": [
    {
      "sourceLabel": "源实体或制度节点名",
      "targetLabel": "目标实体或制度节点名",
      "relation": "requires_approval | defines_rule | applies_to | references",
      "label": "关系中文标签",
      "evidence": "原文依据"
    }
  ],
  "communityInsights": [
    { "communityName": "知识社区名称", "summary": "跨制度洞察摘要" }
  ]
}`,
  });

  return mergeAiGraphEnrichment(baseGraph, aiPayload);
}
