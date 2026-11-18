import fs from 'fs';
import path from 'path';
import { buildPolicyKnowledgeGraph } from './graphService.ts';
import { createInitialStoreState } from './seedData.ts';
import type {
  AlertItem,
  PolicyConflict,
  StoreState,
} from '../src/types/policy.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'policy-store.json');

let cachedStore: StoreState | null = null;

export function refreshKnowledgeGraph(state: StoreState): void {
  state.knowledgeGraph = buildPolicyKnowledgeGraph(state.policies, state.conflicts);
}

export function loadStore(): StoreState {
  if (cachedStore) return cachedStore;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      cachedStore = JSON.parse(raw) as StoreState;
      let mutated = false;

      if (Array.isArray(cachedStore.policies)) {
        for (const policy of cachedStore.policies) {
          const curVer =
            policy.versions.find((v) => v.id === policy.currentVersionId) ??
            policy.versions[policy.versions.length - 1];
          if (!policy.effectiveDate && curVer?.effectiveDate) {
            policy.effectiveDate = curVer.effectiveDate;
            mutated = true;
          }
          if (!policy.effectiveCycle) {
            policy.effectiveCycle =
              policy.reviewCycleMonths === 6
                ? '6_months'
                : policy.reviewCycleMonths === 24
                  ? '2_years'
                  : policy.reviewCycleMonths === 36
                    ? '3_years'
                    : policy.reviewCycleMonths === 0
                      ? 'unclear'
                      : '1_year';
            mutated = true;
          }
          for (const ver of policy.versions) {
            if (!ver.effectiveCycle) {
              ver.effectiveCycle = policy.effectiveCycle;
              mutated = true;
            }
          }
        }
      }

      if (Array.isArray(cachedStore.conflicts)) {
        const seedConflicts = createInitialStoreState().conflicts;
        const seedById = new Map(seedConflicts.map((c) => [c.id, c]));
        for (const conflict of cachedStore.conflicts) {
          if (!conflict.conflictPoints || conflict.conflictPoints.length === 0) {
            const seedMatch = seedById.get(conflict.id);
            if (seedMatch?.conflictPoints) {
              conflict.conflictPoints = seedMatch.conflictPoints;
              if (seedMatch.description) {
                conflict.description = seedMatch.description;
              }
              if (seedMatch.excerptA) conflict.excerptA = seedMatch.excerptA;
              if (seedMatch.excerptB) conflict.excerptB = seedMatch.excerptB;
            } else {
              conflict.conflictPoints = [
                {
                  dimension: conflict.clauseA || '核心条款口径',
                  valueA: conflict.excerptA.slice(0, 42) + (conflict.excerptA.length > 42 ? '…' : ''),
                  valueB: conflict.excerptB.slice(0, 42) + (conflict.excerptB.length > 42 ? '…' : ''),
                  impact: conflict.description,
                },
              ];
            }
            mutated = true;
          }
        }
      }

      if (!cachedStore.knowledgeGraph || !Array.isArray(cachedStore.knowledgeGraph.nodes)) {
        refreshKnowledgeGraph(cachedStore);
        mutated = true;
      }

      if (mutated) {
        saveStore(cachedStore);
      }
      return cachedStore;
    } catch {
      // Fallback to fresh seed if file corrupted
    }
  }
  cachedStore = createInitialStoreState();
  refreshKnowledgeGraph(cachedStore);
  saveStore(cachedStore);
  return cachedStore;
}

