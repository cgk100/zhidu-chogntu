import type { ConflictPoint, PolicyConflict } from '../types/policy';

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

const DOMAIN_CONTRAST_PATTERNS: RegExp[] = [
  /(?:超过|大于|满|达到|少于|低于|以内|以下|以上|至多|至少)?\s*\d+(?:\.\d+)?\s*(?:天（含）(?:以上|以内)?|天|个工作日|工作日|自然日|元（含）(?:以下|以上)?|元\/晚|元|%|小时|个月|年)/g,
  /v\d+(?:\.\d+)?/gi,
  /20\d{2}\s*版/g,
  /20\d{2}-\d{2}-\d{2}/g,
  /(?:三级甲等|三甲|二级甲等|二甲|二级及以上|三级及以上|一级)(?:公立)?(?:医院|医疗机构)?/g,
  /(?:每周[一二三四五六日]|周[一二三四五六日])/g,
  /(?:必须现场在岗集中办公|现场在岗集中办公|固定居家远程办公|常态化居家办公|居家远程办公|集中办公)/g,
  /(?:任何部门不得|严禁|不得|禁止|无需额外总监前置审批|无需上呈分管副总裁|无需每日单独发起请假流程|必须加签|须经[^，。；]{2,12}书面审批|直接终审批准|直接按实际工时折算为加班调休)/g,
  /(?:分管副总裁及财务合规复核|分管副总裁|财务合规复核|部门总监|直属主管|部门负责人)/g,
  /(?:加盖诊断章证明书|正式诊断证明|挂号单|线上复诊记录|门诊病历及缴费凭证)/g,
];

function extractTokensFromHint(text: string): string[] {
  const tokens: string[] = [];
  for (const pattern of DOMAIN_CONTRAST_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const cleaned = match[0].trim();
      if (cleaned.length >= 2) {
        tokens.push(cleaned);
      }
    }
  }
  return tokens;
}

export function getConflictPoints(conflict: PolicyConflict): ConflictPoint[] {
  if (conflict.conflictPoints && conflict.conflictPoints.length > 0) {
    return conflict.conflictPoints;
  }
  const tokensA = extractTokensFromHint(conflict.excerptA);
  const tokensB = extractTokensFromHint(conflict.excerptB);
  const summaryA =
    tokensA.length > 0
      ? tokensA.slice(0, 3).join(' · ')
      : conflict.excerptA.slice(0, 44) + (conflict.excerptA.length > 44 ? '…' : '');
  const summaryB =
    tokensB.length > 0
      ? tokensB.slice(0, 3).join(' · ')
      : conflict.excerptB.slice(0, 44) + (conflict.excerptB.length > 44 ? '…' : '');

  return [
    {
      dimension: '关键差异口径',
      valueA: summaryA,
      valueB: summaryB,
      impact: conflict.description,
    },
  ];
}

export function splitHighlightedExcerpt(
  excerpt: string,
  points: ConflictPoint[],
  side: 'A' | 'B'
): HighlightSegment[] {
  if (!excerpt) return [{ text: '', highlighted: false }];

  const hintTexts = [
    excerpt,
    ...points.map((p) => (side === 'A' ? p.valueA : p.valueB)),
  ];

  const candidateSet = new Set<string>();
  for (const source of hintTexts) {
    for (const token of extractTokensFromHint(source)) {
      if (excerpt.includes(token)) {
        candidateSet.add(token);
      }
    }
  }

  // Also check short verbatim clauses from valueA/valueB split on punctuation
  for (const p of points) {
    const val = side === 'A' ? p.valueA : p.valueB;
    for (const piece of val.split(/[，。；、（）()]/)) {
      const trimmed = piece.trim();
      if (trimmed.length >= 3 && trimmed.length <= 20 && excerpt.includes(trimmed)) {
        candidateSet.add(trimmed);
      }
    }
  }

  const candidates = Array.from(candidateSet).sort((a, b) => b.length - a.length);
  if (candidates.length === 0) {
    return [{ text: excerpt, highlighted: false }];
  }

  // Find non-overlapping match ranges
  const ranges: Array<{ start: number; end: number }> = [];
  for (const token of candidates) {
    let searchFrom = 0;
    while (searchFrom < excerpt.length) {
      const idx = excerpt.indexOf(token, searchFrom);
      if (idx === -1) break;
      const end = idx + token.length;
      const overlaps = ranges.some((r) => idx < r.end && end > r.start);
      if (!overlaps) {
        ranges.push({ start: idx, end });
      }
      searchFrom = end;
    }
  }

  if (ranges.length === 0) {
    return [{ text: excerpt, highlighted: false }];
  }

  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      segments.push({ text: excerpt.slice(cursor, r.start), highlighted: false });
    }
    segments.push({ text: excerpt.slice(r.start, r.end), highlighted: true });
    cursor = r.end;
  }
  if (cursor < excerpt.length) {
    segments.push({ text: excerpt.slice(cursor), highlighted: false });
  }
  return segments;
}

