import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  Check,
  CheckCheck,
  RefreshCw,
} from 'lucide-react';
import type { AlertItem, AlertRule } from '../types/policy';
import { ALERT_TYPE_LABELS, formatShortDateTime } from '../utils/labels';
import { SeverityLabel } from './SeverityLabel';

interface AlertCenterViewProps {
  alerts: AlertItem[];
  alertRules: AlertRule[];
  onMarkRead: (id: string) => Promise<void>;
  onAcknowledge: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onEvaluateRules: () => Promise<{ generatedCount: number }>;
  onUpdateRule: (
    id: string,
    updates: Partial<Pick<AlertRule, 'enabled'>>
  ) => Promise<void>;
  onJumpToConflict: (conflictId: string) => void;
  onJumpToPolicy: (policyId: string) => void;
}

export function AlertCenterView({
  alerts,
  alertRules,
  onMarkRead,
  onAcknowledge,
  onMarkAllRead,
  onEvaluateRules,
  onUpdateRule,
  onJumpToConflict,
  onJumpToPolicy,
}: AlertCenterViewProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [evaluating, setEvaluating] = useState(false);
  const [evalMessage, setEvalMessage] = useState<string | null>(null);

  const filteredAlerts = useMemo(() => {
    if (filter === 'unread') return alerts.filter((a) => !a.read);
    return alerts;
  }, [alerts, filter]);

  const handleRunEvaluation = async () => {
    setEvaluating(true);
    setEvalMessage(null);
    try {
      const res = await onEvaluateRules();
      setEvalMessage(
        res.generatedCount > 0
          ? `巡检完成，新生成 ${res.generatedCount} 条自动提醒。`
          : '巡检完成，暂无新的到期或超期提醒。'
      );
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                ['all', `全部提醒 (${alerts.length})`],
                ['unread', `未读 (${alerts.filter((a) => !a.read).length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap tabular-nums ${
                  filter === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>全部已读</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunEvaluation()}
              disabled={evaluating}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${evaluating ? 'animate-spin' : ''}`} />
              <span>{evaluating ? '检查中...' : '检查最新提醒'}</span>
            </button>
          </div>
        </div>

        {evalMessage && (
          <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-200 text-xs text-blue-800">
            {evalMessage}
          </div>
        )}

        {filteredAlerts.length === 0 ? (
          <div className="p-10 text-center">
            <BellRing className="w-7 h-7 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-900">暂无未读提醒</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-5 transition-colors ${
                  !alert.read ? 'bg-slate-50/80' : 'bg-white'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <SeverityLabel severity={alert.severity} />
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700">
                        {ALERT_TYPE_LABELS[alert.type]}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {formatShortDateTime(alert.createdAt)}
                      </span>
                      {!alert.read && (
                        <>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-medium text-blue-700">未读</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {alert.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-5">
                      {alert.message}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {alert.relatedConflictId && (
                      <button
                        type="button"
                        onClick={() => onJumpToConflict(alert.relatedConflictId!)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <span>处理冲突</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!alert.relatedConflictId && alert.relatedPolicyId && (
                      <button
                        type="button"
                        onClick={() => onJumpToPolicy(alert.relatedPolicyId!)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                      >
                        <span>查看制度</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!alert.read && (
                      <button
                        type="button"
                        onClick={() => void onMarkRead(alert.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        标为已读
                      </button>
                    )}
                    {!alert.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => void onAcknowledge(alert.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>已处理</span>
                      </button>
                    ) : (
                      <span className="text-xs text-emerald-700 font-medium px-2">
                        已确认
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">自动提醒开关</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {alertRules.map((rule) => (
            <div
              key={rule.id}
              className="px-5 py-3.5 flex items-center justify-between gap-4"
            >
              <div>
                <div className="text-sm font-medium text-slate-900">{rule.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{rule.description}</div>
              </div>
              <button
                type="button"
                onClick={() => void onUpdateRule(rule.id, { enabled: !rule.enabled })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  rule.enabled
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                {rule.enabled ? '已开启' : '已关闭'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
