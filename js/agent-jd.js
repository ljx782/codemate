/* =====================================================================
 * agent-jd.js — Agent 1｜JD 拆解与技能诊断
 * 解析岗位 JD → 岗位概览 / 硬技能·加分·隐性要求 /
 * 技能差距分析 / 分阶段学习路线 / 技能雷达图
 * 对外暴露：runJD / renderJD / jdStore / loadJDExample / clearJD
 * ===================================================================== */

const JD_AGENT = {
  /* 模拟 Agent 解析：基于演示 JD 返回结构化结果 */
  parse(/* text */) {
    const labels = ['编程语言', '算法/数据结构', '操作系统/网络', '数据库', '分布式/并发', '工程协作'];
    const scores = [78, 62, 48, 52, 34, 72];
    return {
      overview: {
        role: 'C++ 后端开发工程师（校招）',
        level: '校招 / 应届生',
        tags: ['C++', 'STL', 'Linux网络', '多线程', 'MySQL', 'Redis', '分布式', '高并发', '性能调优']
      },
      hardSkills: [
        { name: 'C/C++ 语法 · STL · 内存管理', level: '掌握一般，需补强', gap: 62, note: '重点：STL 容器迭代器、智能指针、左值右值移动语义' },
        { name: '多线程 / 并发编程', level: '学校课程了解，缺实践', gap: 54, note: '线程同步、锁、原子操作、线程池' },
        { name: 'Linux 系统与网络编程', level: '懂基础，无实战', gap: 48, note: 'socket、epoll、TCP/HTTP 抓包分析' },
        { name: 'MySQL / Redis', level: '会增删改查，到不了优化层', gap: 52, note: '索引原理、事务隔离、缓存穿透/击穿' }
      ],
      bonusSkills: ['分布式理论（CAP/Raft）', '性能调优与压测', 'Docker / K8s 部署'],
      hidden: [
        { name: '开源项目 / 技术博客', why: 'HR 判断自驱与学习能力，本简历缺' },
        { name: 'ACM / LeetCode 竞赛经历', why: '证明算法硬核，是加分信号' },
        { name: '系统设计表达力', why: '面试官会考察方案是否讲得清楚' }
      ],
      gapText: {
        level: '综合技能差距约 45%',
        summary: '基础编程能力可迁移到 C++，但操作系统/网络与分布式两大硬核板块差距最明显，属于招聘方优先筛选点。'
      },
      road: [
        { phase: '第 1 周 · 语言与基础固化', items: ['刷 C++ 基础与 STL：容器、迭代器、智能指针', '手写 vector/string/Stack 各 1 份', '每日 3 道 LeetCode（优先数组、字符串）'], goal: '编程语言差距 62→40' },
        { phase: '第 2-3 周 · 操作系统与网络攻坚', items: ['精读《深入理解计算机系统》进程/线程/内存章节', '实现简易 socket + epoll 回显服务器', '用 tcpdump 抓包分析一次完整 HTTP 请求'], goal: '操作系统/网络差距 48→30' },
        { phase: '第 4-5 周 · 数据库与缓存', items: ['掌握 MySQL 索引演示与 explain 调优', '实现 Redis 缓存 + 防击穿/穿透方案', '梳理一次 JVM/OS 内存模型'], goal: '数据库差距 52→32' },
        { phase: '第 6+ 周 · 分布式与项目落地', items: ['了解 CAP、一致性哈希，写一篇总结', '把点餐小程序改造成高并发可压测版本', '输出技术博客 2 篇（补隐性要求）'], goal: '分布式差距 34→25' }
      ],
      radarLabels: labels,
      radarScores: scores,
      before: [78, 62, 48, 52, 34, 72],
      after:  [90, 82, 76, 80, 68, 88]
    };
  }
};

let jdStore = null;

/* 真实 AI：要求通义千问返回与渲染层严格匹配的 JSON */
const JD_SYS_PROMPT = `你是资深技术招聘官兼应届生求职教练。根据用户给出的岗位 JD（如有候选人简历也一并参考），完成结构化解析。
只输出一个 JSON 对象，不要输出任何解释文字，字段如下：
{
  "overview": { "role": "岗位名称", "level": "校招/实习/社招等", "tags": ["关键词", "6-10个"] },
  "hardSkills": [ { "name": "硬技能项", "level": "候选人当前掌握程度的简短判断", "gap": 差距0-100的整数(越大越欠缺), "note": "补强重点一句话" } ],
  "bonusSkills": ["加分技能1", "加分技能2"],
  "hidden": [ { "name": "隐性要求", "why": "为什么是隐性信号" } ],
  "gapText": { "level": "如：综合技能差距约45%", "summary": "100字内差距总结" },
  "road": [ { "phase": "阶段标题(含周数)", "items": ["可落地任务1", "任务2", "任务3"], "goal": "该阶段量化目标" } ],
  "radarLabels": ["5-7个能力维度"],
  "radarScores": [与radarLabels等长的0-100整数,代表普通对口应届生当前水平],
  "before": [与labels等长,当前分],
  "after": [与labels等长,学习后目标分,高于before]
}
要求：hardSkills 3-5 项；road 4 个阶段；所有中文输出；评分要拉开梯度、贴合 JD。`;

