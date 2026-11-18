import { chunkPolicyContent } from './chunker.ts';
import type {
  AlertItem,
  AlertRule,
  PolicyConflict,
  PolicyDocument,
  StoreState,
} from '../src/types/policy.ts';

function buildPolicy(
  id: string,
  code: string,
  title: string,
  category: string,
  department: string,
  owner: string,
  reviewCycleMonths: number,
  nextReviewDate: string,
  versionsInput: Array<{
    id: string;
    versionNumber: string;
    effectiveDate: string;
    createdAt: string;
    author: string;
    changeSummary: string;
    content: string;
  }>
): PolicyDocument {
  const cycle: PolicyDocument['effectiveCycle'] =
    reviewCycleMonths === 6
      ? '6_months'
      : reviewCycleMonths === 24
        ? '2_years'
        : reviewCycleMonths === 36
          ? '3_years'
          : '1_year';
  const versions = versionsInput.map((v) => ({
    ...v,
    effectiveCycle: cycle,
    chunks: chunkPolicyContent(id, v.id, v.content),
  }));
  const latest = versions[versions.length - 1];
  return {
    id,
    code,
    title,
    category,
    department,
    owner,
    status: 'active',
    currentVersionId: latest.id,
    effectiveDate: latest.effectiveDate,
    effectiveCycle: cycle,
    reviewCycleMonths,
    nextReviewDate,
    updatedAt: latest.createdAt,
    versions,
  };
}

