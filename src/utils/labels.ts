import type {
  AlertTriggerType,
  ConflictType,
  EffectiveCycle,
  SeverityLevel,
} from '../types/policy';

export const CONFLICT_TYPE_LABELS: Record<ConflictType, string> = {
  numeric_threshold: '数值与阈值冲突',
  approval_authority: '审批权限冲突',
  scope_exclusion: '适用范围互斥',
  stale_reference: '过期版本引用',
  ambiguity: '条款口径歧义',
};

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: '严重矛盾',
  warning: '潜在风险',
  info: '一般提示',
};

export const ALERT_TYPE_LABELS: Record<AlertTriggerType, string> = {
  new_conflict: '新冲突预警',
  review_due: '复审到期提醒',
  version_impact: '版本联动影响',
  unresolved_sla: '高危超期督办',
};

export const EFFECTIVE_CYCLE_LABELS: Record<EffectiveCycle, string> = {
  '6_months': '6 个月（半年）',
  '1_year': '1 年（12 个月）',
  '2_years': '2 年（24 个月）',
  '3_years': '3 年（36 个月）',
  long_term: '长期有效（直至修订废止）',
  unclear: '周期不明确（待确认）',
};

export const EFFECTIVE_CYCLE_OPTIONS: Array<{
  value: EffectiveCycle;
  label: string;
}> = [
  { value: '6_months', label: '6 个月（半年）' },
  { value: '1_year', label: '1 年（12 个月）' },
  { value: '2_years', label: '2 年（24 个月）' },
  { value: '3_years', label: '3 年（36 个月）' },
  { value: 'long_term', label: '长期有效（直至修订废止）' },
  { value: 'unclear', label: '周期不明确（待后续明确）' },
];

export function formatEffectiveCycle(cycle?: EffectiveCycle | ''): string {
  if (!cycle) return '未指定';
  return EFFECTIVE_CYCLE_LABELS[cycle] ?? cycle;
}

export function formatShortDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getDaysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
