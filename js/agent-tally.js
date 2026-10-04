/* =====================================================================
 * agent-tally.js — Agent 4｜投递台账管理
 * 投递记录增删 / 状态流转 / AI 定制跟进邮件话术 / 导出求职复盘文本
 * 对外暴露：addRecord / renderRecords / deleteRecord / generateMail /
 *           copyMail / exportTally / loadRecordExample / clearAllRecords
 * ===================================================================== */

/* 状态 → chip 配色映射 */
const STATUS_STYLE = {
  '待回复': 'chip-amber',
  '笔试': 'chip-brand',
  '面试': 'chip-green',
  '拒信': 'chip-red',
  'offer': 'chip-green'
};

let lastMailId = null;
let lastMailBody = '';

const getRecords = () => LS.get('records', DEMO.records);
const saveRecords = list => LS.set('records', list);

/* 新增（silent+preset 用于一键载入示例） */
function addRecord(silent, preset) {
  const comp = preset ? preset.company : $('compName').value.trim();
  const role = preset ? preset.role : $('compRole').value.trim();
  let date = preset ? preset.date : $('compDate').value;
  const status = preset ? preset.status : $('compStatus').value;
  if (!comp || !role) { if (!silent) toast('请填写公司名称与岗位'); return; }
  if (!date) date = new Date().toISOString().slice(0, 10);
  const list = getRecords();
  list.unshift({ id: Date.now() + Math.random(), company: comp, role, date, status });
  saveRecords(list);
  if (!silent) {
    toast('已登记「' + comp + '」投递记录 ✔');
    $('compName').value = '';
    $('compRole').value = '';
    $('compDate').value = '';
  }
  renderRecords();
}

/* 渲染列表 */
function renderRecords() {
  const list = getRecords();
  $('recordCount').textContent = '(' + list.length + ')';
  $('recordEmpty').style.display = list.length ? 'none' : 'block';
  $('recordTbody').innerHTML = list.map(r => {
    const od = (typeof overdueOf === 'function') ? overdueOf(r) : 0;
    return `
    <tr>
      <td><span class="chip ${STATUS_STYLE[r.status] || 'chip-amber'}">${esc(r.status)}</span></td>
      <td class="font-semibold">${esc(r.company)}</td>
      <td class="text-[#b6b6c2]">${esc(r.role)}</td>
      <td class="${od ? 'text-red-400 font-semibold' : 'text-[#8a8a96]'}">
        ${r.date}${od ? `<div class="mt-0.5 text-[10.5px]">⏰ 逾期 ${od} 天</div>` : ''}
      </td>
      <td class="whitespace-nowrap text-right">
        <button class="btn btn-ghost !py-1 !px-2.5 !text-[11px] mr-1" onclick="generateMail(${r.id})">✉ 话术</button>
        <button class="btn btn-ghost !py-1 !px-2.5 !text-[11px] !text-[#f87171] hover:!border-[#f87171]/50" onclick="deleteRecord(${r.id})">删除</button>
      </td>
    </tr>`;
  }).join('');
  /* P2：逾期预警条（agent-tools.js 提供） */
  if (typeof renderOverdueBanner === 'function') renderOverdueBanner();
}

/* 删除 */
function deleteRecord(id) {
  saveRecords(getRecords().filter(r => r.id !== id));
  renderRecords();
  toast('已删除记录');
  if (lastMailId === id) {
    $('mailArea').classList.add('hidden');
    lastMailId = null;
  }
}

