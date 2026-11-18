import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import type { SeverityLevel } from '../types/policy';
import { SEVERITY_LABELS } from '../utils/labels';

interface SeverityLabelProps {
  severity: SeverityLevel;
}

export function SeverityLabel({ severity }: SeverityLabelProps) {
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap shrink-0">
        <AlertOctagon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{SEVERITY_LABELS.critical}</span>
      </span>
    );
  }
  if (severity === 'warning') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{SEVERITY_LABELS.warning}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0">
      <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{SEVERITY_LABELS.info}</span>
    </span>
  );
}
