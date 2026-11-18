import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  PlugZap,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type {
  LlmProviderId,
  LlmProviderPreset,
  LlmSettingsInput,
  LlmSettingsPublic,
  LlmTestResult,
} from '../types/policy';
import { safeParseJsonResponse } from '../utils/api';
import { LLM_PROVIDER_CATALOG, getProviderPreset } from '../utils/llmProviders';

interface SettingsViewProps {
  settings: LlmSettingsPublic | null;
  providers?: LlmProviderPreset[];
  onSettingsUpdated: (next: LlmSettingsPublic) => void;
}

export function SettingsView({
  settings,
  providers,
  onSettingsUpdated,
}: SettingsViewProps) {
  const catalog = providers && providers.length > 0 ? providers : LLM_PROVIDER_CATALOG;

  const [provider, setProvider] = useState<LlmProviderId>(
    settings?.provider ?? 'gemini'
  );
  const [model, setModel] = useState<string>(
    settings?.model ?? 'gemini-4-hydrogen'
  );
  const [baseUrl, setBaseUrl] = useState<string>(settings?.baseUrl ?? '');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [clearSavedKey, setClearSavedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setModel(settings.model);
    setBaseUrl(settings.baseUrl);
    setApiKeyInput('');
    setClearSavedKey(false);
  }, [settings]);

  const activePreset = useMemo(
    () => catalog.find((p) => p.id === provider) ?? getProviderPreset(provider),
    [catalog, provider]
  );

  const isSameAsSavedProvider = settings?.provider === provider;
  const hasSavedKeyForCurrentProvider =
    Boolean(settings?.hasCustomApiKey) && isSameAsSavedProvider && !clearSavedKey;

  const handleSelectProvider = (nextProviderId: LlmProviderId) => {
    const preset =
      catalog.find((p) => p.id === nextProviderId) ??
      getProviderPreset(nextProviderId);

    setProvider(nextProviderId);
    setSaveNotice(null);
    setTestResult(null);
    setClearSavedKey(false);
    setApiKeyInput('');

    if (settings && settings.provider === nextProviderId) {
      setModel(settings.model);
      setBaseUrl(settings.baseUrl);
    } else {
      setModel(preset.defaultModel);
      setBaseUrl(preset.defaultBaseUrl);
    }
  };

  const buildPayload = (): LlmSettingsInput => ({
    provider,
    model: model.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKeyInput.trim() || undefined,
    clearApiKey: clearSavedKey || undefined,
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveNotice(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await safeParseJsonResponse<{ settings: LlmSettingsPublic }>(res);
      onSettingsUpdated(data.settings);
      setApiKeyInput('');
      setClearSavedKey(false);
      setSaveNotice({
        type: 'success',
        message: `配置已保存并生效：${getProviderPreset(data.settings.provider).name} · ${data.settings.model}`,
      });
    } catch (err) {
      setSaveNotice({
        type: 'error',
        message: err instanceof Error ? err.message : '保存设置失败',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setSaveNotice(null);

    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await safeParseJsonResponse<LlmTestResult>(res);
      setTestResult(data);
    } catch (err) {
      setTestResult({
        ok: false,
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        latencyMs: 0,
        error: err instanceof Error ? err.message : '连接测试请求失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleResetDefault = async () => {
    if (resetting) return;
    setResetting(true);
    setSaveNotice(null);
    setTestResult(null);

    try {
      const res = await fetch('/api/settings/reset', { method: 'POST' });
      const data = await safeParseJsonResponse<{ settings: LlmSettingsPublic }>(res);
      onSettingsUpdated(data.settings);
      setApiKeyInput('');
      setClearSavedKey(false);
      setSaveNotice({
        type: 'success',
        message: `已恢复默认配置：${getProviderPreset(data.settings.provider).name} · ${data.settings.model}`,
      });
    } catch (err) {
      setSaveNotice({
        type: 'error',
        message: err instanceof Error ? err.message : '恢复默认设置失败',
      });
    } finally {
      setResetting(false);
    }
  };

  const savedPreset = settings ? getProviderPreset(settings.provider) : null;

  return (
    <div className="max-w-5xl space-y-4">
      <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-slate-900">
              当前生效大模型配置
            </div>
            <p className="text-xs text-slate-500">
              用于 AI 制度问答、全库冲突扫描、版本语义对比、冲突修订起草与知识图谱深度抽取。
            </p>
          </div>
          {settings && (
            <div className="flex items-center gap-3 text-xs text-slate-600 tabular-nums">
              <span>
                服务商：
                <span className="font-medium text-slate-900">
                  {savedPreset?.shortName ?? settings.provider}
                </span>
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span>
                模型：
                <span className="font-mono font-medium text-slate-900">
                  {settings.model}
                </span>
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span
                className={
                  settings.hasApiKey
                    ? 'text-emerald-700 font-medium'
                    : 'text-red-700 font-medium'
                }
              >
                {settings.source === 'built_in'
                  ? '系统内置密钥已就绪'
                  : settings.source === 'custom'
                    ? `已保存密钥 (${settings.apiKeyMasked})`
                    : '未配置密钥'}
              </span>
            </div>
          )}
        </div>

        <div className="pt-4 space-y-3">
          <div className="text-xs font-medium text-slate-700">
            1. 选择主流大模型服务商
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {catalog.map((item) => {
              const selected = provider === item.id;
              const isActiveSaved = settings?.provider === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectProvider(item.id)}
                  className={`text-left p-3 rounded-lg border transition-colors flex flex-col justify-between gap-2 ${
                    selected
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        selected ? 'text-blue-900' : 'text-slate-900'
                      }`}
                    >
                      {item.name}
                    </span>
                    {isActiveSaved && (
                      <span className="text-[11px] font-medium text-emerald-700 shrink-0 whitespace-nowrap">
                        当前使用
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                    {item.description}
                  </p>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    {item.defaultModel || '自定义 Model ID'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-700 shrink-0" />
            <span className="text-sm font-semibold text-slate-900">
              2. 接口参数与密钥配置（{activePreset.name}）
            </span>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            协议：{activePreset.protocol === 'gemini'
              ? 'Google GenAI SDK'
              : 'OpenAI Chat Completions'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label
              htmlFor="llm-model-input"
              className="block text-xs font-medium text-slate-700"
            >
              模型名称（Model ID）
            </label>
            <input
              id="llm-model-input"
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaveNotice(null);
              }}
              placeholder={activePreset.defaultModel || '例如：gpt-4o、deepseek-chat、qwen-max'}
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            {activePreset.models.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-xs text-slate-500">常用预设：</span>
                {activePreset.models.map((presetModel) => {
                  const chosen = model.trim() === presetModel;
                  return (
                    <button
                      key={presetModel}
                      type="button"
                      onClick={() => {
                        setModel(presetModel);
                        setSaveNotice(null);
                      }}
                      className={`px-2 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap ${
                        chosen
                          ? 'bg-blue-50 border-blue-600 text-blue-800 font-medium'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {presetModel}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="llm-baseurl-input"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700"
              >
                <Link2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Base URL（接口地址）</span>
              </label>
              {activePreset.defaultBaseUrl &&
                baseUrl.trim() !== activePreset.defaultBaseUrl && (
                  <button
                    type="button"
                    onClick={() => setBaseUrl(activePreset.defaultBaseUrl)}
                    className="text-xs text-blue-700 hover:text-blue-800 font-medium whitespace-nowrap"
                  >
                    填入官方默认地址
                  </button>
                )}
            </div>
            <input
              id="llm-baseurl-input"
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setSaveNotice(null);
              }}
              placeholder={activePreset.baseUrlPlaceholder}
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            <p className="text-xs text-slate-500">
              {provider === 'gemini'
                ? '留空将直接连接 Google 官方节点；如使用企业网关或中转代理，可填写代理 Base URL。'
                : '支持官方接口地址或 OneAPI / OpenRouter / 本地 Ollama 等兼容端点（通常以 /v1 结尾）。'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="llm-apikey-input"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-700"
            >
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>API Key（接口密钥）</span>
            </label>
            {hasSavedKeyForCurrentProvider && (
              <button
                type="button"
                onClick={() => {
                  setClearSavedKey(true);
                  setApiKeyInput('');
                }}
                className="text-xs text-red-700 hover:text-red-800 font-medium whitespace-nowrap"
              >
                清除已保存的自定义密钥
              </button>
            )}
          </div>

          <div className="relative">
            <input
              id="llm-apikey-input"
              type={showKey ? 'text' : 'password'}
              value={apiKeyInput}
              autoComplete="new-password"
              onChange={(e) => {
                setApiKeyInput(e.target.value);
                if (e.target.value.trim()) setClearSavedKey(false);
                setSaveNotice(null);
              }}
              placeholder={
                hasSavedKeyForCurrentProvider
                  ? `已保存服务端密钥（${settings?.apiKeyMasked}），留空则保留现有密钥`
                  : provider === 'gemini' && settings?.hasBuiltInGeminiKey
                    ? '留空将使用系统内置 GEMINI_API_KEY；也可输入自定义 Key 覆盖'
                    : '请输入 sk-... 或对应服务商的 API Key'
              }
              className="w-full pl-3 pr-10 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => !prev)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
              aria-label={showKey ? '隐藏密钥' : '显示密钥'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>
              API Key 仅保存在服务端本地配置文件中，不会回传明文至浏览器，也不会在前端直接发起第三方请求。
              {clearSavedKey && (
                <span className="text-amber-700 font-medium ml-1">
                  （已标记清除当前自定义密钥，点击“保存设置”后生效）
                </span>
              )}
            </span>
          </div>
        </div>

        {saveNotice && (
          <div
            className={`px-3.5 py-2.5 rounded-md border flex items-center gap-2 text-xs ${
              saveNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {saveNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertOctagon className="w-4 h-4 text-red-700 shrink-0" />
            )}
            <span>{saveNotice.message}</span>
          </div>
        )}

        {testResult && (
          <div
            className={`px-3.5 py-3 rounded-md border text-xs space-y-1.5 ${
              testResult.ok
                ? 'bg-blue-50 border-blue-200 text-blue-950'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
              <span className="flex items-center gap-1.5">
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0" />
                ) : (
                  <AlertOctagon className="w-4 h-4 text-red-700 shrink-0" />
                )}
                <span>
                  {testResult.ok
                    ? `连通性测试通过（${getProviderPreset(testResult.provider).shortName} · ${testResult.model}）`
                    : `连通性测试失败（${getProviderPreset(testResult.provider).shortName} · ${testResult.model}）`}
                </span>
              </span>
              <span className="font-mono tabular-nums text-slate-600">
                耗时 {testResult.latencyMs} ms
              </span>
            </div>
            {testResult.ok ? (
              <div className="text-blue-800">
                模型响应：<span className="font-mono">{testResult.replyPreview}</span>
              </div>
            ) : (
              <div className="text-red-800 break-words">{testResult.error}</div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleResetDefault()}
            disabled={resetting || saving || testing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{resetting ? '恢复中...' : '恢复内置 Gemini 默认'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={testing || saving || resetting}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <PlugZap className={`w-3.5 h-3.5 ${testing ? 'animate-pulse text-blue-700' : ''}`} />
              <span>{testing ? '测试连接中...' : '测试连接'}</span>
            </button>

            <button
              type="submit"
              disabled={saving || testing || resetting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? '保存中...' : '保存设置'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
