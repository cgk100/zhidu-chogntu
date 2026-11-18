import mammoth from 'mammoth';
import path from 'path';
import { chunkPolicyContent } from './chunker.ts';
import { extractDocumentMarkdownWithGemini } from './geminiService.ts';
import type {
  EffectiveCycle,
  ParsedUploadFileItem,
  PolicyDocument,
} from '../src/types/policy.ts';

function normalizeTitleForMatch(title: string): string {
  return title
    .replace(/《|》/g, '')
    .replace(/[\s\-_]*(v?\d+(?:\.\d+)+)$/i, '')
    .replace(/[（(][^）)]*[）)]$/g, '')
    .trim()
    .toLowerCase();
}

function inferCategoryAndDepartment(text: string): {
  category: string;
  department: string;
} {
  const sample = text.slice(0, 1200);
  if (/(考勤|病假|年假|员工|试用期|薪酬|福利|休假|入职)/.test(sample)) {
    return { category: '人力资源制度', department: '人力资源部' };
  }
  if (/(差旅|报销|财务|发票|预算|资金|付款|采购|招标)/.test(sample)) {
    return { category: '财务内控制度', department: '财务内控部' };
  }
  if (/(信息安全|远程办公|VPN|密码|终端|权限|数据安全|IT)/.test(sample)) {
    return { category: '信息安全制度', department: '信息安全与IT部' };
  }
  if (/(供应链|供应商|合同|招投标|采购)/.test(sample)) {
    return { category: '采购供应链制度', department: '采购合规部' };
  }
  return { category: '综合管理制度', department: '合规治理部' };
}