export function createInitialStoreState(): StoreState {
  const polAttendance = buildPolicy(
    'pol-attendance',
    'HR-POL-001',
    '员工考勤与休假管理办法',
    '人力资源制度',
    '人力资源部',
    '林知微',
    12,
    '2026-11-28',
    [
      {
        id: 'ver-att-1.0',
        versionNumber: 'v1.0',
        effectiveDate: '2024-03-01',
        createdAt: '2024-02-20T09:00:00Z',
        author: '林知微',
        changeSummary: '初始版本发布，明确工作时间、病假及年假申请规范。',
        content: `# 员工考勤与休假管理办法（v1.0）

## 第一章 总则
第一条 工作时间与打卡规范
公司实行标准工时制，每周一至周五 09:30 至 18:30 为标准办公时间，午休 12:00 至 13:30。所有正式员工须在公司办公区完成每日上下班考勤打卡。

## 第二章 病假与医疗证明
第二条 病假审批及证明要求
员工因病申请休假，连续病假超过 5 天（含）以上的，须在复工后 3 个工作日内向人力资源部补交二级甲等及以上公立医院出具的诊断证明及休假建议书；5 天以内病假凭门诊挂号单即可办理。

## 第三章 加班与调休
第三条 加班认定与补偿
工作日加班须提前在 OA 系统提交申请，经直属主管审批通过后方计入加班时长。加班优先安排调休，调休有效期为加班发生日起 6 个月内。`,
      },
      {
        id: 'ver-att-2.0',
        versionNumber: 'v2.0',
        effectiveDate: '2025-06-01',
        createdAt: '2025-05-18T14:30:00Z',
        author: '林知微',
        changeSummary: '收紧病假证明天数门槛至3天，新增核心研发部门弹性工时条文。',
        content: `# 员工考勤与休假管理办法（v2.0）

## 第一章 总则
第一条 工作时间与打卡规范
公司实行弹性打卡制，核心办公时间为 10:00 至 17:00。除《混合与远程办公管理规范》另有约定外，全员每周一至周五须到岗办公，其中每周五下午全员必须现场参加部门周会及集中协作。

## 第二章 病假与医疗证明
第二条 病假审批及证明要求
员工因病申请休假，连续病假超过 3 天（含）以上的，须在返岗后 2 个工作日内提交三级甲等公立医院出具的诊断证明、病历及休假建议书；连续病假 1 至 2 天须附门诊就诊记录。

## 第三章 加班与调休
第三条 加班认定与补偿
工作日及休息日加班须提前在 OA 系统提交申请，经部门负责人审批后方计入加班时长。调休有效期缩短为加班发生日起 3 个月内，逾期自动作废，不折算加班工资。`,
      },
      {
        id: 'ver-att-2.1',
        versionNumber: 'v2.1',
        effectiveDate: '2026-04-01',
        createdAt: '2026-03-22T10:15:00Z',
        author: '陈景行',
        changeSummary: '明确病假工资发放比例及周五集中办公约束，同步更新调休跨季度结转限制。',
        content: `# 员工考勤与休假管理办法（v2.1）

## 第一章 总则
第一条 工作时间与现场办公约束
公司实行弹性上下班制，核心在岗时段为 10:00 至 17:00。为保障跨部门协作效率，全员每周五必须现场在岗集中办公，任何部门不得在周五安排常态化居家办公。

## 第二章 病假与医疗证明
第二条 病假证明与医院等级要求
员工连续病假超过 3 天（含）以上的，必须提交三级甲等医院开具的加盖诊断章证明书；连续病假 3 天以下须提供门诊病历及缴费凭证。

## 第三章 加班核算与调休
第三条 加班审批与调休有效期
员工在非工作时间（含远程办公期间）执行紧急任务，须经部门总监书面审批后方可计为有效加班。调休额度有效期为 3 个月，且不得跨自然年度结转；法定节假日加班按国家规定支付 300% 加班工资，不得以调休替代。`,
      },
    ]
  );

  const polHandbook = buildPolicy(
    'pol-handbook',
    'HR-POL-004',
    '新员工入职与通用员工手册',
    '人力资源制度',
    '人力资源部',
    '周予安',
    24,
    '2026-11-10',
    [
      {
        id: 'ver-hb-1.4',
        versionNumber: 'v1.4',
        effectiveDate: '2025-01-15',
        createdAt: '2025-01-05T11:00:00Z',
        author: '周予安',
        changeSummary: '更新试用期考核周期及日常休假指引摘要。',
        content: `# 新员工入职与通用员工手册（v1.4）

## 第一章 试用期管理
第一条 试用期期限与转正考核
新员工入职标准试用期为 6 个月，转正答辩须在试用期满前 15 个自然日发起。

## 第二章 休假指引摘要
第二条 病假凭证简化条款
员工连续病假 5 天（含）以内的，仅需提供二级及以上医疗机构挂号单或线上复诊记录即可通过审批；超过 5 天须提交二级甲等及以上医院正式诊断证明。

## 第三章 制度引用说明
第三条 配套差旅制度指引
员工出差期间的报销标准与审批流程，统一遵照《差旅费报销与审批细则（2023版 v1.0）》执行。`,
      },
    ]
  );

  const polRemote = buildPolicy(
    'pol-remote',
    'IT-SEC-007',
    '混合办公与信息安全管理规范',
    '信息安全制度',
    '信息安全与IT部',
    '陆明远',
    12,
    '2027-02-15',
    [
      {
        id: 'ver-rem-1.0',
        versionNumber: 'v1.0',
        effectiveDate: '2025-09-01',
        createdAt: '2025-08-20T16:00:00Z',
        author: '陆明远',
        changeSummary: '确立产研团队每周两天远程办公机制与 VPN 零信任接入要求。',
        content: `# 混合办公与信息安全管理规范（v1.0）

## 第一章 远程办公适用范围
第一条 固定远程办公日安排
研发中心、产品设计部及数据智能部正式员工，可申请每周三与每周五固定居家远程办公，无需每日单独发起请假流程，仅需在协同平台签到即可。

## 第二章 远程加班与响应要求
第二条 远程期间加班认定
远程办公期间，系统自动记录 VPN 在线及代码提交活跃时长，员工因线上故障处理产生的非工作时段工时，直接按实际工时折算为加班调休，无需额外总监前置审批。

## 第三章 终端数据安全
第三条 接入加密与屏幕防窥
居家办公期间严禁使用公共未加密 Wi-Fi 访问核心生产库，须全程开启企业零信任客户端。`,
      },
    ]
  );

  const polTravel = buildPolicy(
    'pol-travel',
    'FIN-POL-012',
    '差旅费报销与审批细则',
    '财务内控制度',
    '财务内控部',
    '沈清晏',
    12,
    '2026-12-05',
    [
      {
        id: 'ver-trv-1.0',
        versionNumber: 'v1.0',
        effectiveDate: '2023-07-01',
        createdAt: '2023-06-20T09:30:00Z',
        author: '沈清晏',
        changeSummary: '2023 初版差旅报销标准与部门审批流。',
        content: `# 差旅费报销与审批细则（v1.0）

## 第一章 住宿及交通标准
第一条 城市分级住宿限额
一线城市（北上广深）住宿标准上限为 650 元/晚；其他省会及新一线城市为 450 元/晚。

## 第二章 报销审批权限
第二条 单次差旅审批门槛
单次差旅报销总金额在 5000 元（含）以下的，由部门总监终审即可打款；超过 5000 元须加签财务总监。`,
      },
      {
        id: 'ver-trv-2.0',
        versionNumber: 'v2.0',
        effectiveDate: '2026-01-01',
        createdAt: '2025-12-12T15:20:00Z',
        author: '沈清晏',
        changeSummary: '上调一线城市住宿上限至750元，保留部门总监5000元以下审批权。',
        content: `# 差旅费报销与审批细则（v2.0）

## 第一章 住宿及交通标准
第一条 城市分级住宿限额
一线城市（北京、上海、广州、深圳）住宿标准上限调整为 750 元/晚；新一线及省会城市调整为 500 元/晚。原则上须优先通过企业商旅平台预订协议酒店。

## 第二章 报销审批权限
第二条 单次差旅审批授权
单笔或单次出差费用总额在 5000 元（含）以下的，由所属部门总监直接终审批准，财务出纳凭总监电子签批于 5 个工作日内完成打款，无需上呈分管副总裁。`,
      },
    ]
  );

  const polFinanceControl = buildPolicy(
    'pol-fin-ctrl',
    'FIN-POL-002',
    '集团财务内控与资金审批红线制度',
    '财务内控制度',
    '财务内控部',
    '顾怀安',
    12,
    '2027-03-15',
    [
      {
        id: 'ver-fc-1.8',
        versionNumber: 'v1.8',
        effectiveDate: '2026-02-01',
        createdAt: '2026-01-18T10:00:00Z',
        author: '顾怀安',
        changeSummary: '强化大额费用复核红线，统一所有费用报销与付款复核门槛。',
        content: `# 集团财务内控与资金审批红线制度（v1.8）

## 第一章 资金支出复核红线
第一条 费用报销分级复核门槛
公司一切非采购类费用报销（包括但不限于差旅费、业务招待费、团建费），单笔金额超过 3000 元（含）的，必须在部门总监审批之后，加签分管副总裁及财务合规复核方可放款。

## 第二章 协议采购与付款
第二条 供应商付款账期
所有合作供应商结算账期统一为验收合格并收到专票后 T+30 工作日付款。`,
      },
    ]
  );

  const policies: PolicyDocument[] = [
    polAttendance,
    polHandbook,
    polRemote,
    polTravel,
    polFinanceControl,
  ];

  const conflicts: PolicyConflict[] = [
    {
      id: 'conf-001',
      type: 'numeric_threshold',
      severity: 'critical',
      status: 'open',
      title: '病假医院等级与连续天数门槛冲突',
      description:
        '两份制度对“连续病假需提交正式诊断证明的天数阈值”及“开具医院资质等级”规定完全不一致，导致 4–5 天连续病假无法合规审批。',
      suggestedResolution:
        '建议同步修订《新员工入职与通用员工手册》第二条，删除具体天数与医院等级重复定义，改为直接援引《员工考勤与休假管理办法（最新有效版）》第二条执行。',
      conflictPoints: [
        {
          dimension: '连续病假天数门槛',
          valueA: '超过 3 天（含）须提交正式诊断证明',
          valueB: '5 天（含）以内仅需挂号单或线上复诊记录',
          impact: '连续病假 4–5 天的员工面临截然相反的凭证门槛',
        },
        {
          dimension: '医院资质等级要求',
          valueA: '必须三级甲等医院（加盖诊断章）',
          valueB: '仅需二级及以上 / 二级甲等医院',
          impact: '三级甲等与二级甲等医院开具效力口径冲突',
        },
      ],
      policyAId: 'pol-attendance',
      policyATitle: '员工考勤与休假管理办法',
      policyAVersion: 'v2.1',
      clauseA: '第二条 病假证明与医院等级要求',
      excerptA: '员工连续病假超过 3 天（含）以上的，必须提交三级甲等医院开具的加盖诊断章证明书；连续病假 3 天以下须提供门诊病历及缴费凭证。',
      policyBId: 'pol-handbook',
      policyBTitle: '新员工入职与通用员工手册',
      policyBVersion: 'v1.4',
      clauseB: '第二条 病假凭证简化条款',
      excerptB: '员工连续病假 5 天（含）以内的，仅需提供二级及以上医疗机构挂号单或线上复诊记录即可通过审批；超过 5 天须提交二级甲等及以上医院正式诊断证明。',
      detectedAt: '2026-11-12T09:10:00Z',
    },
    {
      id: 'conf-002',
      type: 'scope_exclusion',
      severity: 'critical',
      status: 'open',
      title: '周五现场集中办公与固定远程办公日互斥',
      description:
        '考勤制度严禁任何部门周五常态居家，而信息安全与混合办公规范明确允许研发、设计及数据部门每周五固定远程办公，条款直接互斥。',
      suggestedResolution:
        '建议在《员工考勤与休假管理办法》第一条增设“经IT与安全部备案的研发序列混合办公白名单人员，周五可执行《混合办公与信息安全管理规范》”例外条款，或将远程日统一调整为周二、周四。',
      conflictPoints: [
        {
          dimension: '周五办公要求',
          valueA: '全员每周五必须现场在岗集中办公',
          valueB: '研发、产品设计、数据智能部每周五固定居家',
          impact: '同一工作日产研员工无法同时满足现场与居家规则',
        },
        {
          dimension: '部门例外权限',
          valueA: '任何部门不得在周五安排常态化居家办公',
          valueB: '每周三与每周五固定远程，无需每日单独请假',
          impact: '考勤禁止全覆盖且未给混合办公留白名单例外',
        },
      ],
      policyAId: 'pol-attendance',
      policyATitle: '员工考勤与休假管理办法',
      policyAVersion: 'v2.1',
      clauseA: '第一条 工作时间与现场办公约束',
      excerptA: '全员每周五必须现场在岗集中办公，任何部门不得在周五安排常态化居家办公。',
      policyBId: 'pol-remote',
      policyBTitle: '混合办公与信息安全管理规范',
      policyBVersion: 'v1.0',
      clauseB: '第一条 固定远程办公日安排',
      excerptB: '研发中心、产品设计部及数据智能部正式员工，可申请每周三与每周五固定居家远程办公，无需每日单独发起请假流程。',
      detectedAt: '2026-11-12T09:10:00Z',
    },
    {
      id: 'conf-003',
      type: 'approval_authority',
      severity: 'critical',
      status: 'open',
      title: '3000–5000元区间差旅费报销审批权限冲突',
      description:
        '差旅细则允许 5000 元以下由部门总监终审直接放款，但集团财务内控红线将副总裁复核门槛收紧至 3000 元（含），导致 3000–5000 元报销单审批流冲突。',
      suggestedResolution:
        '遵循财务内控优先原则，将《差旅费报销与审批细则 v2.0》第二条的部门总监终审上限同步下调为 3000 元（不含），与集团财务红线保持一致。',
      conflictPoints: [
        {
          dimension: '部门总监终审上限',
          valueA: '5000 元（含）以下由部门总监直接终审',
          valueB: '3000 元（含）以上必须上呈加签复核',
          impact: '3000–5000 元报销单在两个制度下归属不同审批权限',
        },
        {
          dimension: '副总裁与财务复核节点',
          valueA: '无需上呈分管副总裁，5 个工作日内放款',
          valueB: '必须加签分管副总裁及财务合规复核方可放款',
          impact: '按差旅细则直付将直接违反集团资金内控红线',
        },
      ],
      policyAId: 'pol-travel',
      policyATitle: '差旅费报销与审批细则',
      policyAVersion: 'v2.0',
      clauseA: '第二条 单次差旅审批授权',
      excerptA: '单笔或单次出差费用总额在 5000 元（含）以下的，由所属部门总监直接终审批准，财务出纳凭总监电子签批于 5 个工作日内完成打款，无需上呈分管副总裁。',
      policyBId: 'pol-fin-ctrl',
      policyBTitle: '集团财务内控与资金审批红线制度',
      policyBVersion: 'v1.8',
      clauseB: '第一条 费用报销分级复核门槛',
      excerptB: '公司一切非采购类费用报销（包括但不限于差旅费、业务招待费、团建费），单笔金额超过 3000 元（含）的，必须在部门总监审批之后，加签分管副总裁及财务合规复核方可放款。',
      detectedAt: '2026-11-13T14:22:00Z',
    },
    {
      id: 'conf-004',
      type: 'approval_authority',
      severity: 'warning',
      status: 'open',
      title: '远程办公期间加班认定前置审批口径不一致',
      description:
        '考勤制度要求远程非工作时间任务均须总监书面审批，而混合办公规范规定线上故障处理按系统记录直接折算调休，无需前置审批。',
      suggestedResolution:
        '明确区分“常规计划外加班”与“P0/P1级线上故障应急响应”，在《考勤办法》第三条补充紧急故障可采用事后24小时内补签审批机制。',
      conflictPoints: [
        {
          dimension: '加班前置审批',
          valueA: '远程期间非工作时间须部门总监书面审批',
          valueB: '线上故障处理工时无需额外总监前置审批',
          impact: '突发线上故障未事先获批时 HR 与团队认定标准不一',
        },
        {
          dimension: '工时折算依据',
          valueA: '以部门总监书面审批作为有效加班唯一前提',
          valueB: '按 VPN 在线及代码提交记录直接折算加班调休',
          impact: '自动化记录与人工审批流程脱节',
        },
      ],
      policyAId: 'pol-attendance',
      policyATitle: '员工考勤与休假管理办法',
      policyAVersion: 'v2.1',
      clauseA: '第三条 加班审批与调休有效期',
      excerptA: '员工在非工作时间（含远程办公期间）执行紧急任务，须经部门总监书面审批后方可计为有效加班。',
      policyBId: 'pol-remote',
      policyBTitle: '混合办公与信息安全管理规范',
      policyBVersion: 'v1.0',
      clauseB: '第二条 远程期间加班认定',
      excerptB: '员工因线上故障处理产生的非工作时段工时，直接按实际工时折算为加班调休，无需额外总监前置审批。',
      detectedAt: '2026-11-14T11:05:00Z',
    },
    {
      id: 'conf-005',
      type: 'stale_reference',
      severity: 'warning',
      status: 'open',
      title: '员工手册引用已废止的旧版差旅制度',
      description:
        '员工手册仍援引已废止的 2023 版差旅细则 v1.0，而现行版本已升级至 v2.0 且一线城市住宿标准已上调。',
      suggestedResolution:
        '将《新员工入职与通用员工手册》第三条的引用版本号更新为“现行有效版本（v2.0 及后续修订版）”。',
      conflictPoints: [
        {
          dimension: '引用制度版本号',
          valueA: '仍援引《差旅费报销与审批细则（2023版 v1.0）》',
          valueB: '现行有效版本已升级至 v2.0（2026-01-01 生效）',
          impact: '新员工按手册指引将误用已废止旧版差旅标准',
        },
        {
          dimension: '一线城市住宿上限',
          valueA: '旧版 v1.0 住宿标准上限为 650 元/晚',
          valueB: '现行 v2.0 住宿标准上限已上调为 750 元/晚',
          impact: '报销限额口径落后 100 元/晚',
        },
      ],
      policyAId: 'pol-handbook',
      policyATitle: '新员工入职与通用员工手册',
      policyAVersion: 'v1.4',
      clauseA: '第三条 配套差旅制度指引',
      excerptA: '员工出差期间的报销标准与审批流程，统一遵照《差旅费报销与审批细则（2023版 v1.0）》执行。',
      policyBId: 'pol-travel',
      policyBTitle: '差旅费报销与审批细则',
      policyBVersion: 'v2.0',
      clauseB: '第一条 城市分级住宿限额',
      excerptB: '一线城市（北京、上海、广州、深圳）住宿标准上限调整为 750 元/晚（v2.0 自 2026-01-01 起生效）。',
      detectedAt: '2026-11-15T08:40:00Z',
    },
  ];

  const alertRules: AlertRule[] = [
    {
      id: 'rule-new-conflict',
      name: '新版本入库冲突自动预警',
      description: '当任意制度发布新版本或修订条款时，自动比对全库现行制度并向相关责任部门推送矛盾提醒。',
      triggerType: 'new_conflict',
      enabled: true,
      thresholdDays: 0,
      minSeverity: 'warning',
      notifyDepartments: ['法务合规部', '人力资源部', '财务内控部'],
      lastTriggeredAt: '2026-11-15T08:40:00Z',
    },
    {
      id: 'rule-review-due',
      name: '制度年度复审到期提醒',
      description: '在制度距离计划复审日期不足设定天数或已逾期时，自动生成待复审预警通知责任人。',
      triggerType: 'review_due',
      enabled: true,
      thresholdDays: 30,
      minSeverity: 'warning',
      notifyDepartments: ['制度管理委员会', '人力资源部', '财务内控部'],
      lastTriggeredAt: '2026-11-16T08:00:00Z',
    },
    {
      id: 'rule-version-impact',
      name: '跨制度引用联动影响提醒',
      description: '当核心上游制度版本变更时，自动提醒引用或依赖该制度的下游文档维护人。',
      triggerType: 'version_impact',
      enabled: true,
      thresholdDays: 0,
      minSeverity: 'info',
      notifyDepartments: ['人力资源部', '信息安全与IT部'],
      lastTriggeredAt: '2026-11-14T11:05:00Z',
    },
    {
      id: 'rule-unresolved-sla',
      name: '高危冲突超期未处理督办',
      description: '严重矛盾（Critical）在识别后超过 3 天仍未标记为已解决或忽略时，触发升级督办提醒。',
      triggerType: 'unresolved_sla',
      enabled: true,
      thresholdDays: 3,
      minSeverity: 'critical',
      notifyDepartments: ['法务合规部', '内审督查组'],
      lastTriggeredAt: '2026-11-16T08:00:00Z',
    },
  ];

  const alerts: AlertItem[] = [
    {
      id: 'alrt-001',
      type: 'review_due',
      severity: 'critical',
      title: '《新员工入职与通用员工手册》已逾期未复审',
      message: '计划复审日期为 2026-11-10（已逾期 6 天），且当前存在旧版引用及病假阈值冲突，请责任人周予安尽快发起版本修订。',
      targetDepartment: '人力资源部',
      relatedPolicyId: 'pol-handbook',
      createdAt: '2026-11-16T08:00:00Z',
      read: false,
      acknowledged: false,
    },
    {
      id: 'alrt-002',
      type: 'unresolved_sla',
      severity: 'critical',
      title: '高危审批权限冲突超期未处置：3000–5000元差旅复核红线',
      message: '冲突 #conf-003 已超过 3 天处理时限，《差旅费报销与审批细则 v2.0》与《集团财务内控红线 v1.8》存在审批权限打架风险。',
      targetDepartment: '财务内控部',
      relatedPolicyId: 'pol-travel',
      relatedConflictId: 'conf-003',
      createdAt: '2026-11-16T08:00:00Z',
      read: false,
      acknowledged: false,
    },
    {
      id: 'alrt-003',
      type: 'review_due',
      severity: 'warning',
      title: '《员工考勤与休假管理办法》将于 12 天后到期复审',
      message: '当前版本 v2.1 的年度复审日期为 2026-11-28，建议提前评估与《混合办公与信息安全管理规范》周五在岗条款的协调方案。',
      targetDepartment: '人力资源部',
      relatedPolicyId: 'pol-attendance',
      createdAt: '2026-11-16T08:00:00Z',
      read: false,
      acknowledged: false,
    },
    {
      id: 'alrt-004',
      type: 'review_due',
      severity: 'warning',
      title: '《差旅费报销与审批细则》将于 19 天后到期复审',
      message: '计划复审日期为 2026-12-05，财务内控部需核对一线城市住宿标准及 3000 元复核门槛口径。',
      targetDepartment: '财务内控部',
      relatedPolicyId: 'pol-travel',
      createdAt: '2026-11-15T09:00:00Z',
      read: true,
      acknowledged: false,
    },
    {
      id: 'alrt-005',
      type: 'version_impact',
      severity: 'info',
      title: '版本升级联动提醒：《差旅费报销与审批细则》已更新至 v2.0',
      message: '检测到《新员工入职与通用员工手册 v1.4》第三条仍引用旧版 v1.0，请人力资源部同步刷新引用链接。',
      targetDepartment: '人力资源部',
      relatedPolicyId: 'pol-handbook',
      relatedConflictId: 'conf-005',
      createdAt: '2026-11-15T08:40:00Z',
      read: true,
      acknowledged: true,
    },
  ];

  return {
    policies,
    conflicts,
    alerts,
    alertRules,
    lastAuditAt: '2026-11-15T08:40:00Z',
  };
}