export interface LocateRangeResult {
  start: number;
  end: number;
  lineNumber: number;
  matchedText: string;
}

function normalizeForMatch(text: string): {
  normalized: string;
  indexMap: number[];
} {
  let normalized = '';
  const indexMap: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/[\s“”"'`「」『』]/.test(ch)) continue;
    normalized += ch;
    indexMap.push(i);
  }
  return { normalized, indexMap };
}

function findNormalizedRange(
  haystack: string,
  needle: string,
  searchFrom = 0,
  searchTo = haystack.length
): { start: number; end: number } | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const sub = haystack.slice(searchFrom, searchTo);
  const directIdx = sub.indexOf(trimmed);
  if (directIdx !== -1) {
    return {
      start: searchFrom + directIdx,
      end: searchFrom + directIdx + trimmed.length,
    };
  }

  const normNeedle = normalizeForMatch(trimmed).normalized;
  if (normNeedle.length < 2) return null;

  const { normalized: normSub, indexMap } = normalizeForMatch(sub);
  const normIdx = normSub.indexOf(normNeedle);
  if (normIdx !== -1) {
    const start = searchFrom + indexMap[normIdx];
    const endIdx = indexMap[normIdx + normNeedle.length - 1];
    return { start, end: searchFrom + endIdx + 1 };
  }

  return null;
}

function expandToClauseSpan(
  content: string,
  start: number,
  end: number
): { start: number; end: number } {
  const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1));
  const nextBreak = content.indexOf('\n', end);
  return {
    start: lineStart === -1 ? 0 : lineStart + 1,
    end: nextBreak === -1 ? content.length : nextBreak,
  };
}