/* 校验 / 修补模型返回，保证渲染层不崩 */
function normalizeJD(d) {
  d = d || {};
  d.overview = d.overview || {};
  d.overview.role = d.overview.role || '目标岗位';
  d.overview.level = d.overview.level || '校招';
  d.overview.tags = Array.isArray(d.overview.tags) ? d.overview.tags.slice(0, 10) : [];
  d.hardSkills = (Array.isArray(d.hardSkills) ? d.hardSkills : []).slice(0, 5).map(h => ({
    name: h.name || '技能项',
    level: h.level || '待评估',
    gap: Math.max(5, Math.min(95, Number(h.gap) || 50)),
    note: h.note || ''
  }));
  d.bonusSkills = Array.isArray(d.bonusSkills) ? d.bonusSkills : [];
  d.hidden = (Array.isArray(d.hidden) ? d.hidden : []).map(h => ({ name: h.name || '', why: h.why || '' })).filter(h => h.name);
  d.gapText = d.gapText || {};
  d.gapText.level = d.gapText.level || '综合技能差距待评估';
  d.gapText.summary = d.gapText.summary || '';
  d.road = (Array.isArray(d.road) ? d.road : []).map(p => ({
    phase: p.phase || '学习阶段',
    items: Array.isArray(p.items) ? p.items : [],
    goal: p.goal || ''
  })).filter(p => p.items.length);
  let labels = Array.isArray(d.radarLabels) ? d.radarLabels.filter(Boolean).slice(0, 7) : [];
  if (labels.length < 3) labels = ['编程语言', '算法/数据结构', '操作系统/网络', '数据库', '工程协作'];
  const clamp = n => Math.max(5, Math.min(98, Math.round(Number(n) || 50)));
  d.radarLabels = labels;
  d.radarScores = labels.map((_, i) => clamp(d.radarScores?.[i]));
  d.before = labels.map((_, i) => clamp(d.before?.[i] ?? d.radarScores[i]));
  d.after = labels.map((_, i) => Math.max(d.before[i] + 5, Math.min(98, clamp(d.after?.[i] ?? d.before[i] + 15))));
  return d;
}

/* 点击「解析 JD」：有 Key 走真实 AI，否则本地模拟 */
async function runJD() {
  let text = $('jdInput').value.trim();
  if (!text) { text = DEMO.jd; $('jdInput').value = text; }
  disableBtn('jdBtn');
  showLoading('jdLoading');
  $('jdResult').classList.add('hidden');
  LS.set('jdInput', text);

  if (AI.enabled) {
    const resume = ($('resumeInput')?.value || '').trim();
    try {
      const raw = await AI.chatJSON([
        { role: 'system', content: JD_SYS_PROMPT },
        { role: 'user', content: `候选人简历（可能为空）：\n${resume || '（未提供）'}\n\n岗位 JD：\n${text}` }
      ], { task: 'std', stat: 'jd', temperature: 0.4, max_tokens: 3000, timeout: 90000 });
      jdStore = normalizeJD(raw);
      jdStore._real = true;
    } catch (e) {
      toast(e.message || 'AI 调用失败，已切换本地模拟');
      jdStore = JD_AGENT.parse(text);
    }
  } else {
    await sleep(1300);                       // 模拟 Agent 推理耗时
    jdStore = JD_AGENT.parse(text);
  }
  renderJD(jdStore);
  hideLoading('jdLoading');
  enableBtn('jdBtn');
  /* 联动 Agent 3 的 JD 上下文 */
  if ($('interviewJdCtx')) {
    $('interviewJdCtx').value = '岗位：' + jdStore.overview.role + ' · 核心要求：' + jdStore.radarLabels.join('/');
  }
}

