import fs from 'fs';
import path from 'path';
import type {
  LlmProviderId,
  LlmSettingsInput,
  LlmSettingsPublic,
} from '../src/types/policy.ts';
import { LLM_PROVIDER_CATALOG, getProviderPreset } from '../src/utils/llmProviders.ts';

export interface LlmSettingsStored {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  updatedAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'llm-settings.json');

const VALID_PROVIDER_IDS = new Set<LlmProviderId>(
  LLM_PROVIDER_CATALOG.map((p) => p.id)
);

function getDefaultSettings(): LlmSettingsStored {
  return {
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    baseUrl: '',
    apiKey: '',
    updatedAt: new Date().toISOString(),
  };
}

export function getBuiltInGeminiKey(): string {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return '';
  return key;
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function isValidProvider(val: unknown): val is LlmProviderId {
  return typeof val === 'string' && VALID_PROVIDER_IDS.has(val as LlmProviderId);
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Base URL 格式无效，请填写完整的 http:// 或 https:// 地址。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL 仅支持 http:// 或 https:// 协议。');
  }
  return trimmed.replace(/\/+$/, '');
}

let cachedSettings: LlmSettingsStored | null = null;

export function getLlmSettingsRaw(): LlmSettingsStored {
  if (cachedSettings) return cachedSettings;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LlmSettingsStored>;
      const provider: LlmProviderId = isValidProvider(parsed.provider)
        ? parsed.provider
        : 'gemini';
      const preset = getProviderPreset(provider);
      cachedSettings = {
        provider,
        model:
          typeof parsed.model === 'string' && parsed.model.trim()
            ? parsed.model.trim()
            : preset.defaultModel,
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : preset.defaultBaseUrl,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
        updatedAt:
          typeof parsed.updatedAt === 'string' && parsed.updatedAt
            ? parsed.updatedAt
            : new Date().toISOString(),
      };
      return cachedSettings;
    } catch {
      // Fall through to default
    }
  }

  cachedSettings = getDefaultSettings();
  return cachedSettings;
}

function persistSettings(next: LlmSettingsStored): LlmSettingsStored {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  cachedSettings = next;
  return next;
}

export function toPublicLlmSettings(raw: LlmSettingsStored): LlmSettingsPublic {
  const customKey = raw.apiKey.trim();
  const builtInKey = getBuiltInGeminiKey();
  const hasCustomApiKey = Boolean(customKey);
  const hasBuiltInGeminiKey = Boolean(builtInKey);
  const hasApiKey =
    raw.provider === 'gemini'
      ? hasCustomApiKey || hasBuiltInGeminiKey
      : hasCustomApiKey;

  const source: LlmSettingsPublic['source'] = hasCustomApiKey
    ? 'custom'
    : raw.provider === 'gemini' && hasBuiltInGeminiKey
      ? 'built_in'
      : 'unconfigured';

  return {
    provider: raw.provider,
    model: raw.model,
    baseUrl: raw.baseUrl,
    hasApiKey,
    hasCustomApiKey,
    hasBuiltInGeminiKey,
    apiKeyMasked: hasCustomApiKey ? maskApiKey(customKey) : '',
    source,
    updatedAt: raw.updatedAt,
  };
}

export function getLlmSettingsPublic(): LlmSettingsPublic {
  return toPublicLlmSettings(getLlmSettingsRaw());
}

export function saveLlmSettings(input: LlmSettingsInput): LlmSettingsPublic {
  const existing = getLlmSettingsRaw();

  if (!isValidProvider(input.provider)) {
    throw new Error('不支持的大模型服务商类型。');
  }

  const preset = getProviderPreset(input.provider);
  const model = (input.model ?? '').trim();
  if (!model) {
    throw new Error('请填写或选择模型名称（Model ID）。');
  }

  const normalizedBaseUrl = normalizeBaseUrl(
    input.baseUrl !== undefined ? input.baseUrl : preset.defaultBaseUrl
  );

  if (input.provider !== 'gemini' && !normalizedBaseUrl) {
    throw new Error(`请填写 ${preset.name} 的 Base URL。`);
  }

  let nextApiKey = '';
  if (input.clearApiKey) {
    nextApiKey = '';
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    nextApiKey = input.apiKey.trim();
  } else if (input.provider === existing.provider) {
    nextApiKey = existing.apiKey;
  }

  if (input.provider !== 'gemini' && !nextApiKey) {
    throw new Error(`请为 ${preset.name} 填写 API Key。`);
  }

  const saved = persistSettings({
    provider: input.provider,
    model,
    baseUrl: normalizedBaseUrl,
    apiKey: nextApiKey,
    updatedAt: new Date().toISOString(),
  });

  return toPublicLlmSettings(saved);
}

export function resetLlmSettings(): LlmSettingsPublic {
  const saved = persistSettings(getDefaultSettings());
  return toPublicLlmSettings(saved);
}
