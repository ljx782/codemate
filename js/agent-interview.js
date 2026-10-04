/* =====================================================================
 * agent-interview.js — Agent 3｜多轮技术模拟面试
 * 两种模式：
 *  · 真实 AI：通义千问扮演面试官，携带简历+JD 上下文进行真正的多轮
 *    连续对话（历史消息随每轮发送），结束后由评估模型输出结构化报告；
 *  · 本地模拟：未配置 Key 时使用内置题库（八股/项目深挖/场景题）。
 * =====================================================================

/* ---------------- 本地模拟题库（无 Key 时使用） ---------------- */
const INTERVIEW = {
  banks: {
    '后端开发': [
      { type: '八股', q: '请解释一下 TCP 三次握手与四次挥手的过程，为什么需要四次挥手？' },
      { type: '八股', q: '什么是数据库索引？InnoDB 为什么用 B+ 树而不是 B 树或哈希表？' },
      { type: '八股', q: '说说 JVM 内存模型（内存分区）与 GC 的常见回收算法。' },
      { type: '项目深挖', q: '你在点餐小程序里用了 Redis 缓存热点菜品，说说缓存穿透、击穿、雪崩分别是什么？你怎么做的？' },
      { type: '项目深挖', q: '你说峰值 QPS 约 120，这个量是怎么算出来的？压测脚本做了哪些配置？' },
      { type: '场景题', q: '如果订单表在高峰出现并发超卖，你会怎么设计锁或乐观/悲观策略？' },
      { type: '八股', q: 'ThreadLocal 的作用与可能的内存泄漏问题，你是如何处理的？' },
      { type: '项目深挖', q: '这个项目的前后端如何通信？如果要把它改造成支持 10 倍并发，第一件事你会做什么？' },
      { type: '场景题', q: '请设计一个短链接系统，要求支持高并发读，说明存储与缓存方案。' }
    ],
    '网络工程': [
      { type: '八股', q: '请说明 OSI 七层与 TCP/IP 四层模型的对应关系。' },
      { type: '八股', q: '如何判断网络故障是发生在二层还是三层？给出排查思路。' },
      { type: '八股', q: '讲解 DNS 解析的完整过程，以及 DNS 缓存可能引入的问题。' },
      { type: '项目深挖', q: '你做过网络相关的项目吗？如何监控网络延迟与丢包率？' },
      { type: '场景题', q: '公司内网某服务器响应很慢，请设计一套从接入层到应用层的排查方案。' },
      { type: '八股', q: '谈谈 VLAN、子网划分与路由器的区别，如何设计办公网段？' },
      { type: '场景题', q: '如何评估一台服务器的带宽是否够用？给出指标与工具。' },
      { type: '八股', q: 'HTTPS 的握手流程与证书校验机制是怎样的？' }
    ],
    '小程序开发': [
      { type: '八股', q: '小程序与 H5 的渲染机制有什么区别？为什么小程序更流畅？' },
      { type: '八股', q: '小程序页面生命周期有哪些？onLoad / onShow / onReady 区别。' },
      { type: '八股', q: '小程序中 setData 的一个高频性能问题是什么？如何避免卡顿？' },
      { type: '项目深挖', q: '你的点餐小程序如何处理支付？支付回调如何保证一致性？' },
      { type: '场景题', q: '如果点餐高峰期小程序白屏，请给出排查步骤（入口 → 接口 → 渲染）。' },
      { type: '八股', q: '小程序分包加载的作用与实践场景是什么？' },
      { type: '项目深挖', q: '你的首页数据存储与更新策略？多长时间拉一次会更好？' },
      { type: '场景题', q: '请设计一个"扫码点餐 + 排队取号"的小程序，讲清数据流与状态机。' }
    ]
  },
  followups: [
    '追问：这部分的复杂度/数据量大概是多少？如何验证你的结论？',
    '追问：如果这个方案挂了或出现极端情况，你会如何兜底？',
    '追问：能否给出一个具体的衡量指标来衡量你的改动效果？',
    '追问：有没有考虑过其他方案？为什么选了现在的这个？'
  ]
};

/* 运行状态：mode = 'ai' | 'mock'；messages 为真实 AI 的对话历史；voice = 语音模式（Qwen3.5-Omni） */
let interview = { round: 0, started: false, qBank: [], report: null, mode: 'mock', messages: [], busy: false, answers: 0, startAt: 0, _counted: false, voice: false };

