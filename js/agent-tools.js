/* =====================================================================
 * agent-tools.js — Agent 4 扩展能力（P2）
 * 1. 台账逾期自动提醒：确定性规则（无需 AI），列表标红 + 顶部预警条 + 每日一次 toast
 * 2. MCP 风格工具调用：调度 Agent 通过 Function Calling 自主调用两个本地工具
 *    · create_interview_schedule  生成面试日程（含 .ics 日历文件下载）
 *    · plan_route                 生成考点路线（高德 / 百度地图直达链接）
 * 依赖：utils.js、ai-client.js、agent-tally.js（getRecords）
 * ===================================================================== */

/* ================================================================
 * 1. 逾期提醒：状态 → 允许停留天数
 * ================================================================ */
const OVERDUE_RULES = { '待回复': 7, '笔试': 5, '面试': 3 };

function daysSince(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return 0;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - d) / 86400000);
}
/* 返回逾期天数（0 = 未逾期）；拒信 / offer 终态不提醒 */
function overdueOf(rec) {
  const limit = OVERDUE_RULES[rec.status];
  if (limit == null) return 0;
  const days = daysSince(rec.date);
  return days > limit ? days : 0;
}

/* 顶部预警条（由 renderRecords 触发刷新） */
function renderOverdueBanner() {
  const box = $('overdueBanner');
  if (!box) return;
  const stale = getRecords()
    .map(r => ({ r, days: overdueOf(r) }))
    .filter(x => x.days > 0)
    .sort((a, b) => b.days - a.days);
  if (!stale.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="rounded-xl border border-[#f87171]/35 bg-[#1a0f10] p-4">
      <div class="flex items-center gap-2 text-[12.5px] font-bold text-red-400">
        ⏰ 台账逾期预警 · ${stale.length} 条机会需要立即跟进
      </div>
      <div class="mt-2 space-y-1.5">
        ${stale.slice(0, 4).map(x => `
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-[#e2d3d3]">
            <span class="chip chip-red !normal-case !tracking-normal">${esc(x.r.status)} · 逾期 ${x.days} 天</span>
            <b class="text-white">${esc(x.r.company)}</b>
            <span class="text-[#8a8a96]">${esc(x.r.role)}</span>
            <button class="btn btn-ghost !py-0.5 !px-2 !text-[10.5px]" onclick="generateMail(${x.r.id})">✉ 立即生成跟进话术</button>
          </div>`).join('')}
        ${stale.length > 4 ? `<div class="text-[11px] text-[#8a8a96]">另有 ${stale.length - 4} 条，请在列表中查看…</div>` : ''}
      </div>
    </div>`;
}

/* 启动时每日最多 toast 一次，避免打扰 */
function overdueToastOnce() {
  const stale = getRecords().filter(r => overdueOf(r) > 0);
  if (!stale.length) return;
  const today = new Date().toISOString().slice(0, 10);
  if (LS.get('overdueNotifyDate', '') === today) return;
  LS.set('overdueNotifyDate', today);
  setTimeout(() => toast(`⏰ ${stale.length} 条投递已超过建议跟进时限，建议今天处理`), 1200);
}

/* ================================================================
 * 2. 面试日程（本地持久化）
 * ================================================================ */
const getSchedules = () => LS.get('interviewSchedules', []);
const saveSchedules = list => LS.set('interviewSchedules', list);

function fmtDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ]((\d{2}):(\d{2}))/.exec(String(s || ''));
  if (!m) return String(s || '');
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
}

/* 生成 .ics 日历文件（本地时间，兼容 Outlook / 苹果日历 / 钉钉日历导入） */
function buildICS(ev) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ]((\d{2})(\d{2}))?/.exec(String(ev.datetime || '').replace(':', ''));
  const pad = n => String(n).padStart(2, '0');
  let stamp;
  if (m) {
    const hh = m[5] || '14', mm = m[6] || '00';
    const end = new Date(+m[1], +m[2] - 1, +m[3], +hh, +mm);
    end.setMinutes(end.getMinutes() + 60);
    stamp = {
      start: `${m[1]}${m[2]}${m[3]}T${hh}${mm}00`,
      end: `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`
    };
  } else {
    stamp = { start: '20260101T140000', end: '20260101T150000' };
  }
  const now = new Date();
  const utc = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const line = s => s.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CodeMate//Interview Schedule//CN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@codemate.local`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART;TZID=Asia/Shanghai:${stamp.start}`,
    `DTEND;TZID=Asia/Shanghai:${stamp.end}`,
    `SUMMARY:${line('面试 · ' + ev.company + (ev.role ? ' · ' + ev.role : ''))}`,
    ev.address ? `LOCATION:${line(ev.address)}` : '',
    `DESCRIPTION:${line('由 CodeMate 求职助手安排，请提前 15 分钟到场并准备简历与作品。')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:面试 30 分钟后开始', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}

function downloadICS(ev) {
  const blob = new Blob(['﻿' + buildICS(ev)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `面试日程_${ev.company}_${(ev.datetime || '').replace(/[: T]/g, m => m === ' ' ? '-' : '')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 考点路线：高德 / 百度地图 keyword 直达（无需经纬度） */
function routeLinks(address) {
  const q = encodeURIComponent(address);
  return {
    amap: `https://uri.amap.com/search?keyword=${q}&callnative=1`,
    baidu: `https://map.baidu.com/search/${q}`
  };
}

function renderSchedules() {
  const box = $('scheduleList');
  if (!box) return;
  const list = getSchedules().slice().sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  if (!list.length) {
    box.innerHTML = '<div class="py-5 text-center text-[12px] text-[#62626e]">暂无面试日程，让 Agent 根据公司 / 时间 / 考点地址自动安排。</div>';
    return;
  }
  box.innerHTML = list.map(ev => {
    const links = routeLinks(ev.address || ev.company);
    return `
    <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip chip-green !normal-case !tracking-normal">📅 ${esc(fmtDateTime(ev.datetime))}</span>
        <b class="text-[13px] text-white">${esc(ev.company)}</b>
        <span class="text-[12px] text-[#8a8a96]">${esc(ev.role || '')}</span>
      </div>
      ${ev.address ? `<div class="mt-1.5 text-[12px] text-[#b6b6c2]">📍 ${esc(ev.address)}</div>` : ''}
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" onclick='downloadICS(${JSON.stringify(ev).replace(/'/g, '&#39;')})'>⬇ 加入日历 (.ics)</button>
        <a class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" href="${links.amap}" target="_blank" rel="noopener">🗺 高德导航</a>
        <a class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" href="${links.baidu}" target="_blank" rel="noopener">🗺 百度地图</a>
        <button class="btn btn-ghost !py-1 !px-2.5 !text-[11px] !text-[#f87171]" onclick="deleteSchedule('${ev.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function deleteSchedule(id) {
  saveSchedules(getSchedules().filter(e => e.id !== id));
  renderSchedules();
  toast('日程已删除');
}

/* ================================================================
 * 3. Agent 工具调用（Function Calling）
 * ================================================================ */
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_interview_schedule',
      description: '为候选人创建一条面试日程安排。当用户提供了公司和面试时间时必须调用。',
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string', description: '面试公司名称' },
          role: { type: 'string', description: '应聘岗位名称' },
          datetime: { type: 'string', description: '面试时间，原样保留用户给出的日期时间（如 2026-09-25 14:00）' },
          address: { type: 'string', description: '面试 / 考点详细地址，没有则空字符串' }
        },
        required: ['company', 'datetime']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'plan_route',
      description: '根据考点地址生成导航路线方案。当用户提供了地址（或公司名可作为地点）时必须调用。',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '考点或公司的完整地址' }
        },
        required: ['address']
      }
    }
  }
];

/* 本地执行工具，返回结构化结果（模型不直接落库，客户端执行真实副作用） */
function execTool(name, args) {
  args = args || {};
  if (name === 'create_interview_schedule') {
    const ev = {
      id: 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      company: String(args.company || '').trim(),
      role: String(args.role || '').trim(),
      datetime: String(args.datetime || '').trim(),
      address: String(args.address || '').trim()
    };
    if (!ev.company || !ev.datetime) return { ok: false, name, text: '参数不全，未创建日程' };
    const list = getSchedules();
    if (!list.some(e => e.company === ev.company && e.datetime === ev.datetime)) {
      list.push(ev);
      saveSchedules(list);
    }
    return { ok: true, name, ev, text: `已创建日程：${ev.company} · ${fmtDateTime(ev.datetime)}` };
  }
  if (name === 'plan_route') {
    const address = String(args.address || '').trim();
    if (!address) return { ok: false, name, text: '缺少地址，无法规划路线' };
    return { ok: true, name, links: routeLinks(address), address, text: `已生成「${address}」考点导航链接` };
  }
  return { ok: false, name, text: '未知工具：' + name };
}

async function runAgentTools(btnEl) {
  const company = $('toolCompany').value.trim();
  const role = $('toolRole').value.trim();
  const datetime = $('toolDatetime').value;
  const address = $('toolAddress').value.trim();
  if (!company) { toast('请至少填写面试公司'); return; }
  if (!datetime) { toast('请选择面试时间'); return; }

  if (btnEl) btnEl.disabled = true;
  const box = $('toolResult');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card p-4">
      <div class="flex items-center gap-3">
        <div class="loader-dots"><i></i><i></i><i></i></div>
        <div class="text-[12.5px] text-[#8a8a96]"><b class="text-white">调度 Agent</b> 正在分析需求并选择工具（建日程 / 规划考点路线）…</div>
      </div>
    </div>`;

  let results = [];
  let narration = '';
  let realAI = false;
  try {
    if (AI.enabled) {
      const msg = await AI.chatTool([
        { role: 'system', content:
          '你是应届生的求职调度助手。根据用户给出的面试信息调用工具完成两件事：' +
          '①create_interview_schedule 创建面试日程；②plan_route 生成考点路线。' +
          '信息齐全时两个工具都要调用；参数原样透传用户输入，禁止编造地址或时间。' +
          '工具调用完成后，用一句中文（40字内）告知安排结果与行前提醒。' },
        { role: 'user', content:
          `公司：${company}\n岗位：${role || '（未提供）'}\n面试时间：${fmtDateTime(datetime)}\n考点地址：${address || '（未提供）'}\n请安排。` }
      ], AGENT_TOOLS, { task: 'fast', stat: 'tool', temperature: 0.2, max_tokens: 600, timeout: 60000 });
      realAI = true;
      (msg.tool_calls || []).forEach(call => {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch (e) { args = {}; }
        /* 表单真值兜底：模型偶发漏传地址时用用户输入补齐 */
        if (call.function?.name === 'plan_route' && !args.address && address) args.address = address;
        if (call.function?.name === 'create_interview_schedule') {
          args.company = args.company || company;
          args.datetime = args.datetime || datetime;
          args.address = args.address || address;
          args.role = args.role || role;
        }
        results.push(execTool(call.function?.name, args));
      });
      narration = String(msg.content || '').trim();
    }
  } catch (e) {
    toast(e.message || '工具调用失败，已使用本地规则安排');
  }

  /* AI 不可用 / 未调用工具 / 调用失败：本地规则兜底，保证功能可用 */
  if (!results.some(r => r.name === 'create_interview_schedule' && r.ok)) {
    results.push(execTool('create_interview_schedule', { company, role, datetime, address }));
  }
  if (address && !results.some(r => r.name === 'plan_route' && r.ok)) {
    results.push(execTool('plan_route', { address }));
  }
  if (!narration) {
    narration = `已为你安排 ${company} 的面试日程（${fmtDateTime(datetime)}），` +
      (address ? '考点导航链接已就绪，建议提前 30 分钟到达。' : '请尽快补充考点地址以便规划路线。');
  }

  renderSchedules();
  box.innerHTML = `
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#3df59d]">
        🔌 Agent 工具调用结果
        ${realAI
          ? '<span class="chip chip-green !normal-case !tracking-normal">通义千问 Qwen · Function Calling</span>'
          : '<span class="chip !normal-case !tracking-normal">本地规则执行</span>'}
      </div>
      <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12.5px] leading-relaxed text-[#d9d9e2]">
        <span class="mr-1">🎙</span>${esc(narration)}
      </div>
      <div class="mt-2.5 space-y-2">
        ${results.map(r => `
          <div class="flex items-start gap-2 rounded-lg border ${r.ok ? 'border-[#1f3a2c] bg-[#0a140e]' : 'border-[#3a2a2a] bg-[#160f0f]'} p-2.5 text-[12px]">
            <span class="${r.ok ? 'text-emerald-400' : 'text-red-400'}">${r.ok ? '✔' : '✖'}</span>
            <div class="min-w-0 flex-1">
              <code class="text-[11px] text-[#8ff5c8]">${esc(r.name)}</code>
              <div class="mt-0.5 text-[#b6b6c2]">${esc(r.text)}</div>
              ${r.links ? `<div class="mt-1.5 flex flex-wrap gap-1.5">
                <a class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" href="${r.links.amap}" target="_blank" rel="noopener">🗺 高德导航</a>
                <a class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" href="${r.links.baidu}" target="_blank" rel="noopener">🗺 百度地图</a>
              </div>` : ''}
              ${r.ev ? `<div class="mt-1.5"><button class="btn btn-ghost !py-1 !px-2.5 !text-[11px]" onclick='downloadICS(${JSON.stringify(r.ev).replace(/'/g, '&#39;')})'>⬇ 下载日历文件 (.ics)</button></div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (btnEl) btnEl.disabled = false;
}