function extractFocusCandidates(focusText: string): string[] {
  const candidates = new Set<string>();
  const trimmed = focusText.trim();
  if (trimmed.length >= 2) candidates.add(trimmed);

  for (const token of extractTokensFromHint(trimmed)) {
    if (token.length >= 2) candidates.add(token);
  }

  for (const piece of trimmed.split(/[，。；、：:（）()「」""\s]+/)) {
    const clean = piece.trim();
    if (clean.length >= 2) candidates.add(clean);
  }

  // Extract numeric + unit chunks or short key phrases
  const unitMatches = trimmed.match(
    /\d+(?:\.\d+)?\s*(?:元（含）|天（含）|个工作日|工作日|自然日|元\/晚|元|%|小时|个月|天|年)/g
  );
  if (unitMatches) {
    for (const m of unitMatches) {
      if (m.trim().length >= 2) candidates.add(m.trim());
    }
  }

  const numericMatches = trimmed.match(/\d+(?:\.\d+)?\s*[^\s，。；、]{1,6}/g);
  if (numericMatches) {
    for (const m of numericMatches) {
      if (m.trim().length >= 2) candidates.add(m.trim());
    }
  }

  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

export function findConflictLocateRange(
  content: string,
  opts: {
    excerpt?: string;
    clauseRef?: string;
    focusText?: string;
    dimension?: string;
  }
): LocateRangeResult | null {
  if (!content) return null;

  // 1. Determine the clause / excerpt scope in full content
  let scope: { start: number; end: number } | null = null;
  let exactExcerptRange: { start: number; end: number } | null = null;

  if (opts.excerpt?.trim()) {
    const cleanExcerpt = opts.excerpt.trim();
    exactExcerptRange = findNormalizedRange(content, cleanExcerpt);
    if (!exactExcerptRange && cleanExcerpt.length > 16) {
      // Try shorter chunks of excerpt in case of minor punctuation variance
      const parts = cleanExcerpt
        .split(/[，。；]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 6);
      for (const part of parts) {
        const hit = findNormalizedRange(content, part);
        if (hit) {
          exactExcerptRange = hit;
          break;
        }
      }
    }
    if (exactExcerptRange) {
      scope = expandToClauseSpan(
        content,
        exactExcerptRange.start,
        exactExcerptRange.end
      );
    }
  }

  if (!scope && opts.clauseRef?.trim()) {
    const clauseParts = [
      opts.clauseRef.trim(),
      opts.clauseRef.trim().split(/\s+/)[0] ?? '',
    ].filter((s) => s.length >= 2);
    for (const ref of clauseParts) {
      const refHit = findNormalizedRange(content, ref);
      if (refHit) {
        const paraEnd = content.indexOf('\n\n', refHit.start);
        scope = {
          start: refHit.start,
          end: paraEnd === -1 ? Math.min(content.length, refHit.start + 400) : paraEnd,
        };
        break;
      }
    }
  }

  // 2. Match focusText (e.g., clicked contradiction point value or highlighted token)
  const searchInside = (
    textCandidates: string[],
    from: number,
    to: number
  ): { start: number; end: number } | null => {
    const matchedRanges: Array<{ start: number; end: number }> = [];
    for (const candidate of textCandidates) {
      const hit = findNormalizedRange(content, candidate, from, to);
      if (hit) {
        // If full focusText matched directly, return immediately
        if (candidate === textCandidates[0] && candidate.length >= 4) {
          return hit;
        }
        matchedRanges.push(hit);
      }
    }
    if (matchedRanges.length === 0) return null;
    matchedRanges.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const best = matchedRanges[0];
    // Expand across nearby matched tokens on the same sentence so full threshold/rule is highlighted
    let minStart = best.start;
    let maxEnd = best.end;
    for (const r of matchedRanges.slice(1)) {
      const nextMin = Math.min(minStart, r.start);
      const nextMax = Math.max(maxEnd, r.end);
      if (nextMax - nextMin <= 65 && !content.slice(nextMin, nextMax).includes('\n')) {
        minStart = nextMin;
        maxEnd = nextMax;
      }
    }
    return { start: minStart, end: maxEnd };
  };

  if (opts.focusText?.trim()) {
    const candidates = extractFocusCandidates(opts.focusText);
    if (scope) {
      const inScope = searchInside(candidates, scope.start, scope.end);
      if (inScope) {
        return {
          ...inScope,
          lineNumber: content.slice(0, inScope.start).split('\n').length,
          matchedText: content.slice(inScope.start, inScope.end),
        };
      }
    }
    const globalHit = searchInside(candidates, 0, content.length);
    if (globalHit) {
      return {
        ...globalHit,
        lineNumber: content.slice(0, globalHit.start).split('\n').length,
        matchedText: content.slice(globalHit.start, globalHit.end),
      };
    }
  }

  // 3. Try dimension keywords if focusText didn't yield a direct hit
  if (opts.dimension?.trim() && scope) {
    const dimCandidates = extractFocusCandidates(opts.dimension);
    const dimHit = searchInside(dimCandidates, scope.start, scope.end);
    if (dimHit) {
      return {
        ...dimHit,
        lineNumber: content.slice(0, dimHit.start).split('\n').length,
        matchedText: content.slice(dimHit.start, dimHit.end),
      };
    }
  }

  // 4. Fallback to matched excerpt or clause scope
  const fallback = exactExcerptRange ?? scope;
  if (fallback) {
    return {
      ...fallback,
      lineNumber: content.slice(0, fallback.start).split('\n').length,
      matchedText: content.slice(fallback.start, fallback.end),
    };
  }

  return null;
}