function inferTitleAndVersion(
  fileName: string,
  content: string
): { title: string; versionNumber: string } {
  const baseName = path.basename(fileName, path.extname(fileName));

  let versionNumber = 'v1.0';
  const fileVerMatch = baseName.match(/(v\d+(?:\.\d+)+)/i);
  if (fileVerMatch) {
    versionNumber = fileVerMatch[1].toLowerCase();
  } else {
    const contentVerMatch = content.slice(0, 300).match(/(v\d+(?:\.\d+)+)/i);
    if (contentVerMatch) {
      versionNumber = contentVerMatch[1].toLowerCase();
    }
  }

  let title = baseName
    .replace(/[\s\-_]*v?\d+(?:\.\d+)+/gi, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch && headingMatch[1].trim().length >= 3) {
    title = headingMatch[1]
      .replace(/[（(][^）)]*v?\d+(?:\.\d+)+[^）)]*[）)]/gi, '')
      .trim();
  }

  if (!title) {
    title = baseName || '未命名制度文档';
  }

  return { title, versionNumber };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function extractEffectiveDateFromText(
  content: string
): { date: string; source: string } | null {
  const patterns: RegExp[] = [
    /(?:开始生效时间|生效时间|生效日期|实施日期|施行日期|执行日期|启用日期)[：:\s]*(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/,
    /自\s*(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日\s*起?(?:正式)?(?:开始)?(?:生效|施行|实施|执行)/,
    /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?\s*(?:起|正式)(?:开始)?(?:生效|施行|实施|执行)/,
  ];

  for (const regex of patterns) {
    const m = content.match(regex);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (isValidYmd(y, mo, d)) {
        return {
          date: `${y}-${pad2(mo)}-${pad2(d)}`,
          source: m[0].trim(),
        };
      }
    }
  }
  return null;
}

export function extractEffectiveCycleFromText(
  content: string
): { cycle: EffectiveCycle; source: string } | null {
  // 1. Check explicit unclear / indeterminate / open-ended trial language first
  const unclearMatch = content.match(
    /(?:生效周期不明确|有效期不明确|周期不明确|暂未明确有效期|试行期?待定|具体(?:有效期|失效时间|生效周期)另行(?:通知|规定|明确)|暂行[^。\n]{0,12}(?:另行通知|视情况|待定)|本(?:制度|办法|规定|规范)[^。\n]{0,12}(?:暂行|试行)(?![^。\n]{0,12}(?:\d|[一二三四五六半])\s*(?:年|个?月)))/
  );
  if (unclearMatch) {
    return { cycle: 'unclear', source: unclearMatch[0].trim() };
  }

  // 2. Check explicit duration clauses (6 months / 1 / 2 / 3 years)
  const durationPatterns: Array<{ cycle: EffectiveCycle; regex: RegExp }> = [
    {
      cycle: '6_months',
      regex:
        /(?:生效周期|有效期|施行期限|试行期?|复审周期)[为：:\s]*(?:6\s*个?月|六个月|半年)|(?:试行|有效)期?\s*(?:6\s*个?月|六个月|半年)/,
    },
    {
      cycle: '1_year',
      regex:
        /(?:生效周期|有效期|施行期限|试行期?|复审周期)[为：:\s]*(?:1\s*年|一年|12\s*个?月|十二个月)|(?:每年复审一次|一年一审|有效期\s*1\s*年|试行\s*1\s*年)/,
    },
    {
      cycle: '2_years',
      regex:
        /(?:生效周期|有效期|施行期限|试行期?|复审周期)[为：:\s]*(?:2\s*年|两年|二年|24\s*个?月)|(?:有效期\s*[2两二]\s*年|试行\s*[2两二]\s*年)/,
    },
    {
      cycle: '3_years',
      regex:
        /(?:生效周期|有效期|施行期限|试行期?|复审周期)[为：:\s]*(?:3\s*年|三年|36\s*个?月)|(?:有效期\s*[3三]\s*年|试行\s*[3三]\s*年)/,
    },
  ];

  for (const item of durationPatterns) {
    const m = content.match(item.regex);
    if (m) {
      return { cycle: item.cycle, source: m[0].trim() };
    }
  }

  // 3. Check explicit long-term / permanent validity
  const longTermMatch = content.match(
    /(?:生效周期|有效期|施行期限)[为：:\s]*(?:长期有效|长期|永久有效|无固定期限)|(?:长期有效|无固定期限|直至(?:新制度|修订版|废止)(?:发布|出台)?为止)/
  );
  if (longTermMatch) {
    return { cycle: 'long_term', source: longTermMatch[0].trim() };
  }

  return null;
}

export function computeReviewSchedule(
  effectiveDate: string,
  cycle: EffectiveCycle | ''
): { reviewCycleMonths: number; nextReviewDate: string } {
  const monthsMap: Record<EffectiveCycle, number> = {
    '6_months': 6,
    '1_year': 12,
    '2_years': 24,
    '3_years': 36,
    long_term: 0,
    unclear: 0,
  };

  if (!cycle || cycle === 'long_term' || cycle === 'unclear') {
    return { reviewCycleMonths: 0, nextReviewDate: '' };
  }

  const months = monthsMap[cycle];
  if (!effectiveDate) {
    return { reviewCycleMonths: months, nextReviewDate: '' };
  }

  const base = new Date(`${effectiveDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return { reviewCycleMonths: months, nextReviewDate: '' };
  }
  base.setUTCMonth(base.getUTCMonth() + months);
  return {
    reviewCycleMonths: months,
    nextReviewDate: base.toISOString().slice(0, 10),
  };
}

export interface ParseFileProgressEvent {
  stage: 'reading' | 'extracting' | 'chunking';
  detail: string;
  charCount?: number;
  clauseHeadings?: string[];
  matchedTitle?: string;
  effectiveDate?: string;
  effectiveCycle?: EffectiveCycle | '';
}

export async function parseUploadedPolicyFile(
  file: {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
  },
  existingPolicies: PolicyDocument[],
  indexOffset: number,
  onProgress?: (event: ParseFileProgressEvent) => void
): Promise<ParsedUploadFileItem> {
  let decodedName = file.originalname;
  try {
    const maybeUtf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!maybeUtf8.includes('\uFFFD') && maybeUtf8 !== file.originalname) {
      decodedName = maybeUtf8;
    }
  } catch {
    decodedName = file.originalname;
  }

  const ext = path.extname(decodedName).toLowerCase();
  const tempId = `up-${Date.now().toString(36)}-${indexOffset}-${Math.random()
    .toString(36)
    .slice(2, 5)}`;

  try {
    onProgress?.({
      stage: 'reading',
      detail: `已接收 ${file.size.toLocaleString()} 字节（格式：${ext || '文本'}），准备抽取正文与元数据`,
    });

    let extractedContent = '';

    if (['.md', '.markdown', '.txt', '.csv', '.json'].includes(ext)) {
      onProgress?.({
        stage: 'extracting',
        detail: `正在解码 UTF-8 文本并提取生效时间与生效周期...`,
      });
      extractedContent = file.buffer.toString('utf-8').trim();
    } else if (ext === '.docx') {
      onProgress?.({
        stage: 'extracting',
        detail: `正在解析 Word (.docx) 段落结构并提取生效元数据...`,
      });
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      extractedContent = (result.value ?? '').trim();
    } else if (ext === '.pdf') {
      onProgress?.({
        stage: 'extracting',
        detail: `正在调用多模态模型抽取 PDF 版面、条款及生效元数据...`,
      });
      extractedContent = await extractDocumentMarkdownWithGemini(
        file.buffer,
        'application/pdf',
        decodedName
      );
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      onProgress?.({
        stage: 'extracting',
        detail: `正在识别图片扫描件文字与生效日期/周期条款...`,
      });
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg';
      extractedContent = await extractDocumentMarkdownWithGemini(
        file.buffer,
        mime,
        decodedName
      );
    } else {
      throw new Error(
        `暂不支持的文件格式 "${ext || '未知'}"。支持 .md、.txt、.docx、.pdf 及 .png/.jpg 扫描件。`
      );
    }

    if (!extractedContent) {
      throw new Error('文件内容为空，无法解析出有效制度条款。');
    }

    const { title, versionNumber } = inferTitleAndVersion(
      decodedName,
      extractedContent
    );
    const { category, department } = inferCategoryAndDepartment(
      `${title}\n${extractedContent}`
    );

    const extractedDateInfo = extractEffectiveDateFromText(extractedContent);
    const extractedCycleInfo = extractEffectiveCycleFromText(extractedContent);

    const effectiveDate = extractedDateInfo?.date ?? '';
    const effectiveCycle: EffectiveCycle | '' = extractedCycleInfo?.cycle ?? '';
    const schedule = computeReviewSchedule(effectiveDate, effectiveCycle);

    const normalizedNew = normalizeTitleForMatch(title);
    const matched = existingPolicies.find(
      (p) => normalizeTitleForMatch(p.title) === normalizedNew
    );

    const chunks = chunkPolicyContent('preview', 'preview-v', extractedContent);
    const clauseHeadings = chunks
      .map((c) => c.clauseRef || c.heading)
      .filter(Boolean);

    const metaHint = [
      effectiveDate ? `生效日 ${effectiveDate}` : '未提取到生效时间',
      effectiveCycle ? `周期已识别` : '未提取到生效周期',
    ].join(' · ');

    onProgress?.({
      stage: 'chunking',
      detail: `已抽取 ${extractedContent.length.toLocaleString()} 字符，切分 ${chunks.length} 个条款（${metaHint}）${
        matched ? ` · 匹配已有制度《${matched.title}》` : ''
      }`,
      charCount: extractedContent.length,
      clauseHeadings: clauseHeadings.slice(0, 6),
      matchedTitle: matched?.title,
      effectiveDate,
      effectiveCycle,
    });

    let suggestedVersion = versionNumber;
    if (matched && suggestedVersion === 'v1.0') {
      const curVer =
        matched.versions.find((v) => v.id === matched.currentVersionId) ??
        matched.versions[matched.versions.length - 1];
      const m = curVer?.versionNumber.match(/^v?(\d+)\.(\d+)$/i);
      if (m) {
        suggestedVersion = `v${m[1]}.${Number(m[2]) + 1}`;
      }
    }

    return {
      tempId,
      fileName: decodedName,
      fileSize: file.size,
      title: matched ? matched.title : title,
      code: matched
        ? matched.code
        : `POL-${String(existingPolicies.length + indexOffset + 1).padStart(3, '0')}`,
      category: matched ? matched.category : category,
      department: matched ? matched.department : department,
      owner: matched ? matched.owner : '管理员',
      versionNumber: suggestedVersion,
      effectiveDate,
      effectiveDateExtracted: Boolean(extractedDateInfo),
      effectiveDateSource: extractedDateInfo?.source,
      effectiveCycle,
      effectiveCycleExtracted: Boolean(extractedCycleInfo),
      effectiveCycleSource: extractedCycleInfo?.source,
      nextReviewDate: schedule.nextReviewDate,
      changeSummary: matched
        ? `通过文件 ${decodedName} 批量导入修订版`
        : `通过文件 ${decodedName} 导入入库`,
      content: extractedContent,
      chunkCount: chunks.length,
      clauseHeadings: clauseHeadings.slice(0, 8),
      mode: matched ? 'new_version' : 'new_policy',
      matchedExistingPolicyId: matched?.id,
      matchedExistingPolicyTitle: matched?.title,
    };
  } catch (err) {
    return {
      tempId,
      fileName: decodedName,
      fileSize: file.size,
      title: path.basename(decodedName, ext),
      code: `POL-${String(existingPolicies.length + indexOffset + 1).padStart(3, '0')}`,
      category: '综合管理制度',
      department: '合规治理部',
      owner: '管理员',
      versionNumber: 'v1.0',
      effectiveDate: '',
      effectiveDateExtracted: false,
      effectiveCycle: '',
      effectiveCycleExtracted: false,
      nextReviewDate: '',
      changeSummary: '',
      content: '',
      chunkCount: 0,
      mode: 'new_policy',
      parseError: err instanceof Error ? err.message : '文件解析失败',
    };
  }
}
