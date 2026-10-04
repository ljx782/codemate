/* =====================================================================
 * skill-resume.js — Agent 2 的「技术简历优化专家」Skill 包
 * 独立模块：知识库 + 输出契约（JSON Schema）+ Prompt 组装 + 离线 mock
 * Agent 本体（agent-resume.js）只负责取数、调用、渲染，不内嵌方法论
 *
 * 方法论提炼自（2025-2026 校招季）：
 *  · 牛客网校招简历攻略（项目 STAR 不必贴标签、按 JD 定制）
 *  · 超级简历 WonderCV 应届生模块顺序指南
 *  · 2026 ATS / AI 预筛机制攻略（单栏、关键词、强动词+量化）
 *  · 大厂技术岗简历评分维度（技能匹配 30% / 项目量化 / 教育背景）
 * ===================================================================== */

const RESUME_SKILL = {
  name: 'tech-resume-optimizer',
  label: '技术简历优化专家 Skill v2',
  sources: ['牛客网校招攻略', '超级简历 WonderCV', '2026 ATS/AI 预筛规范', '大厂技术岗评分模型'],

  /* 五个固定评分维度（schema 字段名 ↔ 展示名） */
  DIM_NAMES: ['定位与结构', '量化与证据', '岗位匹配度', '真实可信度', '语言与规范'],
  DIM_KEYS: ['positioning', 'quant', 'match', 'credibility', 'expression'],

  /* ----------------------------------------------------------------
   * 知识库：注入 system prompt，约束模型按专业简历顾问的方式工作
   * ---------------------------------------------------------------- */
  KNOWLEDGE: `【简历的三个筛选关卡】
1. ATS / AI 预筛（2026 年大中厂已是标准流程）：单栏文本、标准模块标题、关键词覆盖；
2. HR 6 秒扫描：只找「是谁、投什么岗、硬证据、关键词」，要能一眼定位；
3. 技术面试官：把简历当提问提纲，每条经历都要能被追问两层。

【一页纸铁律】应届生 1 页；时间倒序；黑白简洁、单栏；标准标题（教育背景/专业技能/项目经历等），
不使用图标、表格、文本框、照片位；关键成果可加粗；文件命名「姓名-目标岗位」。

【模块顺序（应届生技术岗，按最强证据前置原则）】
基本信息 → 求职意向 → 个人总结 → 教育背景 → 专业技能 → 项目经历(含实习) → 竞赛与荣誉 → 开源/校园经历(可选)
- 基本信息只需：姓名、电话、邮箱、GitHub/技术博客（没有就不写）；不要籍贯/民族/政治面貌/身高体重；
- 求职意向必须具体（如「后端开发工程师（校招·Java 方向）」），不写「管培生」「技术岗」这类模糊词；
- 教育背景只放与岗位相关的课程；GPA/排名亮眼才写，一般就省略；经历时间倒序、最新在前。

【个人总结（Profile）写法】
- 2-3 条，每条一句话；用「事实 + 证据」让 HR 自己推出「努力/有潜力」，禁止性格软词
  （禁止：性格开朗、学习能力强、能吃苦、热爱技术；正确：ACM 区域赛铜奖、LeetCode 200+、维护 xx star 项目）。

【专业技能写法】
- 按「语言基础 / 框架与中间件 / 数据存储 / 工程工具」分类罗列，不搞一堵技术墙；
- 熟练度只用「熟悉/了解」，原则上不用「精通」（精通=能扛三层追问）；只写真会的，按 JD 取舍不堆砌；
- 技能名词拼写大小写必须规范（Spring Boot、MySQL、Redis）。

【项目经历写法 —— 整份简历的核心】
- 精选 2-3 个最强项目，时间倒序；每个项目先一行「项目名｜角色｜时间段」，再一行「技术栈」；
- 正文用要点句（bullet），不贴 S/T/A/R 标签——但每条 bullet 暗含 STAR：
  公式：强动词开头（设计/实现/重构/优化/主导）+ 技术手段 + 解决的具体问题 + 可对比的量化结果；
- 量化四象限，至少占一个：规模（用户数/QPS/数据量）、性能（响应时间/吞吐，要有前后对比）、
  效率（耗时/人力节省）、质量（Bug 率/可用性/通过率）；
- 禁写「负责开发」「参与 xx 系统」这类没有信息增量的空话；
- 为面试官「设置议程」：主动埋可深挖的技术点（锁、索引、缓存一致性……），但写了就要能讲清原理；
- 边界诚实：个人贡献写清「独立/主导/负责哪一块」，不得把团队成果写成个人成果（面试第一问必穿帮）。

【硬证据前置与红线】
- GitHub 仓库、线上用户、开源 PR、比赛名次、Demo 链接等可验证信号往第一屏放；
- 不编造数字。简历没有数据时，在成品简历对应位置标注「【请补充：xx，如 QPS/用户量/提升比例】」；
- 不虚构项目/经历；检测到夸大规模、团队成果独吞、技术名词错误等风险必须在 issues 中指出。

【JD 定向优化】
- 有 JD 时：按一岗一简历处理——技能顺序与项目要点向 JD 关键词倾斜（会的前置、无关的删减）；
  抽取 JD 硬性要求做关键词命中分析；缺失关键词若是应届生可短期补强的，给进 todo；
- 无 JD 时：按通用后端/技术岗优化，kwHit/kwMissing 返回空数组，不要硬凑。`,

  /* ----------------------------------------------------------------
   * 输出契约：严格 JSON Schema（DashScope qwen-plus 支持；
   * 不支持时 ai-client 自动降级 json_object，normalize 再兜底）
   * ---------------------------------------------------------------- */
  SCHEMA: {
    name: 'resume_review',
    schema: {
      type: 'object',
      properties: {
        factBase: {
          type: 'object',
          description: '【第一步先填】从简历原文逐字摘录的事实底座，后续所有字段只能使用这里的事实',
          properties: {
            skills: { type: 'array', maxItems: 20, items: { type: 'string' }, description: '原文「专业技能」栏出现的技术名词（逐字）' },
            numbers: { type: 'array', maxItems: 15, items: { type: 'string' }, description: '原文出现的全部数字描述（如 2022-2026、2000+、8分钟），原文没有数字则空数组' },
            projects: {
              type: 'array', maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '原文项目名' },
                  facts: { type: 'array', maxItems: 8, items: { type: 'string' }, description: '原文中关于该项目的事实要点逐字摘录（功能/技术/角色/数字/时间）' }
                },
                required: ['name', 'facts'],
                additionalProperties: false
              }
            }
          },
          required: ['skills', 'numbers', 'projects'],
          additionalProperties: false
        },
        score: { type: 'integer', description: '简历当前竞争力总分 0-100，按应届生技术岗标准从严，一般 55-78' },
        scoreText: { type: 'string', description: '一句话诊断，30字内，指出最关键的一个问题' },
        dims: {
          type: 'object',
          description: '五个维度分(0-100)，从严打分并拉开梯度，禁止全部85+',
          properties: {
            positioning: { type: 'integer', description: '定位与结构：求职意向、模块顺序、一页纸、可读性' },
            quant: { type: 'integer', description: '量化与证据：项目是否有规模/性能/效率/质量数据与对比' },
            match: { type: 'integer', description: '岗位匹配度：技能与项目对目标JD关键词的覆盖（无JD时给中性分）' },
            credibility: { type: 'integer', description: '真实可信度：贡献边界是否清晰、有无夸大或造假嫌疑' },
            expression: { type: 'integer', description: '语言与规范：强动词、无空话、术语拼写、ATS友好' }
          },
          required: ['positioning', 'quant', 'match', 'credibility', 'expression'],
          additionalProperties: false
        },
        profile: { type: 'string', description: '个人总结，2-3行，每行以「- 」开头，\\n分隔；只能概括简历原文已有事实，禁止出现原文没有的数字/项目/头衔，不含性格软词' },
        kwHit: { type: 'array', maxItems: 6, items: { type: 'string' }, description: '简历已覆盖的JD关键要求词，最多6个；无JD时为空数组' },
        kwMissing: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'JD要求但简历缺失/偏弱的关键词，最多5个；无JD时为空数组' },
        stars: {
          type: 'array',
          maxItems: 2,
          description: '2个最强项目的STAR深度拆解（教学/备面用，不直接进成品简历）',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '项目名｜角色｜时间段，只用原文信息，时间未知写【请补充】' },
              stack: { type: 'string', description: '技术栈一行，只能摘原文出现的名词，规范拼写，不许新增' },
              situation: { type: 'string', description: 'S：项目自身的业务背景/要解决的问题，只述原文事实，不要引用JD' },
              task: { type: 'string', description: 'T：你在原文中体现的职责边界（独立/主导/参与），禁止写建议或任何数字' },
              action: { type: 'string', description: 'A：原文体现的技术做法（可专业化措辞），但不得新增原文没有的方案/数字' },
              result: { type: 'string', description: 'R：只能引用原文数字；无数据时写「原文未量化，建议补充：xx指标」，严禁编造' }
            },
            required: ['title', 'stack', 'situation', 'task', 'action', 'result'],
            additionalProperties: false
          }
        },
        rewrites: {
          type: 'array',
          maxItems: 2,
          description: '句子级精修示范，2组',
          items: {
            type: 'object',
            properties: {
              before: { type: 'string', description: '简历原文中的空泛句子（必须引用原文）' },
              after: { type: 'string', description: '精修后：只允许改句式/强动词/语序，事实必须与原文完全一致；原文没有的数字/名次/百分比绝不新增，缺量化时写【请补充：xx指标】占位' }
            },
            required: ['before', 'after'],
            additionalProperties: false
          }
        },
        issues: {
          type: 'array',
          maxItems: 4,
          description: '问题检测，4条，按严重度排序',
          items: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: ['danger', 'warn', 'tip'], description: 'danger=造假/硬伤风险，warn=表达/结构问题，tip=加分建议' },
              text: { type: 'string', description: '问题描述+修改建议（≤55字），必须引用简历原文细节' }
            },
            required: ['level', 'text'],
            additionalProperties: false
          }
        },
        todo: { type: 'array', maxItems: 4, items: { type: 'string' }, description: '4条候选人需自行补充/动手的事项（补数据、补链接、删减等），每条≤40字，可执行' },
        md: { type: 'string', description: '一页纸成品简历Markdown，≤850汉字，\\n换行；不得出现S/T/A/R标签；只能重排润色原文事实，禁止编造项目/数据/链接，缺失项用【请补充：…】占位' }
      },
      required: ['factBase', 'score', 'scoreText', 'dims', 'profile', 'kwHit', 'kwMissing', 'stars', 'rewrites', 'issues', 'todo', 'md'],
      additionalProperties: false
    }
  },

  /* 从简历原文提取英文技术名词白名单（C/C++、Spring Boot、Redis 等），
     供模型在 stars/rewrites/md 中做"只能用白名单"的硬约束；中文课程/年份等自动过滤 */
  extractTerms(text) {
    const stop = new Set(['demo','the','and','for','with','http','https','www','com','agent','qwen','true','false','null']);
    const out = new Set();
    const re = /[A-Za-z][A-Za-z0-9.+#/]{1,24}(?:[ -][A-Z][A-Za-z0-9]+){0,2}/g;
    (String(text).match(re) || []).forEach(raw => {
      const w = raw.trim();
      if (w.length < 2 || stop.has(w.toLowerCase())) return;
      if (/^\d/.test(w)) return;
      out.add(w);
    });
    return Array.from(out).slice(0, 24);
  },

  /* Prompt 组装：JD 可选，有则定向 */
  buildMessages(resumeText, jdText) {
    const hasJD = !!(jdText && jdText.trim());
    const whitelist = this.extractTerms(resumeText);
    const mdRule = `【成品简历 md 的固定结构】（严格遵守，缺的信息用【请补充：…】占位，不要编造）
# 姓名｜求职意向（一行定位，如「张同学｜后端开发工程师（校招·Java 方向）」）
手机【请补充】｜邮箱【请补充】｜GitHub/博客【有则写真实链接，无则删掉本段】

## 个人总结
（填入 profile 内容）

## 教育背景
**学校｜专业｜学历｜起止时间**
GPA/排名（亮眼才写）｜相关课程：只列与岗位相关的 4-6 门

## 专业技能
- **语言基础**：…
- **框架与中间件**：…
- **数据存储**：…
- **工程工具**：…
（按简历实际情况合并分类，不会的不许写）

## 项目经历
### 项目名｜角色｜时间段
\`技术栈：a、b、c\`
- 强动词开头的要点句，暗含情境/任务，落在量化结果（每项目 2-4 条）
- …

## 竞赛与荣誉
- 倒序、带级别与名次；没有硬奖可写奖学金/排名；整条没有就省略本模块

## 开源 / 校园经历
- 仅保留与岗位相关、有事实支撑的 1-3 条；没有就省略本模块`;

    const system = `你是 ${this.label}，服务于计算机相关专业应届生校招，精通 ATS/AI 预筛规则、HR 扫描习惯与技术面试官追问逻辑。

【最高优先级 · 真实性铁律 —— 违反即失败】
1. 所有字段（profile / stars / rewrites / md / issues）只能使用简历原文中出现的事实：不得新增项目、经历、竞赛、奖项、链接、身份标签；
2. 数字只能照搬原文且禁止加码：原文「200+」就写 200+，不得写成 300+；原文没有的 QPS/用户量/性能数字一律不得杜撰，用【请补充：…】占位；
3. 简历没有但 JD 需要的能力，只能写进 kwMissing 与 todo，绝不允许在成品简历里"帮他会"；
4. 你的工作是重排、润色、诊断，不是替候选人编造成就。疑似原文夸大的内容在 issues 中提示，而不是继续放大；
5. stars 的每个字段、rewrites 的 after 同样受本铁律约束：只允许改措辞/结构，禁止新增原文没有的数字、名次、QPS、用户量、延迟、奖项、技术名词；
   原文缺量化时写「【请补充：…】」占位。每写一个数字或技术名词前先自问：简历原文里有吗？没有就删。
6. stars 是对原文项目的事实复述与备面提纲，不是改写建议：每个字段必须以项目/候选人为主语，
   禁止出现「简历/JD/原简历/植入/对齐/建议重写/未体现」等诊断视角词汇；
   修过什么课程不等于做过什么实践，禁止从课程名推断项目经历（如不得因「操作系统」课就写「实现内存池/多线程同步」）。

7. 英文技术名词白名单：用户消息会给出从简历原文提取的技术名词清单，stars/rewrites/profile/md 的技能与项目描述中
   只能出现白名单内的英文名词；白名单之外（如 epoll、状态机、Kafka、线程池）只能出现在 kwMissing / todo；
   中文功能点同理——原文「点餐下单」不得扩写成「支付/退款/优惠券」，原文「练习算法」不得扩写成具体题型/算法名。
8. 白名单允许使用名词，但不允许虚构用法：仅出现在技能栏、未在项目句中出现的技术，不得写成「在该项目中使用」；
9. 项目/经历的起止时间原文没有时一律写「【请补充：起止时间】」，禁止编日期；
   md 中每个项目 bullet 只复述 factBase.projects 中该项目的事实，题型、模块、架构一律不扩写；
   项目技术栈行只能写该项目 facts 里出现的技术，否则整行写「技术栈：【请补充】」；
10. 【生成顺序】先完成 factBase（逐字摘录，不要改写），再逐项生成其余字段；
    其余字段每写一个事实（项目功能、技术用法、数字、时间、奖项、课程实践），都必须能在 factBase 找到来源；找不到就删掉或写【请补充】。
    特别地：「练习数据结构与算法」这类笼统描述，只能改写措辞，禁止补成具体算法名/题型；技能栏名词不得下沉为项目实践。

【正误对照 · 必须照此尺度执行】
原文「用 Redis 缓存热点菜品，提高了性能」（无数字）：
✗ after「基于 Redis 将响应从 800ms 降至 120ms」（数字杜撰）
✓ after「基于 Redis 缓存热点菜品降低读压力，性能提升【请补充：优化前后响应时间】」
原文「参与算法竞赛训练，练习数据结构与算法」：
✗ after「实现 20+ 模板，周赛前 10%」（数量与名次杜撰）  ✗ stars.situation「简历未体现 C++ 深度」（诊断视角）
✓ after「以 C++ 持续训练数据结构与算法，完成【请补充：题量】题、获【请补充：名次或写未获奖】」
✓ stars.situation「校算法竞赛训练，需在限时内综合运用多类算法解题」
原文「掌握 C/C++ 基本语法」：
✗ profile「完成多线程同步、内存池模拟实践」（从课程/要求脑补的经历）
✓ profile「掌握 C/C++ 基本语法与常用数据结构，具备操作系统/网络理论基础（无 C++ 项目经验，见补强清单）」

${this.KNOWLEDGE}

${mdRule}

【输出要求】只输出一个符合 JSON Schema 的 JSON 对象，不要输出任何解释或 Markdown 代码块包裹。
篇幅预算（严格遵守，输出必须完整闭合）：scoreText≤30字；profile 2-3行；stars 2个且每字段≤40字；
rewrites 2组且 after≤50字；issues 4条且每条≤55字；todo 4条且每条≤40字；kwHit≤6、kwMissing≤5；
md≤850汉字、每项目 bullet 2-3条。宁可精炼也不要超长。
评分从严、拉开梯度，禁止全维度 85+；所有引用必须来自简历原文，不得虚构项目、数据、链接。
语言全部中文；JSON 字符串内换行用 \\n。`;

    const wlNote = `\n\n【简历原文技术名词白名单】（成品简历/精修/STAR 只能使用这些；JD 词不算白名单）：${whitelist.join('、') || '（原文未提取到英文技术名词）'}`;

    const user = hasJD
      ? `【目标岗位 JD】（本次按该 JD 定向优化，技能与项目向 JD 关键词倾斜）：
${jdText.trim()}

【我的简历原文】：
${resumeText}${wlNote}`
      : `【我的简历原文】（暂无指定 JD，按通用技术岗校招标准优化，kwHit/kwMissing 返回空数组）：
${resumeText}${wlNote}`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  },

  /* ----------------------------------------------------------------
   * 离线 mock：对齐 DEMO 简历（Java/小程序）的新结构兜底结果
   * ---------------------------------------------------------------- */
  mock() {
    return {
      score: 62,
      scoreText: '项目有真实数据，但技能堆砌且缺个人总结与求职意向。',
      dims: [60, 68, 55, 72, 58],
      profile:
        '- 软件工程本科，主攻 Java 后端，有从 0 到 1 全栈项目落地经验（微信小程序 + Spring Boot）\n' +
        '- ACM 区域赛铜奖，LeetCode 200+，具备算法与数据结构基础\n' +
        '- 项目经历覆盖缓存、并发控制等真实高并发场景，能量化产出',
      kwHit: [],
      kwMissing: [],
      stars: [
        {
          title: '校园点餐小程序｜独立全栈开发｜2024.03-2024.09',
          stack: '微信小程序、Java Spring Boot、MySQL、Redis',
          situation: '校内用餐高峰线下排队平均等待 8 分钟，需要线上化点餐分流',
          task: '独立负责从 0 到 1 的小程序前端与后端核心链路',
          action: '设计订单表与状态机；用 Redis 缓存热点菜品与库存；以轻量级锁（Redis/Lua 原子校验）防止并发超卖',
          result: '上线后覆盖全校 2,000+ 师生，峰值 QPS≈120，等待时长 8 分钟→1.5 分钟；建议补充：可用性/Bug 率统计口径'
        },
        {
          title: 'ACM 算法训练｜校队成员｜2023.09-2024.11',
          stack: 'C/C++、动态规划、图论、线段树',
          situation: '区域赛要求 5 小时内组合解决 DP/图论/数据结构多题',
          task: '负责个人专项训练与题解模板沉淀',
          action: '专项突破动态规划与线段树，整理 200+ 题解模板并在校队分享',
          result: '获区域赛铜奖、校一等奖；训练通过率 40%→78%'
        }
      ],
      rewrites: [
        {
          before: '使用 Redis 做缓存，提高了系统性能。',
          after: '基于 Redis 缓存热点菜品与库存，峰值 QPS≈120 下接口平均响应稳定在百毫秒级，等待时长由 8 分钟降至 1.5 分钟。'
        },
        {
          before: '负责点餐小程序的后端接口开发。',
          after: '独立设计并实现订单状态机与下单接口，引入 Redis 原子校验解决并发超卖，支撑 2,000+ 师生高峰期下单。'
        },
        {
          before: '熟悉 Java、Spring Boot、MySQL、Redis、Linux、Docker、Git。',
          after: '后端：熟悉 Java（Spring Boot、JUC 基础）、MySQL（索引与事务）、Redis（缓存与分布式锁）；工具：了解 Linux、Docker、Git。'
        }
      ],
      issues: [
        { level: 'danger', text: '点餐项目若未说明个人贡献边界（独立/团队），易被怀疑外包或复刻；建议在项目中写明「独立完成」并准备架构图与代码量佐证。' },
        { level: 'warn', text: '「负责开发」「参与 xx」类空泛表述无信息增量，面试官无从追问；按「强动词+技术方案+量化结果」改写，见精修示范。' },
        { level: 'warn', text: '技能栏 7 个技术名词平铺且无主次，等于全部标注「可追问」；按语言/框架/存储/工具分类，并按目标 JD 排序。' },
        { level: 'tip', text: '缺少求职意向与个人总结，HR 5 秒内无法完成归类；在简历顶部补一行明确定位 + 2-3 条事实型亮点。' },
        { level: 'tip', text: '项目量化只有结果缺对比口径时说服力减半；建议补充优化前后对比、统计周期（如「上线一周内」）。' }
      ],
      todo: [
        '补充点餐项目的个人贡献证明：架构图、核心代码行数、Git 提交记录',
        '为两个项目各补 1-2 个带前后对比的指标（响应时间、Bug 率、覆盖人数统计周期）',
        '顶部补全联系方式与 GitHub/博客链接（空仓库不要放）',
        '按目标 JD 重排技能顺序，删减与岗位无关的名词',
        '终稿压到 1 页 A4，导出单栏 PDF 后用纯文本复制测试 ATS 可读性'
      ],
      md:
`# 张同学｜后端开发工程师（校招·Java 方向）
手机【请补充】｜邮箱【请补充】｜GitHub【请补充：有真实项目再放】

## 个人总结
- 软件工程本科，主攻 Java 后端，独立完成过 0→1 全栈项目（微信小程序 + Spring Boot）
- ACM 区域赛铜奖，LeetCode 200+，算法与数据结构基础扎实
- 项目覆盖缓存、并发控制等真实高并发场景，成果可量化（2,000+ 用户 / QPS≈120）

## 教育背景
**XX 大学｜软件工程｜本科｜2022.09-2026.06**
相关课程：数据结构、计算机网络、操作系统、数据库原理

## 专业技能
- **语言基础**：熟悉 Java（集合、JUC 基础）；掌握 C/C++ 基本语法与常见算法
- **框架与中间件**：熟悉 Spring Boot、Redis（缓存设计、分布式锁）；了解消息队列基本概念
- **数据存储**：熟悉 MySQL（索引、事务隔离级别）
- **工程工具**：了解 Linux、Docker、Git

## 项目经历
### 校园点餐小程序｜独立全栈开发｜2024.03-2024.09
\`技术栈：微信小程序、Java Spring Boot、MySQL、Redis\`
- 为解决高峰期线下排队平均 8 分钟的问题，从 0 到 1 设计并实现小程序前端与订单后端，覆盖全校 2,000+ 师生
- 设计订单状态机与下单接口，基于 Redis 缓存热点菜品与库存，峰值 QPS≈120
- 用 Redis 原子校验（Lua）实现轻量级锁防止并发超卖，上线后等待时长由 8 分钟降至 1.5 分钟【建议补充：统计周期与 Bug 率】

### ACM 算法训练｜校队成员｜2023.09-2024.11
\`技术栈：C/C++、动态规划、图论、线段树\`
- 专项突破动态规划与线段树，沉淀 200+ 题解模板并在校队分享，训练通过率由 40% 提升至 78%
- 获 ICPC/CCPC 区域赛铜奖【请核对真实赛事名称】、校一等奖

## 竞赛与荣誉
- ACM 区域赛铜奖（2024）、校一等奖学金【请补充：年份与获奖比例】

## 开源 / 校园经历
- 【请补充：如有技术博客、开源 PR、社团技术负责人经历，按「角色+成果」写 1-3 条；没有则删除本模块】`
    };
  }
};