/* ================================================================
 * 对话气泡
 * ================================================================ */
function addMsg(who, text) {
  const box = $('chatBox');
  const wrap = document.createElement('div');
  if (who === 'user') {
    wrap.className = 'flex justify-end';
    wrap.innerHTML = `<div class="chat-user bubble-r max-w-[85%]">
      <div class="flex gap-2.5">
        <div class="whitespace-pre-line flex-1">${esc(text)}</div>
        <div class="avatar" style="background:rgba(61,245,157,.15);color:var(--mint)">🧑</div>
      </div></div>`;
  } else {
    wrap.className = 'flex justify-start';
    wrap.innerHTML = `<div class="chat-agent bubble-l">
      <div class="flex gap-2.5">
        <div class="avatar" style="background:rgba(251,191,36,.12);color:var(--amber)">🎙</div>
        <div class="doc-md whitespace-pre-line flex-1 min-w-0">${mdRender(text)}</div>
      </div></div>`;
  }
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return wrap;
}

/* 面试官"正在输入"指示条 */
function addTyping() {
  const box = $('chatBox');
  const wrap = document.createElement('div');
  wrap.className = 'flex justify-start';
  wrap.id = 'typingBubble';
  wrap.innerHTML = `<div class="chat-agent bubble-l !py-3">
      <div class="flex gap-2.5">
        <div class="avatar" style="background:rgba(251,191,36,.12);color:var(--amber)">🎙</div>
        <div class="loader-dots self-center"><i></i><i></i><i></i></div>
      </div></div>`;
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}
function removeTyping() { document.getElementById('typingBubble')?.remove(); }

/* 流式逐字渲染：首个分片把 loader 替换为内容区，后续分片增量重绘 */
function paintTyping(full) {
  const wrap = document.getElementById('typingBubble');
  if (!wrap) return;
  let content = wrap.querySelector('.stream-content');
  if (!content) {
    const loader = wrap.querySelector('.loader-dots');
    content = document.createElement('div');
    content.className = 'doc-md whitespace-pre-line flex-1 min-w-0 stream-content';
    loader?.replaceWith(content);
  }
  content.innerHTML = mdRender(full);
  const box = $('chatBox');
  box.scrollTop = box.scrollHeight;
}
/* 流结束：保留已渲染气泡，仅摘除 typing 标记 */
function settleTyping() {
  document.getElementById('typingBubble')?.removeAttribute('id');
}

/* 面试官回合：语音模式走 Qwen3.5-Omni（文本+语音回答），否则 qwen-turbo 流式文本 */
function interviewAsk(maxTokens) {
  if (interview.voice && typeof voiceAsk === 'function') {
    return voiceAsk(interview.messages, full => paintTyping(full));
  }
  return AI.chatStream(interview.messages,
    { task: 'fast', stat: 'interview', temperature: 0.7, max_tokens: maxTokens, timeout: 60000 },
    (_piece, full) => paintTyping(full));
}

/* ================================================================
 * 开始面试
 * ================================================================ */
function buildInterviewChat() {
  const role = $('roleType').value;
  interview.round = 0;
  interview.started = true;
  interview.report = null;
  interview.messages = [];
  interview.answers = 0;
  interview.startAt = Date.now();
  interview._counted = false;
  $('chatArea').classList.remove('hidden');
  $('reportArea').classList.add('hidden');
  $('chatBox').innerHTML = '';
  $('userAnswer').value = '';

  if (AI.enabled) {
    interview.mode = 'ai';
    const jd = ($('interviewJdCtx')?.value || '').trim();
    const resume = ($('interviewResumeCtx')?.value || '').trim();
    interview.messages = [
      { role: 'system', content: interviewerSysPrompt(role) },
      { role: 'user', content:
        `【目标岗位】${role}\n【目标 JD 摘要】\n${jd || '（未提供）'}\n\n【候选人简历】\n${resume || '（未提供）'}\n\n` +
        `请开始面试：先用一句话欢迎并请候选人用 30 秒介绍一个他最满意的项目，然后提出你的第一个问题（注明题目类型：八股/项目深挖/场景题）。只输出你作为面试官要说的话，150 字以内。` }
    ];
    addTyping();
    interview.busy = true;
    interviewAsk(500)
      .then(reply => {
        interview.messages.push({ role: 'assistant', content: reply });
        settleTyping();
      })
      .catch(e => {
        removeTyping();
        toast(e.message || 'AI 连接失败，改用本地模拟面试');
        startMockChat(role);
      })
      .finally(() => { interview.busy = false; });
  } else {
    interview.mode = 'mock';
    startMockChat(role);
  }
}

