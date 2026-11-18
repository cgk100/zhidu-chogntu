import type { LlmProviderId, LlmProviderPreset } from '../types/policy.ts';

export const LLM_PROVIDER_CATALOG: LlmProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    shortName: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '高性价比中文推理与制度合规分析模型，兼容 OpenAI 接口协议。',
    baseUrlPlaceholder: 'https://api.deepseek.com/v1',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    protocol: 'gemini',
    defaultBaseUrl: '',
    defaultModel: 'gemini-4-hydrogen',
    models: [
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    description: '默认内置模型，原生支持多模态 PDF OCR 与结构化 Schema 输出。',
    baseUrlPlaceholder: '可选，留空使用官方节点，或填写中转代理 URL',
    supportsBuiltInKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    shortName: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
    description: 'GPT-4o / GPT-4.1 系列，支持高精度 JSON 结构化分析与多步推理。',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
  },
  {
    id: 'qwen',
    name: '阿里通义千问 Qwen',
    shortName: '通义千问',
    protocol: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    description: '阿里云百炼 OpenAI 兼容模式，中文长文本制度解析表现稳定。',
    baseUrlPlaceholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'glm',
    name: '智谱清言 GLM',
    shortName: '智谱 GLM',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    description: '智谱开放平台大模型，适合中文企业规章条款对比与起草。',
    baseUrlPlaceholder: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'kimi',
    name: '月之暗面 Kimi',
    shortName: 'Kimi',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0711-preview',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: 'Moonshot 长上下文模型，适合多份大型制度全量交叉扫描。',
    baseUrlPlaceholder: 'https://api.moonshot.cn/v1',
  },
  {
    id: 'custom',
    name: '自定义模型 (OpenAI 兼容)',
    shortName: '自定义',
    protocol: 'openai',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
    description: '接入 OneAPI、OpenRouter、Ollama、vLLM 等任意 OpenAI 兼容端点。',
    baseUrlPlaceholder: 'https://your-gateway.example.com/v1',
  },
];

export function getProviderPreset(providerId: LlmProviderId): LlmProviderPreset {
  return (
    LLM_PROVIDER_CATALOG.find((p) => p.id === providerId) ??
    LLM_PROVIDER_CATALOG.find((p) => p.id === 'gemini') ??
    LLM_PROVIDER_CATALOG[0]
  );
}
