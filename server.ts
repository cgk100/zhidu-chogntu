import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { diffLines } from 'diff';
import { createServer as createViteServer } from 'vite';
import { chunkPolicyContent } from './server/chunker.ts';
import {
  computeReviewSchedule,
  extractEffectiveCycleFromText,
  extractEffectiveDateFromText,
  parseUploadedPolicyFile,
} from './server/fileParser.ts';
import { createInitialStoreState } from './server/seedData.ts';
import {
  analyzeVersionDiff,
  answerPolicyQuery,
  detectPolicyConflicts,
  draftConflictResolution,
  ensureChunkEmbeddings,
  extractKnowledgeGraphWithGemini,
  testLlmConnection,
} from './server/geminiService.ts';
import {
  getLlmSettingsPublic,
  resetLlmSettings,
  saveLlmSettings,
} from './server/settingsStore.ts';
import { LLM_PROVIDER_CATALOG } from './src/utils/llmProviders.ts';
import {
  evaluateAlertRules,
  loadStore,
  mergeDetectedConflicts,
  refreshKnowledgeGraph,
  saveStore,
} from './server/store.ts';
import type {
  AlertItem,
  BatchImportStreamEvent,
  DiffLineItem,
  EffectiveCycle,
  LlmSettingsInput,
  ParsedUploadFileItem,
  PolicyChunk,
  PolicyDocument,
  PolicyVersion,
  StoreState,
  UploadParseStreamEvent,
} from './src/types/policy.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB per file
    files: 20,
  },
});