/* 本地模拟开场白 + 题库 */
function startMockChat(role) {
  interview.mode = 'mock';
  interview.qBank = INTERVIEW.banks[role] || INTERVIEW.banks['后端开发'];
  addMsg('agent',
    `**面试官 · ${esc(role)} · 模拟面试开始** 🎙\n你好，我是本次的技术面试官。请先用 30 秒介绍你最满意的一个项目，以及你在其中的角色和贡献。`);
}

const startInterview = buildInterviewChat;
const loadInterviewExample = buildInterviewChat;

/* 面试官人格（真实 AI） */
function interviewerSysPrompt(role) {
  return `你是一位资深的技术面试官，正在面试应聘「${role}」岗位的计算机相关专业应届生。
面试规则：
1. 一次只问一个问题，问题类型覆盖：八股基础、项目深挖、场景设计；
2. 候选人回答后，先用一两句简短点评，再追问或提出下一题；持续深挖他简历中真实项目的技术细节；
3. 语气专业、克制，全程中文，每次回复不超过 200 字；
4. 不要提前给出最终评分，直到候选人或系统要求结束；
5. 如果候选人回答空泛（如"负责开发""做了优化"），必须追问量化数据、具体方案与失败兜底；
6. 问题必须结合候选人简历与目标 JD，不要问与岗位无关的内容。`;
}

/* ================================================================
 * 提交回答
 * ================================================================ */
async function submitAnswer() {
  if (!interview.started) { toast('请先点击「开始模拟面试」'); return; }
  if (interview.busy) { toast('面试官正在输入，请稍候…'); return; }
  const val = $('userAnswer').value.trim();
  if (!val) { toast('请先输入你的回答'); return; }

  if (interview.mode === 'ai') {
    addMsg('user', val);
    $('userAnswer').value = '';
    interview.messages.push({ role: 'user', content: val });
    interview.round++;
    interview.answers++;
    interview.busy = true;
    addTyping();
    try {
      const reply = await interviewAsk(600);
      interview.messages.push({ role: 'assistant', content: reply });
      settleTyping();
    } catch (e) {
      removeTyping();
      addMsg('agent', '⚠️ 网络异常：' + (e.message || '调用失败') + '，可检查 Key/网络后重新发送本条回答。');
      /* 回滚本轮，便于重试 */
      interview.round--;
      interview.answers--;
      interview.messages.pop();
    } finally {
      interview.busy = false;
    }
    return;
  }

  /* ---------- 本地模拟模式 ---------- */
  addMsg('user', val);
  $('userAnswer').value = '';
  const input = $('userAnswer');
  input.disabled = true;
  setTimeout(() => {
    input.disabled = false;
    if (interview.round >= interview.qBank.length) {
      addMsg('agent', '追问：非常好，我们正在收尾。让我整理一下对你的评估…\n（本轮预设问题已完成，可点击「生成复盘报告」获得结构化评分）');
      return;
    }
    const next = interview.qBank[interview.round];
    interview.round++;
    const follow = interview.round < interview.qBank.length
      ? '\n\n' + INTERVIEW.followups[interview.round % INTERVIEW.followups.length]
      : '\n\n（全部问题完成，可生成复盘报告）';
    addMsg('agent', `**${next.type} · 第 ${interview.round} 题**\n${next.q}${follow}`);
  }, 900);
}

