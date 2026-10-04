/* =====================================================================
 * agent-overview.js — Agent 0｜人岗匹配总览（调度中枢）
 *  · 在四大执行 Agent 之前先做一次"人岗匹配体检"：
 *    匹配总分 / 多维雷达 / 亮点 / 风险 / 下一步动作 / 四模块快捷入口
 *  · AIStats：全局 AI 用量与"节省时间"效率看板（LS 持久化）
 *  · runGuide：一键导览（示例数据 → 匹配 → JD 拆解 → 简历优化）
 * 依赖：utils.js、ai-client.js、demo-data.js；需在 agent-jd.js 之前加载
 * ===================================================================== */

/* ================================================================
 * AIStats — 用量与效率看板（被 ai-client.js 的 _track 钩子调用）
 * ================================================================ */
const STATS_LABELS = {
  match: '人岗匹配', jd: 'JD 解析', resume: '简历优化', vision: '图片识别',
  interview: '模拟面试', report: '复盘报告', mail: '邮件话术', tool: '工具调用', ping: '连通测试'
};
/* 每次调用替代的人工耗时（分钟），用于效率看板估算 */
const SAVED_MIN = {
  match: 4, jd: 5, resume: 5, vision: 3,
  interview: 3, report: 6, mail: 3, tool: 2, ping: 0
};

