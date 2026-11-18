import type { PolicyChunk } from '../src/types/policy.ts';

/**
 * Splits Chinese corporate policy text into clause-level chunks for RAG retrieval and conflict detection.
 */
export function chunkPolicyContent(
  policyId: string,
  versionId: string,
  content: string
): PolicyChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: PolicyChunk[] = [];

  let currentHeading = '总则';
  let currentClauseRef = '前言';
  let buffer: string[] = [];

  const flushBuffer = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      chunks.push({
        id: `${versionId}-chunk-${chunks.length + 1}`,
        policyId,
        versionId,
        clauseRef: currentClauseRef,
        heading: currentHeading,
        content: text,
      });
    }
    buffer = [];
  };

  const clausePattern = /^(?:第[一二三四五六七八九十百零\d]+条(?:\s+.*)?|#{2,3}\s+第[一二三四五六七八九十百零\d]+条.*)$/;
  const sectionPattern = /^#{1,3}\s+(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (buffer.length > 0) {
        buffer.push('');
      }
      continue;
    }

    const cleanedHeader = line.replace(/^#{1,3}\s+/, '').trim();
    const clauseMatch = cleanedHeader.match(/^(第[一二三四五六七八九十百零\d]+条)\s*(.*)$/);

    if (clausePattern.test(line) || clauseMatch) {
      flushBuffer();
      if (clauseMatch) {
        currentClauseRef = clauseMatch[1];
        currentHeading = clauseMatch[2] ? `${clauseMatch[1]} ${clauseMatch[2]}` : clauseMatch[1];
      } else {
        currentClauseRef = cleanedHeader.slice(0, 24);
        currentHeading = cleanedHeader;
      }
      buffer.push(cleanedHeader);
    } else if (sectionPattern.test(line)) {
      flushBuffer();
      const sectionTitle = line.replace(/^#{1,3}\s+/, '').trim();
      currentHeading = sectionTitle;
      currentClauseRef = sectionTitle.slice(0, 24);
      buffer.push(sectionTitle);
    } else {
      buffer.push(line);
    }
  }

  flushBuffer();

  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      id: `${versionId}-chunk-1`,
      policyId,
      versionId,
      clauseRef: '全文',
      heading: '正文条款',
      content: content.trim(),
    });
  }

  return chunks;
}