export function saveStore(state: StoreState): void {
  cachedStore = state;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Evaluates active alert rules against current policies & conflicts to generate new automated reminders.
 */
export function evaluateAlertRules(state: StoreState, referenceDate = new Date()): AlertItem[] {
  const newAlerts: AlertItem[] = [];
  const nowIso = referenceDate.toISOString();

  const reviewRule = state.alertRules.find((r) => r.triggerType === 'review_due' && r.enabled);
  if (reviewRule) {
    for (const policy of state.policies) {
      if (policy.status !== 'active') continue;

      if (policy.effectiveCycle === 'unclear') {
        const alreadyExists = state.alerts.some(
          (a) =>
            a.type === 'review_due' &&
            a.relatedPolicyId === policy.id &&
            !a.acknowledged
        );
        if (!alreadyExists) {
          newAlerts.push({
            id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'review_due',
            severity: 'warning',
            title: `《${policy.title}》生效周期不明确，待核定复审周期`,
            message: `制度编号 ${policy.code}（生效日期 ${policy.effectiveDate || '未定'}）当前标注为“周期不明确”，请责任人 ${policy.owner}（${policy.department}）核定有效期。`,
            targetDepartment: policy.department,
            relatedPolicyId: policy.id,
            createdAt: nowIso,
            read: false,
            acknowledged: false,
          });
        }
        continue;
      }

      if (!policy.nextReviewDate) continue;
      const due = new Date(`${policy.nextReviewDate}T00:00:00Z`);
      if (Number.isNaN(due.getTime())) continue;
      const diffDays = Math.ceil((due.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= reviewRule.thresholdDays) {
        const alreadyExists = state.alerts.some(
          (a) =>
            a.type === 'review_due' &&
            a.relatedPolicyId === policy.id &&
            !a.acknowledged
        );
        if (!alreadyExists) {
          const isOverdue = diffDays < 0;
          newAlerts.push({
            id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'review_due',
            severity: isOverdue ? 'critical' : 'warning',
            title: isOverdue
              ? `《${policy.title}》已逾期 ${Math.abs(diffDays)} 天未复审`
              : `《${policy.title}》将于 ${diffDays} 天后到期复审`,
            message: `制度编号 ${policy.code} 计划复审日期为 ${policy.nextReviewDate}，请责任人 ${policy.owner}（${policy.department}）及时完成核验或更新版本。`,
            targetDepartment: policy.department,
            relatedPolicyId: policy.id,
            createdAt: nowIso,
            read: false,
            acknowledged: false,
          });
        }
      }
    }
    if (newAlerts.some((a) => a.type === 'review_due')) {
      reviewRule.lastTriggeredAt = nowIso;
    }
  }

  const slaRule = state.alertRules.find((r) => r.triggerType === 'unresolved_sla' && r.enabled);
  if (slaRule) {
    for (const conflict of state.conflicts) {
      if (conflict.status !== 'open' || conflict.severity !== 'critical') continue;
      const detected = new Date(conflict.detectedAt);
      const ageDays = Math.floor(
        (referenceDate.getTime() - detected.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (ageDays >= slaRule.thresholdDays) {
        const alreadyExists = state.alerts.some(
          (a) =>
            a.type === 'unresolved_sla' &&
            a.relatedConflictId === conflict.id &&
            !a.acknowledged
        );
        if (!alreadyExists) {
          newAlerts.push({
            id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'unresolved_sla',
            severity: 'critical',
            title: `高危冲突超期未处置（已超 ${ageDays} 天）：${conflict.title}`,
            message: `《${conflict.policyATitle}》与《${conflict.policyBTitle}》的严重矛盾尚未处置，请法务合规部与责任部门尽快协同修订。`,
            targetDepartment: slaRule.notifyDepartments[0] ?? '法务合规部',
            relatedPolicyId: conflict.policyAId,
            relatedConflictId: conflict.id,
            createdAt: nowIso,
            read: false,
            acknowledged: false,
          });
        }
      }
    }
    if (newAlerts.some((a) => a.type === 'unresolved_sla')) {
      slaRule.lastTriggeredAt = nowIso;
    }
  }

  if (newAlerts.length > 0) {
    state.alerts = [...newAlerts, ...state.alerts];
    saveStore(state);
  }
  return newAlerts;
}

export function mergeDetectedConflicts(
  state: StoreState,
  detected: Array<Omit<PolicyConflict, 'id' | 'status' | 'detectedAt'>>
): { added: PolicyConflict[]; totalOpen: number } {
  const nowIso = new Date().toISOString();
  const added: PolicyConflict[] = [];

  for (const item of detected) {
    const duplicate = state.conflicts.find(
      (existing) =>
        existing.status !== 'resolved' &&
        ((existing.policyAId === item.policyAId &&
          existing.policyBId === item.policyBId &&
          existing.clauseA === item.clauseA) ||
          (existing.policyAId === item.policyBId &&
            existing.policyBId === item.policyAId &&
            existing.clauseB === item.clauseA) ||
          existing.title === item.title)
    );
    if (!duplicate) {
      const created: PolicyConflict = {
        ...item,
        id: `conf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        status: 'open',
        detectedAt: nowIso,
      };
      state.conflicts.unshift(created);
      added.push(created);
    }
  }

  const conflictRule = state.alertRules.find((r) => r.triggerType === 'new_conflict' && r.enabled);
  if (conflictRule && added.length > 0) {
    const newAlerts: AlertItem[] = added
      .filter((c) => {
        if (conflictRule.minSeverity === 'critical') return c.severity === 'critical';
        if (conflictRule.minSeverity === 'warning') return c.severity !== 'info';
        return true;
      })
      .map((c) => ({
        id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'new_conflict',
        severity: c.severity,
        title: `检测到新制度冲突：${c.title}`,
        message: `《${c.policyATitle} ${c.policyAVersion}》(${c.clauseA}) 与 《${c.policyBTitle} ${c.policyBVersion}》(${c.clauseB}) 存在条款矛盾：${c.description}`,
        targetDepartment: conflictRule.notifyDepartments[0] ?? '法务合规部',
        relatedPolicyId: c.policyAId,
        relatedConflictId: c.id,
        createdAt: nowIso,
        read: false,
        acknowledged: false,
      }));

    if (newAlerts.length > 0) {
      state.alerts = [...newAlerts, ...state.alerts];
      conflictRule.lastTriggeredAt = nowIso;
    }
  }

  state.lastAuditAt = nowIso;
  refreshKnowledgeGraph(state);
  saveStore(state);
  return {
    added,
    totalOpen: state.conflicts.filter((c) => c.status === 'open').length,
  };
}