/* 生成定制跟进邮件（按状态区分语气） */
async function generateMail(id) {
  const rec = getRecords().find(r => r.id === id);
  if (!rec) return;
  lastMailId = id;
  const area = $('mailArea');
  area.classList.remove('hidden');
  area.innerHTML = `
    <div class="card p-5">
      <div class="loader-dots"><i></i><i></i><i></i></div>
      <div class="mt-2 text-[13px] text-[#8a8a96]">投递管理 Agent 正在为「${esc(rec.company)} · ${esc(rec.role)}」撰写定制跟进邮件…</div>
    </div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (AI.enabled) {
    try {
      /* 流式卡片：逐字写入，完成后再做主题/正文结构化渲染 */
      area.innerHTML = `
        <div class="card p-4">
          <div class="mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">
            ✉ 正在撰写跟进邮件…
            <span class="chip ${STATUS_STYLE[rec.status]} !normal-case !tracking-normal">${esc(rec.status)}</span>
          </div>
          <div id="mailStreamBody" class="whitespace-pre-line rounded-lg border border-[#23232a] bg-[#0b0b0e] p-4 text-[13px] leading-relaxed text-[#d9d9e2]"></div>
        </div>`;
      const full = await AI.chatStream([
        { role: 'system', content:
          '你是求职者的求职助手。根据用户提供的公司、岗位、投递日期、当前状态，撰写一封中文求职跟进邮件。' +
          '第一行必须是"主题：xxx"，空一行后是邮件正文（称呼→来意→与状态匹配的一句得体跟进→期待回复→落款占位"姓名 / 联系方式"）。' +
          '200 字以内，真诚不卑微，不要输出主题/正文之外的解释。' },
        { role: 'user', content:
          `公司：${rec.company}\n岗位：${rec.role}\n投递日期：${rec.date}\n当前状态：${rec.status}\n请撰写跟进邮件。` }
      ], { task: 'fast', stat: 'mail', temperature: 0.6, max_tokens: 700, timeout: 60000 },
        (_piece, text) => { const el = $('mailStreamBody'); if (el) el.textContent = text; });
      renderMailAI(rec, full.trim());
      return;
    } catch (e) {
      toast(e.message || 'AI 调用失败，已使用本地话术模板');
    }
  } else {
    await sleep(1100);
  }

  const subject = rec.status === '面试'
    ? `感谢面试机会 · ${rec.company} ${rec.role}跟进`
    : `求职跟进 · ${rec.company} ${rec.role}`;
  const body = `尊敬的 ${rec.company} 招聘团队：

您好！我是 ${rec.date} 投递「${rec.role}」岗位的候选人（应届生）。
${statusLine(rec.status)}
我始终对贵司的技术方向保持高度关注，如方便，希望能进一步沟通。

感谢您的时间，期待您的回复。
祝工作顺利！

姓名 · ${rec.role}
联系方式：xxx（请替换为真实邮箱 / 电话）`;
  renderMailTpl(rec, subject, body);
}

/* 渲染 AI 生成的邮件 */
function renderMailAI(rec, full) {
  lastMailBody = full;
  let subject = '（见正文首行）';
  let body = full;
  const m = full.match(/^\s*(?:邮件)?主题[：:]\s*(.+)\n([\s\S]*)$/);
  if (m) { subject = m[1].trim(); body = m[2].trim(); }
  $('mailArea').innerHTML = `
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">
          ✉ 定制跟进邮件话术 · ${esc(rec.company)}
          <span class="chip ${STATUS_STYLE[rec.status]} !normal-case !tracking-normal ml-1">${esc(rec.status)}</span>
          <span class="chip chip-green !normal-case !tracking-normal ml-1">通义千问生成</span>
        </div>
        <button class="btn btn-ghost !py-1.5 !px-3 !text-[11px]" onclick="copyMail()">复制邮件</button>
      </div>
      <div class="rounded-lg border border-[#23232a] bg-[#0b0b0e] p-4 text-[13px] leading-relaxed">
        <div class="text-[#8a8a96]">主题：${esc(subject)}</div>
        <hr class="my-3 border-[#23232a]">
        <div class="whitespace-pre-line">${esc(body)}</div>
      </div>
    </div>`;
}

/* 渲染本地模板邮件 */
function renderMailTpl(rec, subject, body) {
  lastMailBody = '主题：' + subject + '\n\n' + body;
  $('mailArea').innerHTML = `
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[12px] font-bold uppercase tracking-wider text-[#2dd4bf]">
          ✉ 定制跟进邮件话术 · ${esc(rec.company)}
          <span class="chip ${STATUS_STYLE[rec.status]} !normal-case !tracking-normal ml-1">${esc(rec.status)}</span>
        </div>
        <button class="btn btn-ghost !py-1.5 !px-3 !text-[11px]" onclick="copyMail()">复制邮件</button>
      </div>
      <div class="rounded-lg border border-[#23232a] bg-[#0b0b0e] p-4 text-[13px] leading-relaxed">
        <div class="text-[#8a8a96]">主题：${esc(subject)}</div>
        <hr class="my-3 border-[#23232a]">
        <div class="whitespace-pre-line">${esc(body)}</div>
      </div>
      <div class="mt-3 text-[12px] text-[#8a8a96]">💡 建议：当前为「${esc(rec.status)}」状态，语气应${statusTip(rec.status)}；发送前请替换真实姓名与联系方式。</div>
    </div>`;
}

function copyMail() {
  if (!lastMailBody) return;
  navigator.clipboard.writeText(lastMailBody)
    .then(() => toast('邮件话术已复制 ✔'))
    .catch(() => toast('复制失败，请手动选择复制'));
}

/* 各状态下的邮件正文关键句 */
function statusLine(st) {
  const map = {
    '待回复': '上周投递后暂未收到回复，希望冒昧跟进一下进程。',
    '笔试': '上周有幸收到笔试邀请并已完成，特此跟进后续安排。',
    '面试': '感谢贵司给予的面试机会，交流后我对岗位兴趣更加明确，很期待下一步沟通。',
    '拒信': '虽与贵司擦肩而过，仍感谢认可，如以后有合适机会希望能再合作。',
    'offer': '非常荣幸获得贵司的 offer，正在确认入职相关事宜，特此同步并致谢。'
  };
  return map[st] || '同时想冒昧跟进一下目前的进展，感谢您的关注。';
}
function statusTip(st) {
  const map = {
    '待回复': '温和、不催促',
    '笔试': '表达已完成并展示积极性',
    '面试': '真诚得体，突出热情',
    '拒信': '礼貌表达感谢与长期意向',
    'offer': '主动确认流程，表达期待'
  };
  return map[st] || '中性';
}

/* 导出求职复盘文本（.txt 下载） */
function exportTally() {
  const list = getRecords();
  if (!list.length) { toast('暂无可导出的记录'); return; }
  const byStatus = {};
  list.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const offer = byStatus['offer'] || 0;
  const lines = [
    '===== CodeMate · 求职复盘台账 =====',
    '导出时间：' + new Date().toLocaleString('zh-CN'),
    '本作品基于 Trae SOLO 开发 · 金九银十求职活动',
    '',
    `投递总数：${list.length} ｜ 已获 Offer：${offer} ｜ Offer 转化率：${Math.round(offer / list.length * 100)}%`,
    '',
    '— 状态分布 —',
    ...Object.keys(byStatus).map(k => `${k}：${byStatus[k]} 家`),
    '',
    '— 明细 —',
    ...list.map((r, i) => `${i + 1}. [${r.date}] ${r.company} · ${r.role} · ${r.status}`),
    '',
    '复盘建议：优先跟进"待回复 / 笔试 / 面试"状态的机会；对连续拒信岗位复盘 JD 匹配度并调整投递策略。'
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '求职复盘台账_' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('求职复盘文本已导出（下载） ✔');
}

/* 示例 / 清空 */
function loadRecordExample() {
  DEMO.records.forEach(r => addRecord(true, r));
  renderRecords();
  toast('已载入 5 条示例投递记录');
}
function clearAllRecords() {
  saveRecords([]);
  renderRecords();
  $('mailArea').classList.add('hidden');
  toast('已清空全部记录');
}