const AIStats = {
  key: 'overviewStats',
  data: null,

  fresh() {
    return {
      calls: {}, tokens: { prompt: 0, completion: 0, total: 0 }, models: {},
      savedMin: 0, lastAt: null,
      sessions: 0,        /* 已完成的模拟面试场次 */
      practiceMin: 0,     /* 累计陪练时长（分钟，按面试开始→生成报告计时） */
      matchHistory: []    /* 匹配分提升曲线：[{t, s}]，最多保留 40 个点 */
    };
  },
  load() {
    const d = LS.get(this.key, null);
    this.data = d && typeof d === 'object' ? d : this.fresh();
    this.data.calls = this.data.calls || {};
    this.data.tokens = this.data.tokens || { prompt: 0, completion: 0, total: 0 };
    this.data.models = this.data.models || {};
    this.data.sessions = Number(this.data.sessions) || 0;
    this.data.practiceMin = Number(this.data.practiceMin) || 0;
    this.data.matchHistory = Array.isArray(this.data.matchHistory) ? this.data.matchHistory : [];
  },
  /* 完成一场模拟面试：累计场次 + 陪练时长（分钟） */
  recordInterview(durationMin) {
    if (!this.data) this.load();
    this.data.sessions += 1;
    this.data.practiceMin += Math.max(1, Math.round(Number(durationMin) || 0));
    this.data.lastAt = Date.now();
    LS.set(this.key, this.data);
    this.render();
  },
  /* 每次生成匹配度：追加一个曲线点 */
  recordMatch(score) {
    if (!this.data) this.load();
    const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    this.data.matchHistory.push({ t: Date.now(), s });
    if (this.data.matchHistory.length > 40) this.data.matchHistory = this.data.matchHistory.slice(-40);
    LS.set(this.key, this.data);
    this.render();
  },
  /* usage: { prompt_tokens, completion_tokens, total_tokens }（DashBase 字段名） */
  track(stat, usage, model) {
    if (!this.data) this.load();
    const s = stat || 'call';
    this.data.calls[s] = (this.data.calls[s] || 0) + 1;
    const u = usage || {};
    this.data.tokens.prompt += Number(u.prompt_tokens) || 0;
    this.data.tokens.completion += Number(u.completion_tokens) || 0;
    this.data.tokens.total += Number(u.total_tokens) || 0;
    if (model) this.data.models[model] = (this.data.models[model] || 0) + 1;
    this.data.savedMin += SAVED_MIN[s] != null ? SAVED_MIN[s] : 2;
    this.data.lastAt = Date.now();
    LS.set(this.key, this.data);
    this.render();
  },
  reset() {
    this.data = this.fresh();
    LS.set(this.key, this.data);
    this.render();
    toast('效率看板已清零');
  },
  render() {
    const box = $('ovStats');
    if (!box || !this.data) return;
    const d = this.data;
    const totalCalls = Object.values(d.calls).reduce((a, b) => a + b, 0);
    const min = d.savedMin || 0;
    const savedText = min >= 60 ? (min / 60).toFixed(1).replace(/\.0$/, '') + ' 小时' : min + ' 分钟';
    const fmtTokens = n => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n || 0);
    const maxCalls = Math.max(1, ...Object.values(d.calls));

    const sceneRows = Object.keys(STATS_LABELS)
      .filter(k => d.calls[k])
      .sort((a, b) => d.calls[b] - d.calls[a])
      .map(k => `
        <div class="flex items-center gap-2 text-[11.5px]">
          <span class="w-16 shrink-0 text-[#8a8a96]">${STATS_LABELS[k]}</span>
          <div class="skillbar flex-1"><span style="width:${Math.round(d.calls[k] / maxCalls * 100)}%"></span></div>
          <span class="w-8 shrink-0 text-right tabular-nums text-[#d9d9e2]">${d.calls[k]}</span>
        </div>`).join('');

    const modelChips = Object.keys(d.models)
      .map(m => `<span class="chip !normal-case !tracking-normal">Qwen ${qwenShortName(m)} × ${d.models[m]}</span>`)
      .join('');

    /* ---- 陪练时长 / 面试场次 / 匹配分曲线 ---- */
    const pMin = Math.round(d.practiceMin || 0);
    const practiceText = pMin >= 60
      ? (Math.floor(pMin / 60)) + 'h' + (pMin % 60 ? (pMin % 60) + 'm' : '')
      : pMin + ' 分钟';
    const hist = Array.isArray(d.matchHistory) ? d.matchHistory : [];
    const lastScore = hist.length ? hist[hist.length - 1].s : null;
    const firstScore = hist.length ? hist[0].s : null;
    const delta = hist.length >= 2 ? lastScore - firstScore : null;
    const deltaHtml = delta == null ? '<span class="text-[#62626e]">—</span>'
      : delta > 0 ? `<span class="text-emerald-400">▲${delta}</span>`
      : delta < 0 ? `<span class="text-red-400">▼${Math.abs(delta)}</span>`
      : '<span class="text-[#8a8a96]">0</span>';

    /* 内联 SVG 迷你折线（无第三方依赖） */
    let spark = '';
    if (hist.length >= 2) {
      const W = 240, H = 52, P = 6;
      const xs = hist.map((_, i) => P + i * (W - 2 * P) / (hist.length - 1));
      const ys = hist.map(p => H - P - (p.s / 100) * (H - 2 * P));
      const line = xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');
      const area = `${line} L ${xs[xs.length - 1].toFixed(1)} ${H - P} L ${xs[0].toFixed(1)} ${H - P} Z`;
      const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${i === xs.length - 1 ? 3 : 1.6}" fill="${i === xs.length - 1 ? '#3df59d' : '#8ff5c8'}"/>`).join('');
      spark = `
      <div class="mt-3 rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
        <div class="mb-1 flex items-center justify-between text-[11px] text-[#8a8a96]">
          <span>匹配分提升曲线（${hist.length} 次评估）</span>
          <span>首次 ${firstScore} → 最近 ${lastScore} ｜ ${deltaHtml}</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="h-[52px] w-full" preserveAspectRatio="none">
          <defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3df59d" stop-opacity=".28"/><stop offset="100%" stop-color="#3df59d" stop-opacity="0"/>
          </linearGradient></defs>
          <line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="#23232a" stroke-dasharray="3 4"/>
          <path d="${area}" fill="url(#sparkFill)"/>
          <path d="${line}" fill="none" stroke="#3df59d" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
          ${dots}
        </svg>
      </div>`;
    }

    box.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-[12px] font-bold uppercase tracking-wider text-[#3df59d]">📈 协作效率看板</div>
        <button class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" onclick="AIStats.reset()">清零统计</button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num">${totalCalls}</div><div class="stat-label">AI 调用（次）</div>
        </div>
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num">${fmtTokens(d.tokens.total)}</div><div class="stat-label">累计 Token</div>
        </div>
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num text-emerald-400">${savedText}</div><div class="stat-label">预计节省人工</div>
        </div>
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num text-emerald-400">${practiceText}</div><div class="stat-label">累计陪练时长</div>
        </div>
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num">${d.sessions || 0}</div><div class="stat-label">模拟面试（场）</div>
        </div>
        <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
          <div class="stat-num">${lastScore == null ? '—' : lastScore} <span class="text-[13px]">${deltaHtml}</span></div><div class="stat-label">最新匹配分</div>
        </div>
      </div>
      ${spark}
      ${sceneRows ? `<div class="mt-3 space-y-1.5">${sceneRows}</div>` : ''}
      ${modelChips ? `<div class="mt-3 flex flex-wrap gap-1.5">${modelChips}</div>` : ''}
      <div class="mt-2 text-[10.5px] leading-relaxed text-[#62626e]">
        * 数据仅保存在本机浏览器；"节省人工"按各场景传统人工耗时估算（匹配 4 分钟 / JD 拆解 5 分钟 / 简历优化 5 分钟 / 面试复盘 6 分钟 / 话术 3 分钟）；陪练时长按面试实际用时统计。
      </div>`;
  }
};

/* ================================================================
 * Agent 0 — 人岗匹配分析
 * ================================================================ */
let matchStore = null;
let guideRunning = false;

/* 严格 JSON Schema（qwen-plus 已实测支持；失败时 ai-client 自动降级 json_object） */
const MATCH_SCHEMA = {
  name: 'match_result',
  schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', description: '人岗匹配总分 0-100' },
      level: { type: 'string', description: '评级：高度匹配 / 较为匹配 / 部分匹配 / 匹配度较低' },
      summary: { type: 'string', description: '一句话总评，40字内' },
      labels: { type: 'array', items: { type: 'string' }, description: '5-6个评估维度名称（4-8字）' },
      scores: { type: 'array', items: { type: 'integer' }, description: '与 labels 等长的 0-100 分数' },
      highlights: { type: 'array', items: { type: 'string' }, description: '候选人相对该JD的3个核心亮点' },
      risks: { type: 'array', items: { type: 'string' }, description: '3个主要匹配风险/短板，需具体到技能点' },
      nextActions: { type: 'array', items: { type: 'string' }, description: '3条最优先的下一步行动建议' }
    },
    required: ['score', 'level', 'summary', 'labels', 'scores', 'highlights', 'risks', 'nextActions'],
    additionalProperties: false
  }
};

const MATCH_SYS_PROMPT = `你是资深技术招聘官兼应届生求职教练。根据候选人简历与目标岗位 JD 做人岗匹配评估。
只输出一个 JSON 对象，不要输出任何解释文字。
评分维度建议（可按岗位调整为 5-6 个）：岗位核心技能、项目/实践经验、计算机基础、软实力与自驱力、投递竞争力。
要求：分数必须贴合两份材料、拉开梯度，不能虚高；亮点与风险必须引用简历/JD 中的具体技能点；全部中文。`;

/* 无 AI 时的本地兜底结果（对齐 DEMO：Java/小程序简历 vs C++ 后端 JD） */
function buildMockMatch() {
  return {
    score: 64,
    level: '较为匹配 · 有明确短板',
    summary: '后端通用能力可迁移，但 C++ 与网络编程两块硬门槛需要 4-6 周补强。',
    labels: ['核心技能', '项目经验', '计算机基础', '软实力/自驱', '投递竞争力'],
    scores: [52, 68, 70, 76, 60],
    highlights: [
      'Java + Spring Boot + MySQL + Redis 后端栈与岗位工程能力同源，点餐小程序有真实高并发落点（峰值 QPS≈120）。',
      '完整 0→1 项目经历覆盖前后端，2,000+ 师生使用，具备可讲的规模与结果数据。',
      'ACM 算法训练 + 校级奖学金，正中 JD"竞赛经历优先"的隐性加分项。'
    ],
    risks: [
      'JD 首要硬门槛是 C/C++、STL、多线程与内存管理，简历仅写"掌握基本语法"，笔试与一面风险最高。',
      '要求 Linux 网络编程（socket / epoll / TCP-IP 实战），简历中无对应项目或抓包实践证据。',
      '分布式 / 高可用 / 性能调优仅为"了解"层面，缺少压测、中间件与故障排查的量化经历。'
    ],
    nextActions: [
      '先用 Agent 1 拆解 JD，拿到 6 周分阶段学习路线，优先补 C++ 与网络编程。',
      '用 Agent 2 把点餐小程序改写为 STAR + 量化表达，并补一段 C++/网络相关的小项目。',
      '到 Agent 3 完成 3 轮 C++ 后端专项模拟面试，再用 Agent 4 管理投递节奏与跟进话术。'
    ]
  };
}

/* 校验 / 修补模型返回，保证渲染层不崩 */
function normalizeMatch(d) {
  d = d || {};
  const fb = buildMockMatch();
  let labels = Array.isArray(d.labels) ? d.labels.map(String).filter(Boolean).slice(0, 6) : [];
  if (labels.length < 3) labels = fb.labels;
  const clamp = (n, lo = 8, hi = 98, fbV) => {
    const v = Math.round(Number(n));
    if (!isFinite(v)) return fbV;
    return Math.max(lo, Math.min(hi, v));
  };
  const scores = labels.map((lb, i) =>
    clamp(Array.isArray(d.scores) ? d.scores[i] : NaN, 8, 98, fb.scores[Math.min(i, fb.scores.length - 1)]));
  const pickStrs = (v, n, fbArr) => {
    const arr = (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, n);
    while (arr.length < Math.min(n, fbArr.length)) arr.push(fbArr[arr.length]);
    return arr;
  };
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const score = clamp(d.score, 3, 99, avg);
  return {
    score,
    level: String(d.level || '').trim() || (score >= 80 ? '高度匹配' : score >= 60 ? '较为匹配' : score >= 45 ? '部分匹配' : '匹配度较低'),
    summary: String(d.summary || '').trim() || fb.summary,
    labels,
    scores,
    highlights: pickStrs(d.highlights, 3, fb.highlights),
    risks: pickStrs(d.risks, 3, fb.risks),
    nextActions: pickStrs(d.nextActions, 3, fb.nextActions)
  };
}

/* 刷新 m0 顶部"JD / 简历素材"字数状态 */
function refreshOverviewMeta() {
  const jd = ($('jdInput')?.value || '').trim();
  const rs = ($('resumeInput')?.value || '').trim();
  const jdEl = $('ovJdLen'), rsEl = $('ovRsLen');
  if (jdEl) jdEl.textContent = jd ? `已填写 ${jd.length} 字 · 评估时使用当前文本` : '尚未填写（评估时将自动载入示例）';
  if (rsEl) rsEl.textContent = rs ? `已填写 ${rs.length} 字 · 评估时使用当前文本` : '尚未填写（评估时将自动载入示例）';
}

/* 点击「生成匹配度」 */
async function runMatch() {
  let jd = ($('jdInput')?.value || '').trim();
  let rs = ($('resumeInput')?.value || '').trim();
  /* 与各 Agent 一致：空文本自动载入示例，保证一键可跑 */
  if (!jd) { jd = DEMO.jd; $('jdInput').value = jd; LS.set('jdInput', jd); }
  if (!rs) { rs = DEMO.resume; $('resumeInput').value = rs; LS.set('resumeInput', rs); }

  disableBtn('ovMatchBtn');
  const box = $('ovResult');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card p-5">
      <div class="flex items-center gap-3">
        <div class="loader-dots"><i></i><i></i><i></i></div>
        <div class="text-[13px] text-[#8a8a96]">
          <b class="text-white">人岗匹配 Agent</b> 正在比对简历与 JD · 计算五维匹配度 · 定位亮点与风险…
        </div>
      </div>
    </div>`;

  if (AI.enabled) {
    try {
      const raw = await AI.chatJSON([
        { role: 'system', content: MATCH_SYS_PROMPT },
        { role: 'user', content: `【目标岗位 JD】\n${jd}\n\n【候选人简历】\n${rs}\n\n请输出人岗匹配评估 JSON。` }
      ], { task: 'std', stat: 'match', schema: MATCH_SCHEMA, temperature: 0.4, max_tokens: 2200, timeout: 90000 });
      matchStore = normalizeMatch(raw);
      matchStore._real = true;
    } catch (e) {
      toast(e.message || 'AI 调用失败，已切换本地模拟评估');
      matchStore = buildMockMatch();
    }
  } else {
    await sleep(1200);
    matchStore = buildMockMatch();
  }
  LS.set('matchResult', matchStore);
  AIStats.recordMatch(matchStore.score);
  renderOverview();
  refreshOverviewMeta();
  enableBtn('ovMatchBtn');
}

/* 渲染总览（有结果） */
function renderOverview() {
  const d = matchStore;
  const box = $('ovResult');
  if (!d) { renderOverviewEmpty(); return; }
  box.classList.remove('hidden');

  const ringColor = d.score >= 80 ? '#3df59d' : d.score >= 60 ? '#8ff5c8' : d.score >= 45 ? '#fbbf24' : '#f87171';
  const levelClass = d.score >= 60 ? 'text-emerald-400' : d.score >= 45 ? 'text-amber-400' : 'text-red-400';

  box.innerHTML = `
    <!-- 总分 + 雷达 -->
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#3df59d]">
        🎯 人岗匹配体检报告
        ${d._real ? '<span class="chip chip-green !normal-case !tracking-normal">通义千问 Qwen 实时评估</span>' : '<span class="chip !normal-case !tracking-normal">本地模拟评估</span>'}
      </div>
      <div class="grid items-center gap-5 md:grid-cols-[260px_1fr]">
        <div class="flex flex-col items-center gap-3">
          <div class="score-ring" style="background:conic-gradient(${ringColor} ${d.score * 3.6}deg, rgba(255,255,255,.08) 0deg)">
            <div class="score-inner">
              <b style="color:${ringColor}">${d.score}</b>
              <span>匹配分 / 100</span>
            </div>
          </div>
          <span class="chip ${d.score >= 60 ? 'chip-green' : d.score >= 45 ? 'chip-amber' : 'chip-red'} !normal-case !tracking-normal">${esc(d.level)}</span>
        </div>
        <div>
          <div class="rounded-lg border border-[#23232a] bg-[#0b0b0e] p-2"><canvas id="ovRadar"></canvas></div>
          <p class="mt-3 text-[13px] leading-relaxed text-[#b6b6c2]">${esc(d.summary)}</p>
        </div>
      </div>
    </div>

    <!-- 亮点 / 风险 -->
    <div class="grid gap-4 md:grid-cols-2">
      <div class="card fade-up p-4">
        <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-emerald-400">💚 核心亮点</div>
        <div class="space-y-2">
          ${d.highlights.map(h => `
            <div class="flex gap-2.5 rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12.5px] leading-relaxed text-[#d9d9e2]">
              <span class="text-emerald-400">＋</span><span>${esc(h)}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card fade-up p-4">
        <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-red-400">⚠ 匹配风险</div>
        <div class="space-y-2">
          ${d.risks.map(h => `
            <div class="flex gap-2.5 rounded-lg border border-[#3a2a2a] bg-[#160f0f] p-3 text-[12.5px] leading-relaxed text-[#e6d6d6]">
              <span class="text-red-400">！</span><span>${esc(h)}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- AI 建议的下一步 -->
    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">📌 优先行动建议</div>
      <ol class="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-[#b6b6c2]">
        ${d.nextActions.map(a => `<li>${esc(a)}</li>`).join('')}
      </ol>
    </div>

    <!-- 四模块快捷入口 -->
    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-[#8a8a96]">🚀 进入四大执行 Agent</div>
      <div class="grid gap-2.5 sm:grid-cols-2">
        <button onclick="selectModule('m1')" class="quick-entry text-left">
          <b>⚙ Agent 1 · JD 解析</b><span>拆解技能矩阵，生成 6 周补强路线</span>
        </button>
        <button onclick="selectModule('m2')" class="quick-entry text-left">
          <b>📄 Agent 2 · 简历优化</b><span>STAR 改写经历，检测空话与风险</span>
        </button>
        <button onclick="selectModule('m3')" class="quick-entry text-left">
          <b>🎙 Agent 3 · 模拟面试</b><span>结合简历 JD 多轮追问与复盘评分</span>
        </button>
        <button onclick="selectModule('m4')" class="quick-entry text-left">
          <b>🗂 Agent 4 · 投递台账</b><span>管理投递状态，生成跟进邮件话术</span>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn btn-primary !py-2 !text-[12px]" onclick="runMatch()">🔄 重新评估匹配度</button>
        <button class="btn btn-ghost !py-2 !text-[12px]" onclick="runGuide()">🚀 一键完整导览</button>
      </div>
    </div>`;

  setTimeout(() => radar('ovRadar', d.labels, d.scores), 30);
}

/* 空态 */
function renderOverviewEmpty() {
  const box = $('ovResult');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card fade-up p-7 text-center">
      <div class="text-4xl">🎯</div>
      <h3 class="mt-3 text-[16px] font-extrabold">人岗匹配体检 · 30 秒找到求职突破口</h3>
      <p class="mx-auto mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-[#8a8a96]">
        Agent 0 先行调度：读取你在 Agent 1 / Agent 2 中维护的 JD 与简历，输出匹配总分、五维雷达、
        核心亮点与风险，并把任务派发给四大执行 Agent。
      </p>
      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <button class="btn btn-primary" onclick="runMatch()">🎯 生成匹配度</button>
        <button class="btn btn-ghost" onclick="runGuide()">一键体验完整演示</button>
      </div>
      <div class="mt-3 text-[11.5px] text-[#62626e]">JD / 简历为空时将自动载入内置示例，随时可替换为你自己的内容。</div>
    </div>`;
}

/* ================================================================
 * 一键导览：示例数据 → 匹配 → JD → 简历（全自动串联）
 * ================================================================ */
async function runGuide() {
  if (guideRunning) { toast('导览正在进行中…'); return; }
  guideRunning = true;
  try {
    toast('① 载入示例岗位 JD 与候选人简历…');
    $('jdInput').value = DEMO.jd; LS.set('jdInput', DEMO.jd);
    $('resumeInput').value = DEMO.resume; LS.set('resumeInput', DEMO.resume);
    selectModule('m0');
    await sleep(500);
    await runMatch();
    await sleep(900);

    toast('② Agent 1 正在拆解 JD 技能图谱…');
    selectModule('m1');
    await sleep(600);
    await runJD();
    await sleep(900);

    toast('③ Agent 2 正在用 STAR 法则优化简历…');
    selectModule('m2');
    await sleep(600);
    await runResume();
    await sleep(1000);

    selectModule('m0');
    toast('✅ 导览完成：可继续进入模拟面试 / 投递台账');
  } finally {
    guideRunning = false;
  }
}

/* ================================================================
 * 启动入口（由 app.js init 调用）
 * ================================================================ */
function initOverview() {
  AIStats.load();
  AIStats.render();
  const saved = LS.get('matchResult', null);
  if (saved && Array.isArray(saved.labels) && saved.labels.length >= 3) {
    matchStore = saved;
    renderOverview();
  } else {
    renderOverviewEmpty();
  }
  refreshOverviewMeta();
  /* JD / 简历文本被编辑时，同步顶部素材状态 */
  $('jdInput')?.addEventListener('input', refreshOverviewMeta);
  $('resumeInput')?.addEventListener('input', refreshOverviewMeta);
}