function sanitizeStateForClient(state: StoreState): StoreState {
  return {
    ...state,
    policies: state.policies.map((p) => ({
      ...p,
      versions: p.versions.map((v) => ({
        ...v,
        chunks: v.chunks.map(({ embedding: _emb, ...rest }) => rest),
      })),
    })),
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/state', (_req, res) => {
    const state = loadStore();
    res.json(sanitizeStateForClient(state));
  });

  app.get('/api/settings', (_req, res) => {
    res.json({
      settings: getLlmSettingsPublic(),
      providers: LLM_PROVIDER_CATALOG,
    });
  });

  app.put('/api/settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as LlmSettingsInput;
      const settings = saveLlmSettings(body);
      res.json({ settings });
    } catch (err) {
      res.status(400).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/settings/test', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<LlmSettingsInput>;
      const result = await testLlmConnection(body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/settings/reset', (_req, res) => {
    const settings = resetLlmSettings();
    res.json({ settings });
  });

  app.post('/api/reset-demo', (_req, res) => {
    const fresh = createInitialStoreState();
    refreshKnowledgeGraph(fresh);
    saveStore(fresh);
    res.json(sanitizeStateForClient(fresh));
  });

  app.post('/api/rag/query', async (req, res) => {
    try {
      const { query, history } = req.body as {
        query?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      };
      if (!query || !query.trim()) {
        res.status(400).json({ error: '请输入查询问题。' });
        return;
      }
      const state = loadStore();
      const result = await answerPolicyQuery(
        query.trim(),
        state.policies,
        state.conflicts,
        Array.isArray(history) ? history : [],
        state.knowledgeGraph
      );
      saveStore(state); // Persist any newly cached embeddings
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/graph/rebuild', async (_req, res) => {
    try {
      const state = loadStore();
      const graph = await extractKnowledgeGraphWithGemini(
        state.policies,
        state.conflicts
      );
      state.knowledgeGraph = graph;
      saveStore(state);
      res.json({
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        communityCount: graph.communities.length,
        builtBy: graph.builtBy,
        state: sanitizeStateForClient(state),
      });
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/policies/extract-metadata', (req, res) => {
    const { content } = (req.body ?? {}) as { content?: string };
    const text = (content ?? '').trim();
    const dateInfo = text ? extractEffectiveDateFromText(text) : null;
    const cycleInfo = text ? extractEffectiveCycleFromText(text) : null;
    res.json({
      effectiveDate: dateInfo?.date ?? '',
      effectiveDateExtracted: Boolean(dateInfo),
      effectiveDateSource: dateInfo?.source,
      effectiveCycle: cycleInfo?.cycle ?? '',
      effectiveCycleExtracted: Boolean(cycleInfo),
      effectiveCycleSource: cycleInfo?.source,
    });
  });

  app.post('/api/policies', async (req, res) => {
    try {
      const body = req.body as {
        code?: string;
        title?: string;
        category?: string;
        department?: string;
        owner?: string;
        versionNumber?: string;
        effectiveDate?: string;
        effectiveCycle?: EffectiveCycle | '';
        effectiveCycleNote?: string;
        nextReviewDate?: string;
        reviewCycleMonths?: number;
        changeSummary?: string;
        content?: string;
        autoScan?: boolean;
      };

      if (!body.title?.trim() || !body.content?.trim()) {
        res.status(400).json({ error: '制度名称与制度正文不能为空。' });
        return;
      }

      const contentText = body.content.trim();
      const extractedDate = extractEffectiveDateFromText(contentText);
      const extractedCycle = extractEffectiveCycleFromText(contentText);

      const effectiveDate = body.effectiveDate?.trim() || extractedDate?.date || '';
      const effectiveCycle: EffectiveCycle | '' =
        body.effectiveCycle || extractedCycle?.cycle || '';

      if (!effectiveDate) {
        res.status(400).json({ error: '未能从正文提取到“开始生效时间”，请先选择开始生效日期。' });
        return;
      }
      if (!effectiveCycle) {
        res.status(400).json({ error: '未能从正文提取到“生效周期”，请选择生效周期（含“周期不明确”）。' });
        return;
      }

      const schedule = computeReviewSchedule(effectiveDate, effectiveCycle);

      const state = loadStore();
      const nowIso = new Date().toISOString();
      const policyId = `pol-${Date.now().toString(36)}`;
      const versionId = `ver-${Date.now().toString(36)}`;
      const versionNumber = body.versionNumber?.trim() || 'v1.0';
      const chunks = chunkPolicyContent(policyId, versionId, contentText);
      const cycleNote = body.effectiveCycleNote?.trim() || extractedCycle?.source;

      const newPolicy: PolicyDocument = {
        id: policyId,
        code: body.code?.trim() || `POL-${String(state.policies.length + 1).padStart(3, '0')}`,
        title: body.title.trim(),
        category: body.category?.trim() || '综合管理制度',
        department: body.department?.trim() || '合规治理部',
        owner: body.owner?.trim() || '管理员',
        status: 'active',
        currentVersionId: versionId,
        effectiveDate,
        effectiveCycle,
        effectiveCycleNote: cycleNote,
        reviewCycleMonths: body.reviewCycleMonths ?? schedule.reviewCycleMonths,
        nextReviewDate: body.nextReviewDate?.trim() ?? schedule.nextReviewDate,
        updatedAt: nowIso,
        versions: [
          {
            id: versionId,
            versionNumber,
            effectiveDate,
            effectiveCycle,
            effectiveCycleNote: cycleNote,
            createdAt: nowIso,
            author: body.owner?.trim() || '管理员',
            changeSummary: body.changeSummary?.trim() || '新制度文档入库发布。',
            content: contentText,
            chunks,
          },
        ],
      };

      state.policies.unshift(newPolicy);

      // Best effort embeddings
      try {
        await ensureChunkEmbeddings(chunks);
      } catch {
        // Non-blocking if embedding quota/key unavailable on upload
      }

      let addedConflicts = 0;
      let scanWarning: string | undefined;
      if (body.autoScan !== false) {
        try {
          const detected = await detectPolicyConflicts(state.policies, policyId);
          const merged = mergeDetectedConflicts(state, detected);
          addedConflicts = merged.added.length;
        } catch (scanErr) {
          scanWarning = `制度已入库，但自动冲突扫描未能完成：${getErrorMessage(scanErr)}`;
        }
      }

      refreshKnowledgeGraph(state);
      saveStore(state);
      res.status(201).json({
        policy: sanitizeStateForClient(state).policies.find((p) => p.id === policyId),
        addedConflicts,
        scanWarning,
        state: sanitizeStateForClient(state),
      });
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post(
    '/api/policies/parse-files',
    upload.array('files', 20),
    async (req, res) => {
      try {
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (files.length === 0) {
          res.status(400).json({ error: '请至少选择一个文件上传。' });
          return;
        }
        const state = loadStore();
        const parsed: ParsedUploadFileItem[] = [];
        for (let i = 0; i < files.length; i++) {
          const item = await parseUploadedPolicyFile(files[i], state.policies, i);
          parsed.push(item);
        }
        res.json({ files: parsed });
      } catch (err) {
        res.status(500).json({ error: getErrorMessage(err) });
      }
    }
  );

  app.post('/api/policies/batch-import', async (req, res) => {
    try {
      const { items, autoScan } = req.body as {
        items?: ParsedUploadFileItem[];
        autoScan?: boolean;
      };
      if (!items || items.length === 0) {
        res.status(400).json({ error: '没有可入库的制度文件。' });
        return;
      }

      const validItems = items.filter(
        (it) => !it.parseError && it.title.trim() && it.content.trim()
      );
      if (validItems.length === 0) {
        res.status(400).json({ error: '所选文件均缺少有效正文，无法入库。' });
        return;
      }

      const missingMeta = validItems.find(
        (it) => !it.effectiveDate?.trim() || !it.effectiveCycle
      );
      if (missingMeta) {
        res.status(400).json({
          error: `《${missingMeta.title}》缺少“开始生效时间”或“生效周期”，请先补全选择（如周期未确定可选择“周期不明确”）。`,
        });
        return;
      }

      const state = loadStore();
      const nowIso = new Date().toISOString();
      const allNewChunks: PolicyChunk[] = [];
      let importedPoliciesCount = 0;
      let updatedVersionsCount = 0;

      const impactRule = state.alertRules.find(
        (r) => r.triggerType === 'version_impact' && r.enabled
      );

      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        const tsSuffix = `${Date.now().toString(36)}-${i}`;
        const effDate = item.effectiveDate.trim();
        const effCycle = item.effectiveCycle as EffectiveCycle;
        const schedule = computeReviewSchedule(effDate, effCycle);

        if (item.mode === 'new_version' && item.matchedExistingPolicyId) {
          const targetPolicy = state.policies.find(
            (p) => p.id === item.matchedExistingPolicyId
          );
          if (targetPolicy) {
            const versionId = `ver-${tsSuffix}`;
            const chunks = chunkPolicyContent(
              targetPolicy.id,
              versionId,
              item.content.trim()
            );
            allNewChunks.push(...chunks);

            const newVer: PolicyVersion = {
              id: versionId,
              versionNumber: item.versionNumber.trim() || 'v1.1',
              effectiveDate: effDate,
              effectiveCycle: effCycle,
              effectiveCycleNote: item.effectiveCycleSource,
              createdAt: nowIso,
              author: item.owner.trim() || targetPolicy.owner,
              changeSummary:
                item.changeSummary.trim() || `通过文件 ${item.fileName} 批量修订`,
              content: item.content.trim(),
              chunks,
            };

            targetPolicy.versions.push(newVer);
            targetPolicy.currentVersionId = versionId;
            targetPolicy.effectiveDate = effDate;
            targetPolicy.effectiveCycle = effCycle;
            targetPolicy.effectiveCycleNote = item.effectiveCycleSource;
            targetPolicy.reviewCycleMonths = schedule.reviewCycleMonths;
            targetPolicy.nextReviewDate = schedule.nextReviewDate;
            targetPolicy.updatedAt = nowIso;
            updatedVersionsCount++;

            if (impactRule) {
              state.alerts.unshift({
                id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: 'version_impact',
                severity: 'info',
                title: `批量修订通知：《${targetPolicy.title}》已升级至 ${newVer.versionNumber}`,
                message: `来源文件：${item.fileName}。${newVer.changeSummary}`,
                targetDepartment: targetPolicy.department,
                relatedPolicyId: targetPolicy.id,
                createdAt: nowIso,
                read: false,
                acknowledged: false,
              });
              impactRule.lastTriggeredAt = nowIso;
            }
            continue;
          }
        }

        const policyId = `pol-${tsSuffix}`;
        const versionId = `ver-${tsSuffix}`;
        const chunks = chunkPolicyContent(policyId, versionId, item.content.trim());
        allNewChunks.push(...chunks);

        const newPolicy: PolicyDocument = {
          id: policyId,
          code:
            item.code.trim() ||
            `POL-${String(state.policies.length + 1).padStart(3, '0')}`,
          title: item.title.trim(),
          category: item.category.trim() || '综合管理制度',
          department: item.department.trim() || '合规治理部',
          owner: item.owner.trim() || '管理员',
          status: 'active',
          currentVersionId: versionId,
          effectiveDate: effDate,
          effectiveCycle: effCycle,
          effectiveCycleNote: item.effectiveCycleSource,
          reviewCycleMonths: schedule.reviewCycleMonths,
          nextReviewDate: schedule.nextReviewDate,
          updatedAt: nowIso,
          versions: [
            {
              id: versionId,
              versionNumber: item.versionNumber.trim() || 'v1.0',
              effectiveDate: effDate,
              effectiveCycle: effCycle,
              effectiveCycleNote: item.effectiveCycleSource,
              createdAt: nowIso,
              author: item.owner.trim() || '管理员',
              changeSummary:
                item.changeSummary.trim() || `通过文件 ${item.fileName} 批量导入`,
              content: item.content.trim(),
              chunks,
            },
          ],
        };

        state.policies.unshift(newPolicy);
        importedPoliciesCount++;
      }

      try {
        await ensureChunkEmbeddings(allNewChunks);
      } catch {
        // Non-blocking embedding best effort
      }

      let addedConflicts = 0;
      let scanWarning: string | undefined;
      if (autoScan !== false) {
        try {
          const detected = await detectPolicyConflicts(state.policies);
          const merged = mergeDetectedConflicts(state, detected);
          addedConflicts = merged.added.length;
        } catch (scanErr) {
          scanWarning = `批量文件已入库，但自动冲突扫描未能完成：${getErrorMessage(scanErr)}`;
        }
      }

      refreshKnowledgeGraph(state);
      saveStore(state);
      res.status(201).json({
        importedPoliciesCount,
        updatedVersionsCount,
        addedConflicts,
        scanWarning,
        state: sanitizeStateForClient(state),
      });
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post(
    '/api/policies/parse-files-stream',
    upload.array('files', 20),
    async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: '请至少选择一个文件上传。' });
        return;
      }

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const writeEvent = (evt: UploadParseStreamEvent) => {
        res.write(`${JSON.stringify(evt)}\n`);
      };

      try {
        const state = loadStore();
        for (let i = 0; i < files.length; i++) {
          const startedAt = Date.now();
          const rawFile = files[i];
          const item = await parseUploadedPolicyFile(
            rawFile,
            state.policies,
            i,
            (progress) => {
              writeEvent({
                type: 'stage',
                stage: progress.stage,
                fileName: rawFile.originalname,
                fileSize: rawFile.size,
                detail: progress.detail,
                charCount: progress.charCount,
                clauseHeadings: progress.clauseHeadings,
                matchedTitle: progress.matchedTitle,
                effectiveDate: progress.effectiveDate,
                effectiveCycle: progress.effectiveCycle,
                elapsedMs: Date.now() - startedAt,
              });
            }
          );

          writeEvent({
            type: 'stage',
            stage: item.parseError ? 'error' : 'parsed',
            fileName: item.fileName,
            fileSize: item.fileSize,
            detail: item.parseError
              ? `解析失败：${item.parseError}`
              : `已完成解析：《${item.title}》 ${item.versionNumber} · ${item.chunkCount} 个条款`,
            charCount: item.content.length,
            clauseHeadings: item.clauseHeadings,
            matchedTitle: item.matchedExistingPolicyTitle,
            effectiveDate: item.effectiveDate,
            effectiveCycle: item.effectiveCycle,
            elapsedMs: Date.now() - startedAt,
            file: item,
          });
        }
      } catch (err) {
        writeEvent({
          type: 'stage',
          stage: 'error',
          fileName: files[0]?.originalname ?? '未知文件',
          detail: getErrorMessage(err),
        });
      } finally {
        res.end();
      }
    }
  );

  app.post('/api/policies/batch-import-stream', async (req, res) => {
    const { items, autoScan } = req.body as {
      items?: ParsedUploadFileItem[];
      autoScan?: boolean;
    };
    if (!items || items.length === 0) {
      res.status(400).json({ error: '没有可入库的制度文件。' });
      return;
    }

    const validItems = items.filter(
      (it) => !it.parseError && it.title.trim() && it.content.trim()
    );
    if (validItems.length === 0) {
      res.status(400).json({ error: '所选文件均缺少有效正文，无法入库。' });
      return;
    }

    const missingMeta = validItems.find(
      (it) => !it.effectiveDate?.trim() || !it.effectiveCycle
    );
    if (missingMeta) {
      res.status(400).json({
        error: `《${missingMeta.title}》缺少“开始生效时间”或“生效周期”，请先补全选择（如周期未确定可选择“周期不明确”）。`,
      });
      return;
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (evt: BatchImportStreamEvent) => {
      res.write(`${JSON.stringify(evt)}\n`);
    };

    try {
      const state = loadStore();
      const nowIso = new Date().toISOString();
      const allNewChunks: PolicyChunk[] = [];
      const clauseHeadingSample: string[] = [];
      let importedPoliciesCount = 0;
      let updatedVersionsCount = 0;

      // Stage 1: Ingest & Chunking
      const ingestStart = Date.now();
      writeEvent({
        type: 'stage',
        stage: 'ingest',
        status: 'running',
        detail: `正在校验并切分 ${validItems.length} 份制度文档条款...`,
      });

      const impactRule = state.alertRules.find(
        (r) => r.triggerType === 'version_impact' && r.enabled
      );

      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        const tsSuffix = `${Date.now().toString(36)}-${i}`;
        const effDate = item.effectiveDate.trim();
        const effCycle = item.effectiveCycle as EffectiveCycle;
        const schedule = computeReviewSchedule(effDate, effCycle);

        if (item.mode === 'new_version' && item.matchedExistingPolicyId) {
          const targetPolicy = state.policies.find(
            (p) => p.id === item.matchedExistingPolicyId
          );
          if (targetPolicy) {
            const versionId = `ver-${tsSuffix}`;
            const chunks = chunkPolicyContent(
              targetPolicy.id,
              versionId,
              item.content.trim()
            );
            allNewChunks.push(...chunks);
            for (const c of chunks) {
              if (clauseHeadingSample.length < 8) {
                clauseHeadingSample.push(c.clauseRef || c.heading);
              }
            }

            const newVer: PolicyVersion = {
              id: versionId,
              versionNumber: item.versionNumber.trim() || 'v1.1',
              effectiveDate: effDate,
              effectiveCycle: effCycle,
              effectiveCycleNote: item.effectiveCycleSource,
              createdAt: nowIso,
              author: item.owner.trim() || targetPolicy.owner,
              changeSummary:
                item.changeSummary.trim() || `通过文件 ${item.fileName} 批量修订`,
              content: item.content.trim(),
              chunks,
            };

            targetPolicy.versions.push(newVer);
            targetPolicy.currentVersionId = versionId;
            targetPolicy.effectiveDate = effDate;
            targetPolicy.effectiveCycle = effCycle;
            targetPolicy.effectiveCycleNote = item.effectiveCycleSource;
            targetPolicy.reviewCycleMonths = schedule.reviewCycleMonths;
            targetPolicy.nextReviewDate = schedule.nextReviewDate;
            targetPolicy.updatedAt = nowIso;
            updatedVersionsCount++;

            if (impactRule) {
              state.alerts.unshift({
                id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: 'version_impact',
                severity: 'info',
                title: `批量修订通知：《${targetPolicy.title}》已升级至 ${newVer.versionNumber}`,
                message: `来源文件：${item.fileName}。${newVer.changeSummary}`,
                targetDepartment: targetPolicy.department,
                relatedPolicyId: targetPolicy.id,
                createdAt: nowIso,
                read: false,
                acknowledged: false,
              });
              impactRule.lastTriggeredAt = nowIso;
            }
            continue;
          }
        }

        const policyId = `pol-${tsSuffix}`;
        const versionId = `ver-${tsSuffix}`;
        const chunks = chunkPolicyContent(policyId, versionId, item.content.trim());
        allNewChunks.push(...chunks);
        for (const c of chunks) {
          if (clauseHeadingSample.length < 8) {
            clauseHeadingSample.push(c.clauseRef || c.heading);
          }
        }

        const newPolicy: PolicyDocument = {
          id: policyId,
          code:
            item.code.trim() ||
            `POL-${String(state.policies.length + 1).padStart(3, '0')}`,
          title: item.title.trim(),
          category: item.category.trim() || '综合管理制度',
          department: item.department.trim() || '合规治理部',
          owner: item.owner.trim() || '管理员',
          status: 'active',
          currentVersionId: versionId,
          effectiveDate: effDate,
          effectiveCycle: effCycle,
          effectiveCycleNote: item.effectiveCycleSource,
          reviewCycleMonths: schedule.reviewCycleMonths,
          nextReviewDate: schedule.nextReviewDate,
          updatedAt: nowIso,
          versions: [
            {
              id: versionId,
              versionNumber: item.versionNumber.trim() || 'v1.0',
              effectiveDate: effDate,
              effectiveCycle: effCycle,
              effectiveCycleNote: item.effectiveCycleSource,
              createdAt: nowIso,
              author: item.owner.trim() || '管理员',
              changeSummary:
                item.changeSummary.trim() || `通过文件 ${item.fileName} 批量导入`,
              content: item.content.trim(),
              chunks,
            },
          ],
        };

        state.policies.unshift(newPolicy);
        importedPoliciesCount++;
      }

      writeEvent({
        type: 'stage',
        stage: 'ingest',
        status: 'done',
        elapsedMs: Date.now() - ingestStart,
        detail: `已写入 ${importedPoliciesCount} 份新制度、${updatedVersionsCount} 份版本更新，共切分 ${allNewChunks.length} 个条款`,
        metrics: {
          policiesCount: importedPoliciesCount + updatedVersionsCount,
          chunksCount: allNewChunks.length,
          clauseHeadings: clauseHeadingSample,
        },
      });

      // Stage 2: Embeddings
      const embedStart = Date.now();
      writeEvent({
        type: 'stage',
        stage: 'embeddings',
        status: 'running',
        detail: `正在调用 gemini-embedding-2 生成 ${allNewChunks.length} 个条款的语义向量...`,
        metrics: {
          completedEmbeddings: 0,
          totalEmbeddings: allNewChunks.length,
        },
      });

      try {
        let lastDim: number | undefined;
        await ensureChunkEmbeddings(allNewChunks, (completed, total, dimensions) => {
          lastDim = dimensions ?? lastDim;
          writeEvent({
            type: 'stage',
            stage: 'embeddings',
            status: completed >= total ? 'done' : 'running',
            elapsedMs: Date.now() - embedStart,
            detail:
              completed >= total
                ? `已完成 ${completed} / ${total} 条款的${lastDim ? ` ${lastDim} 维` : ''}向量语义索引`
                : `正在写入语义向量索引：${completed} / ${total} 条款`,
            metrics: {
              completedEmbeddings: completed,
              totalEmbeddings: total,
              dimensions: lastDim,
            },
          });
        });
      } catch (embedErr) {
        writeEvent({
          type: 'stage',
          stage: 'embeddings',
          status: 'warning',
          elapsedMs: Date.now() - embedStart,
          detail: `语义向量索引暂不可用（将使用图谱+词法混合检索）：${getErrorMessage(embedErr)}`,
          metrics: {
            completedEmbeddings: 0,
            totalEmbeddings: allNewChunks.length,
          },
        });
      }

      // Stage 3: Knowledge Graph Update
      const graphStart = Date.now();
      const prevNodeIds = new Set((state.knowledgeGraph?.nodes ?? []).map((n) => n.id));
      const prevEdgeCount = state.knowledgeGraph?.edges.length ?? 0;

      writeEvent({
        type: 'stage',
        stage: 'graph',
        status: 'running',
        detail: '正在抽取制度实体节点、审批角色、数值规则与关系连线...',
      });

      refreshKnowledgeGraph(state);
      const nextGraph = state.knowledgeGraph!;
      const newNodes = nextGraph.nodes.filter((n) => !prevNodeIds.has(n.id));
      const addedNodesCount = newNodes.length;
      const addedEdgesCount = Math.max(0, nextGraph.edges.length - prevEdgeCount);
      const sampleEntities = newNodes
        .filter((n) => n.type !== 'policy')
        .slice(0, 6)
        .map((n) => n.label);

      writeEvent({
        type: 'stage',
        stage: 'graph',
        status: 'done',
        elapsedMs: Date.now() - graphStart,
        detail: `知识图谱已同步：总计 ${nextGraph.nodes.length} 个节点（新增 ${addedNodesCount}）、${nextGraph.edges.length} 条关系边（新增 ${addedEdgesCount}）`,
        metrics: {
          addedNodes: addedNodesCount,
          addedEdges: addedEdgesCount,
          totalNodes: nextGraph.nodes.length,
          totalEdges: nextGraph.edges.length,
          sampleEntities,
        },
      });

      // Stage 4: Conflict Detection
      let addedConflicts = 0;
      let scanWarning: string | undefined;
      if (autoScan !== false) {
        const scanStart = Date.now();
        const activeCount = state.policies.filter((p) => p.status !== 'archived').length;
        writeEvent({
          type: 'stage',
          stage: 'conflicts',
          status: 'running',
          detail: `正在对全库 ${activeCount} 份现行制度执行跨文档矛盾与红线扫描...`,
        });

        try {
          const detected = await detectPolicyConflicts(state.policies);
          const merged = mergeDetectedConflicts(state, detected);
          addedConflicts = merged.added.length;
          refreshKnowledgeGraph(state);
          writeEvent({
            type: 'stage',
            stage: 'conflicts',
            status: 'done',
            elapsedMs: Date.now() - scanStart,
            detail:
              addedConflicts > 0
                ? `扫描完成：共核验 ${detected.length} 处疑似点，新增 ${addedConflicts} 项待处理冲突并更新图谱冲突边`
                : `扫描完成：共核验 ${activeCount} 份制度，未发现新增条款矛盾`,
            metrics: {
              detectedConflicts: detected.length,
              addedConflicts,
              conflictTitles: merged.added.map((c) => c.title),
            },
          });
        } catch (scanErr) {
          scanWarning = `批量文件已入库，但自动冲突扫描未能完成：${getErrorMessage(scanErr)}`;
          writeEvent({
            type: 'stage',
            stage: 'conflicts',
            status: 'warning',
            elapsedMs: Date.now() - scanStart,
            detail: scanWarning,
            metrics: {
              detectedConflicts: 0,
              addedConflicts: 0,
            },
          });
        }
      } else {
        writeEvent({
          type: 'stage',
          stage: 'conflicts',
          status: 'skipped',
          detail: '已按设置跳过入库后自动冲突扫描',
          metrics: { detectedConflicts: 0, addedConflicts: 0 },
        });
      }

      saveStore(state);
      writeEvent({
        type: 'complete',
        result: {
          importedPoliciesCount,
          updatedVersionsCount,
          addedConflicts,
          scanWarning,
          state: sanitizeStateForClient(state),
        },
      });
    } catch (err) {
      writeEvent({
        type: 'error',
        error: getErrorMessage(err),
      });
    } finally {
      res.end();
    }
  });

  app.post('/api/policies/:id/versions', async (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as {
        versionNumber?: string;
        effectiveDate?: string;
        effectiveCycle?: EffectiveCycle | '';
        effectiveCycleNote?: string;
        author?: string;
        changeSummary?: string;
        content?: string;
        autoScan?: boolean;
      };

      const state = loadStore();
      const policy = state.policies.find((p) => p.id === id);
      if (!policy) {
        res.status(404).json({ error: '未找到指定制度文档。' });
        return;
      }
      if (!body.content?.trim() || !body.versionNumber?.trim()) {
        res.status(400).json({ error: '版本号与修订正文不能为空。' });
        return;
      }

      const contentText = body.content.trim();
      const extractedDate = extractEffectiveDateFromText(contentText);
      const extractedCycle = extractEffectiveCycleFromText(contentText);
      const effectiveDate = body.effectiveDate?.trim() || extractedDate?.date || '';
      const effectiveCycle: EffectiveCycle | '' =
        body.effectiveCycle || extractedCycle?.cycle || '';

      if (!effectiveDate) {
        res.status(400).json({ error: '未能从正文提取到“开始生效时间”，请先选择开始生效日期。' });
        return;
      }
      if (!effectiveCycle) {
        res.status(400).json({ error: '未能从正文提取到“生效周期”，请选择生效周期（含“周期不明确”）。' });
        return;
      }

      const schedule = computeReviewSchedule(effectiveDate, effectiveCycle);
      const nowIso = new Date().toISOString();
      const versionId = `ver-${Date.now().toString(36)}`;
      const chunks = chunkPolicyContent(policy.id, versionId, contentText);
      const cycleNote = body.effectiveCycleNote?.trim() || extractedCycle?.source;

      const newVersion: PolicyVersion = {
        id: versionId,
        versionNumber: body.versionNumber.trim(),
        effectiveDate,
        effectiveCycle,
        effectiveCycleNote: cycleNote,
        createdAt: nowIso,
        author: body.author?.trim() || policy.owner,
        changeSummary: body.changeSummary?.trim() || '版本修订发布。',
        content: contentText,
        chunks,
      };

      policy.versions.push(newVersion);
      policy.currentVersionId = versionId;
      policy.effectiveDate = effectiveDate;
      policy.effectiveCycle = effectiveCycle;
      policy.effectiveCycleNote = cycleNote;
      policy.reviewCycleMonths = schedule.reviewCycleMonths;
      policy.nextReviewDate = schedule.nextReviewDate;
      policy.updatedAt = nowIso;

      // Trigger version_impact automated alert
      const impactRule = state.alertRules.find(
        (r) => r.triggerType === 'version_impact' && r.enabled
      );
      if (impactRule) {
        const impactAlert: AlertItem = {
          id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'version_impact',
          severity: 'info',
          title: `版本更新通知：《${policy.title}》已发布 ${newVersion.versionNumber}`,
          message: `修订摘要：${newVersion.changeSummary}。请关联业务部门及时核对下游援引条款与执行细则。`,
          targetDepartment: policy.department,
          relatedPolicyId: policy.id,
          createdAt: nowIso,
          read: false,
          acknowledged: false,
        };
        state.alerts.unshift(impactAlert);
        impactRule.lastTriggeredAt = nowIso;
      }

      try {
        await ensureChunkEmbeddings(chunks);
      } catch {
        // Non-blocking
      }

      let addedConflicts = 0;
      let scanWarning: string | undefined;
      if (body.autoScan !== false) {
        try {
          const detected = await detectPolicyConflicts(state.policies, policy.id);
          const merged = mergeDetectedConflicts(state, detected);
          addedConflicts = merged.added.length;
        } catch (scanErr) {
          scanWarning = `新版本已发布，但自动冲突扫描未完成：${getErrorMessage(scanErr)}`;
        }
      }

      refreshKnowledgeGraph(state);
      saveStore(state);
      res.status(201).json({
        versionId,
        addedConflicts,
        scanWarning,
        state: sanitizeStateForClient(state),
      });
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/conflicts/scan', async (req, res) => {
    try {
      const { focusPolicyId } = (req.body ?? {}) as { focusPolicyId?: string };
      const state = loadStore();
      const detected = await detectPolicyConflicts(state.policies, focusPolicyId);
      const { added, totalOpen } = mergeDetectedConflicts(state, detected);
      res.json({
        detectedCount: detected.length,
        newlyAddedCount: added.length,
        totalOpen,
        state: sanitizeStateForClient(state),
      });
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.patch('/api/conflicts/:id', (req, res) => {
    const { id } = req.params;
    const { status, resolutionNote } = req.body as {
      status?: 'open' | 'resolved' | 'ignored';
      resolutionNote?: string;
    };
    const state = loadStore();
    const conflict = state.conflicts.find((c) => c.id === id);
    if (!conflict) {
      res.status(404).json({ error: '未找到指定冲突记录。' });
      return;
    }
    if (status) {
      conflict.status = status;
      conflict.resolvedAt = status === 'open' ? undefined : new Date().toISOString();
    }
    if (resolutionNote !== undefined) {
      conflict.resolutionNote = resolutionNote;
    }
    refreshKnowledgeGraph(state);
    saveStore(state);
    res.json({ conflict, state: sanitizeStateForClient(state) });
  });

  app.post('/api/conflicts/:id/draft-fix', async (req, res) => {
    try {
      const { id } = req.params;
      const state = loadStore();
      const conflict = state.conflicts.find((c) => c.id === id);
      if (!conflict) {
        res.status(404).json({ error: '未找到指定冲突记录。' });
        return;
      }
      const draft = await draftConflictResolution(conflict);
      res.json(draft);
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/diff', (req, res) => {
    const { policyId, oldVersionId, newVersionId } = req.query as {
      policyId?: string;
      oldVersionId?: string;
      newVersionId?: string;
    };
    const state = loadStore();
    const policy = state.policies.find((p) => p.id === policyId);
    if (!policy) {
      res.status(404).json({ error: '未找到指定制度。' });
      return;
    }
    const oldVer = policy.versions.find((v) => v.id === oldVersionId);
    const newVer = policy.versions.find((v) => v.id === newVersionId);
    if (!oldVer || !newVer) {
      res.status(400).json({ error: '请选择有效的两个版本进行对比。' });
      return;
    }

    const parts = diffLines(oldVer.content, newVer.content);
    const lines: DiffLineItem[] = [];
    let oldLine = 1;
    let newLine = 1;
    let addedCount = 0;
    let removedCount = 0;

    for (const part of parts) {
      const rawLines = part.value.split('\n');
      if (rawLines[rawLines.length - 1] === '') rawLines.pop();
      for (const lineText of rawLines) {
        if (part.added) {
          lines.push({
            type: 'added',
            oldLineNumber: null,
            newLineNumber: newLine++,
            text: lineText,
          });
          addedCount++;
        } else if (part.removed) {
          lines.push({
            type: 'removed',
            oldLineNumber: oldLine++,
            newLineNumber: null,
            text: lineText,
          });
          removedCount++;
        } else {
          lines.push({
            type: 'unchanged',
            oldLineNumber: oldLine++,
            newLineNumber: newLine++,
            text: lineText,
          });
        }
      }
    }

    res.json({
      policyTitle: policy.title,
      oldVersion: {
        id: oldVer.id,
        versionNumber: oldVer.versionNumber,
        effectiveDate: oldVer.effectiveDate,
        author: oldVer.author,
        changeSummary: oldVer.changeSummary,
      },
      newVersion: {
        id: newVer.id,
        versionNumber: newVer.versionNumber,
        effectiveDate: newVer.effectiveDate,
        author: newVer.author,
        changeSummary: newVer.changeSummary,
      },
      stats: { addedCount, removedCount },
      lines,
    });
  });

  app.post('/api/diff/semantic', async (req, res) => {
    try {
      const { policyId, oldVersionId, newVersionId } = req.body as {
        policyId?: string;
        oldVersionId?: string;
        newVersionId?: string;
      };
      const state = loadStore();
      const policy = state.policies.find((p) => p.id === policyId);
      if (!policy) {
        res.status(404).json({ error: '未找到指定制度。' });
        return;
      }
      const oldVer = policy.versions.find((v) => v.id === oldVersionId);
      const newVer = policy.versions.find((v) => v.id === newVersionId);
      if (!oldVer || !newVer) {
        res.status(400).json({ error: '请选择有效的两个版本进行语义分析。' });
        return;
      }
      const otherPolicies = state.policies.filter(
        (p) => p.id !== policy.id && p.status === 'active'
      );
      const analysis = await analyzeVersionDiff(
        policy.title,
        oldVer.versionNumber,
        oldVer.content,
        newVer.versionNumber,
        newVer.content,
        otherPolicies
      );
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.patch('/api/alerts/:id', (req, res) => {
    const { id } = req.params;
    const { read, acknowledged } = req.body as {
      read?: boolean;
      acknowledged?: boolean;
    };
    const state = loadStore();
    const alert = state.alerts.find((a) => a.id === id);
    if (!alert) {
      res.status(404).json({ error: '未找到指定提醒记录。' });
      return;
    }
    if (read !== undefined) alert.read = read;
    if (acknowledged !== undefined) {
      alert.acknowledged = acknowledged;
      if (acknowledged) alert.read = true;
    }
    saveStore(state);
    res.json({ alert, state: sanitizeStateForClient(state) });
  });

  app.post('/api/alerts/mark-all-read', (_req, res) => {
    const state = loadStore();
    for (const a of state.alerts) {
      a.read = true;
    }
    saveStore(state);
    res.json(sanitizeStateForClient(state));
  });

  app.post('/api/alerts/evaluate', (_req, res) => {
    const state = loadStore();
    const generated = evaluateAlertRules(state, new Date());
    res.json({
      generatedCount: generated.length,
      state: sanitizeStateForClient(state),
    });
  });

  app.patch('/api/alert-rules/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body as {
      enabled?: boolean;
      thresholdDays?: number;
      minSeverity?: 'critical' | 'warning' | 'info';
      notifyDepartments?: string[];
    };
    const state = loadStore();
    const rule = state.alertRules.find((r) => r.id === id);
    if (!rule) {
      res.status(404).json({ error: '未找到指定提醒规则。' });
      return;
    }
    if (updates.enabled !== undefined) rule.enabled = updates.enabled;
    if (updates.thresholdDays !== undefined) rule.thresholdDays = updates.thresholdDays;
    if (updates.minSeverity !== undefined) rule.minSeverity = updates.minSeverity;
    if (updates.notifyDepartments !== undefined) {
      rule.notifyDepartments = updates.notifyDepartments;
    }
    saveStore(state);
    res.json({ rule, state: sanitizeStateForClient(state) });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '请求的 API 接口不存在。' });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!req.path.startsWith('/api')) {
        next(err);
        return;
      }
      if (err instanceof multer.MulterError) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? '上传失败：单个文件大小超出 30MB 上限。'
            : err.code === 'LIMIT_FILE_COUNT'
              ? '上传失败：单次最多允许上传 20 个文件。'
              : `文件上传异常：${err.message}`;
        res.status(400).json({ error: msg });
        return;
      }
      const status =
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        typeof (err as { status?: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      res.status(status).json({ error: getErrorMessage(err) });
    }
  );

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*splat', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Policy RAG server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