/* 渲染解析结果 */
function renderJD(d) {
  $('jdResult').classList.remove('hidden');
  const hardRows = d.hardSkills.map(h => `
    <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 fade-up">
      <div class="text-[13px] font-bold leading-snug">${esc(h.name)}</div>
      <div class="mt-1 text-[12px] leading-relaxed ${h.gap > 55 ? 'text-amber-400' : 'text-emerald-400'}">${esc(h.level)}</div>
      <div class="skillbar mt-2"><span style="width:${h.gap}%"></span></div>
      <div class="mt-1.5 text-[12px] leading-relaxed text-[#8a8a96]">差距 ${h.gap}% · ${esc(h.note)}</div>
    </div>`).join('');

  const roadColors = ['#3df59d', '#34e89e', '#2dd4bf', '#34d399'];
  const roadHTML = d.road.map((p, i) => `
    <div class="border-l-2 pl-4 fade-up" style="border-color:${roadColors[i]}">
      <div class="text-[13px] font-bold">${esc(p.phase)}</div>
      <ul class="mt-1 list-disc pl-4 text-[12px] leading-relaxed text-[#b6b6c2]">
        ${p.items.map(x => `<li>${esc(x)}</li>`).join('')}
      </ul>
      <div class="mt-1 text-[11px] font-semibold text-emerald-400">目标：${esc(p.goal)}</div>
    </div>`).join('');

  $('jdResult').innerHTML = `
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#3df59d]">
        ① 岗位概览
        ${d._real ? '<span class="chip chip-green !normal-case !tracking-normal">通义千问 Qwen 实时生成</span>' : '<span class="chip !normal-case !tracking-normal">本地模拟</span>'}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip chip-brand">${esc(d.overview.role)}</span>
        <span class="chip chip-green">${esc(d.overview.level)}</span>
        <span class="chip">核心 / 专业对口</span>
      </div>
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${d.overview.tags.map(t => `<span class="rounded bg-[#151519] px-2 py-1 text-[11px] text-[#8ff5c8]">${esc(t)}</span>`).join('')}
      </div>
    </div>

    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-[#8a8a96]">② 技能区分 · 硬 / 加分 / 隐性</div>
      <div class="grid gap-4 md:grid-cols-3">
        <div>
          <div class="mb-2 text-[12px] font-semibold text-emerald-400">硬技能 · 必备</div>
          <div class="space-y-2">${hardRows}</div>
        </div>
        <div>
          <div class="mb-2 text-[12px] font-semibold text-amber-400">加分技能</div>
          <div class="space-y-2">
            ${d.bonusSkills.map(b => `<div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12px] text-[#b6b6c2]">＋ ${esc(b)}</div>`).join('')}
          </div>
          <div class="mb-2 mt-4 text-[12px] font-semibold text-red-400">隐性要求</div>
          <div class="space-y-2">
            ${d.hidden.map(h => `
              <div class="rounded-lg border border-[#3a2a2a] bg-[#160f0f] p-3">
                <div class="text-[12px] font-semibold">${esc(h.name)}</div>
                <div class="mt-0.5 text-[11px] text-[#b6b6c2]">${esc(h.why)}</div>
              </div>`).join('')}
          </div>
        </div>
        <div>
          <div class="mb-2 text-[12px] font-semibold text-[#2dd4bf]">技能雷达图</div>
          <div class="rounded-lg border border-[#23232a] bg-[#0b0b0e] p-2"><canvas id="jdRadar"></canvas></div>
        </div>
      </div>
    </div>

    <div class="card fade-up p-4">
      <div class="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">
        ③ 技能差距分析 <span class="chip chip-amber !normal-case !tracking-normal">${esc(d.gapText.level)}</span>
      </div>
      <p class="text-[13px] leading-relaxed text-[#b6b6c2]">${esc(d.gapText.summary)}</p>
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        ${d.radarLabels.map((l, i) => `
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-2.5 text-[11px]">
            <div class="text-[#8a8a96]">${esc(l)}</div>
            <div class="mt-1 flex items-center justify-between">
              <span class="text-[#f87171]">${d.before[i]}</span>
              <span class="text-[#62626e]">→</span>
              <span class="font-semibold text-emerald-400">${d.after[i]}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card fade-up p-4">
      <div class="mb-4 text-[12px] font-bold uppercase tracking-wider text-emerald-400">④ 分阶段可落地学习路线</div>
      <div class="space-y-5">${roadHTML}</div>
    </div>`;

  setTimeout(() => radar('jdRadar', d.radarLabels, d.radarScores), 30);
}

/* 示例 / 清空 */
function loadJDExample() { $('jdInput').value = DEMO.jd; runJD(); }
function clearJD() {
  $('jdInput').value = '';
  LS.set('jdInput', '');
  $('jdResult').classList.add('hidden');
}