/* 手动跳到下一题 */
function nextInterviewRound() {
  if (!interview.started) { toast('请先开始模拟面试'); return; }
  if (interview.mode === 'ai') {
    if (interview.busy) { toast('面试官正在输入，请稍候…'); return; }
    interview.messages.push({ role: 'user', content: '请直接换下一道题，换一个考察方向。' });
    interview.round++;
    interview.busy = true;
    addTyping();
    interviewAsk(600)
      .then(reply => {
        interview.messages.push({ role: 'assistant', content: reply });
        settleTyping();
      })
      .catch(e => {
        removeTyping();
        interview.messages.pop();
        interview.round--;
        toast(e.message || '调用失败，请重试');
      })
      .finally(() => { interview.busy = false; });
    return;
  }
  const q = interview.qBank[interview.round];
  if (!q) { addMsg('agent', '题目已出完，点击「生成复盘报告」查看评估。'); return; }
  interview.round++;
  addMsg('agent', `**${q.type} · 即时加题**\n${q.q}`);
}

/* ================================================================
 * 复盘报告
 * ================================================================ */
async function finishInterview(btnEl) {
  if (!interview.started) { toast('请先开始模拟面试'); return; }
  if (interview.mode === 'ai' && interview.answers < 1) { toast('请先回答至少一个问题再生成报告'); return; }
  if (interview.mode === 'mock' && interview.round < 1) { toast('请先进行至少一轮问答再生成报告'); return; }
  if (btnEl) btnEl.disabled = true;
  const area = $('reportArea');
  area.classList.remove('hidden');
  area.innerHTML = `
    <div class="card p-5">
      <div class="loader-dots"><i></i><i></i><i></i></div>
      <div class="mt-2 text-[13px] text-[#8a8a96]">面试官 Agent 正在综合本轮 ${interview.round} 轮问答，进行多维度评估…</div>
    </div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (interview.mode === 'ai') {
    try {
      const transcript = interview.messages
        .filter(m => m.role !== 'system' && !m.content.includes('请开始面试'))
        .map(m => (m.role === 'user' ? '【候选人】' : '【面试官】') + m.content)
        .join('\n\n');
      const raw = await AI.chatJSON([
        { role: 'system', content: REPORT_SYS_PROMPT },
        { role: 'user', content: '目标岗位：' + $('roleType').value + '\n\n面试记录如下：\n\n' + transcript }
      ], { task: 'pro', stat: 'report', temperature: 0.3, max_tokens: 2200, timeout: 90000 });
      interview.report = normalizeReport(raw);
      interview.report._real = true;
    } catch (e) {
      toast(e.message || '评分服务异常，改用本地模拟评分');
      interview.report = buildReport();
    }
  } else {
    await sleep(1300);
    interview.report = buildReport();
  }
  renderReport();
  /* 效率看板：一场面试只计一次（场次 + 实际陪练分钟数） */
  if (!interview._counted) {
    interview._counted = true;
    const mins = (Date.now() - (interview.startAt || Date.now())) / 60000;
    AIStats.recordInterview(Math.round(mins));
  }
  if (btnEl) btnEl.disabled = false;
}

/* 评估模型约束 */
const REPORT_SYS_PROMPT = `你是严谨的面试评估官。根据完整面试记录，输出一个 JSON 对象（不要输出其他文字）：
{
  "scores": { "depth": 0-100整数(技术深度), "comprehension": 0-100整数(项目理解), "exp": 0-100整数(表达能力) },
  "shortlist": [ { "name": "短板名称", "desc": "结合候选人原话的具体说明" } ],
  "talker": [ { "code": "场景名(如:项目提问)", "suggest": "可直接照说的改进话术模板" } ],
  "advice": "一句话总体建议"
}
要求：shortlist 恰好 3 条；talker 恰好 3 条；评分要依据回答质量拉开差距，不能人人高分；全部中文。`;

function normalizeReport(d) {
  d = d || {};
  const s = d.scores || {};
  const clamp = n => Math.max(20, Math.min(96, Math.round(Number(n) || 60)));
  const fb = buildReport();
  const shortlist = (Array.isArray(d.shortlist) ? d.shortlist : []).slice(0, 3)
    .map(x => ({ name: x.name || '待提升项', desc: x.desc || '' }));
  while (shortlist.length < 3) shortlist.push(fb.shortlist[shortlist.length]);
  const talker = (Array.isArray(d.talker) ? d.talker : []).slice(0, 3)
    .map(x => ({ code: x.code || '建议场景', suggest: x.suggest || '' }));
  while (talker.length < 3) talker.push(fb.talker[talker.length]);
  return {
    scores: { depth: clamp(s.depth), comprehension: clamp(s.comprehension), exp: clamp(s.exp) },
    shortlist,
    talker,
    advice: d.advice || '建议结合每个项目准备可量化的结果与失败案例，并用 STAR 句式表达。'
  };
}

/* 本地模拟评分：轮次越多、联动过 JD/简历，得分越高 */
function buildReport() {
  const rounds = interview.round;
  return {
    scores: {
      depth: Math.min(92, 62 + rounds * 3 + (jdStore ? 3 : 0)),
      comprehension: Math.min(88, 58 + rounds * 3 + (resumeStore ? 4 : 0)),
      exp: Math.min(86, 60 + rounds * 2)
    },
    shortlist: [
      { name: '系统设计深度', desc: '复杂场景方案阐述不够结构化，建议先画流程图再给数据。' },
      { name: '极限值量化', desc: '多使用"峰值 QPS≈""响应耗时下降 X%"等可度量表述。' },
      { name: '兜底意识', desc: '对"挂了怎么办"类追问回答偏少，需强化降级 / 重试 / 熔断意识。' }
    ],
    talker: [
      { code: '项目提问', suggest: '"当时并发走的是 Redis 缓存 + 数据库兜底，我在压测里模拟了超卖并验证通过，才上线。"' },
      { code: '场景提问', suggest: '"我会先用泳道把数据流画出来，再分别评估读写链路与瓶颈，最后给出容量预估。"' },
      { code: '收尾提问', suggest: '"这个改动我监控了错误率和 P99，从 180ms 降到 95ms，回落约 47%。"' }
    ],
    advice: '建议把每个项目都准备 2~3 个可量化"结果"和"失败案例"，并用 STAR 句式口头表达。'
  };
}

/* 渲染报告（三维雷达 + 短板 + 话术） */
function renderReport() {
  const r = interview.report;
  const labels = ['技术深度', '项目理解', '表达能力'];
  const scores = [r.scores.depth, r.scores.comprehension, r.scores.exp];
  $('reportArea').innerHTML = `
    <div class="flex items-center justify-between">
      <h2 class="module-title !text-[18px]">📊 面试复盘报告
        ${r._real ? '<span class="chip chip-green !text-[10px]">通义千问 Qwen 实时评分</span>' : '<span class="chip !text-[10px]">本地模拟评分</span>'}
      </h2>
      <button class="btn btn-ghost !py-1.5 !px-3 !text-[12px]" onclick="startInterview()">重新面试</button>
    </div>
    <div class="card fade-up p-4">
      <div class="grid items-center gap-5 md:grid-cols-2">
        <div>
          <div class="mb-2 text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">三维能力雷达</div>
          <div class="rounded-lg border border-[#23232a] bg-[#0b0b0e] p-2"><canvas id="reportRadar"></canvas></div>
        </div>
        <div class="space-y-4">
          ${labels.map((l, i) => {
            const sc = scores[i];
            return `<div>
              <div class="flex justify-between text-[12px]"><span>${l}</span>
                <b class="${sc >= 75 ? 'text-emerald-400' : sc >= 60 ? 'text-amber-400' : 'text-red-400'}">${sc} 分</b>
              </div>
              <div class="skillbar mt-1.5"><span style="width:${sc}%"></span></div>
            </div>`;
          }).join('')}
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12px] leading-relaxed text-[#b6b6c2]">💬 ${esc(r.advice)}</div>
        </div>
      </div>
    </div>
    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-red-400">⚠ 短板清单</div>
      <div class="space-y-2">
        ${r.shortlist.map(s => `
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12px]">
            <b class="text-[#f87171]">· ${esc(s.name)}</b>
            <div class="mt-0.5 text-[#b6b6c2]">${esc(s.desc)}</div>
          </div>`).join('')}
      </div>
      <div class="mb-3 mt-5 text-[12px] font-bold uppercase tracking-wider text-emerald-400">✔ 改进话术模板</div>
      <div class="space-y-2">
        ${r.talker.map(t => `
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12px]">
            <b class="text-emerald-400">${esc(t.code)}</b>
            <div class="mt-1 leading-relaxed text-[#d9d9e2]">${esc(t.suggest)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  setTimeout(() => radar('reportRadar', labels, scores), 30);
}
