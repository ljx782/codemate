/* =====================================================================
 * agent-export.js — P2 · 一键导出（可直接导入千问办公 / WPS / Office）
 *  · exportSprintReport  求职冲刺复盘报告：品牌化独立 HTML → 浏览器打印/另存 PDF
 *  · exportSprintPPT     求职冲刺 PPT：PptxGenJS 本地生成 .pptx（CDN 按需加载）
 * 数据来源：matchResult / resumeStore / interview.report / records /
 *           interviewSchedules / AIStats（全部本机已有数据，不产生 AI 调用）
 * ===================================================================== */

const EXPORT_PALETTE = {
  bg: '0B0B0E', panel: '121216', mint: '3DF59D', mintSoft: '8FF5C8',
  white: 'FFFFFF', gray: 'B6B6C2', dim: '8A8A96', line: '23232A',
  amber: 'FBBF24', red: 'F87171'
};

function exportDataGather() {
  return {
    match: LS.get('matchResult', null),
    resume: (typeof resumeStore !== 'undefined') ? resumeStore : null,
    jd: (typeof jdStore !== 'undefined') ? jdStore : null,
    report: (typeof interview !== 'undefined' && interview.report) ? interview.report : null,
    records: (typeof getRecords === 'function') ? getRecords() : [],
    schedules: (typeof getSchedules === 'function') ? getSchedules() : [],
    stats: (typeof AIStats !== 'undefined' && AIStats.data) ? AIStats.data : null,
    date: new Date().toLocaleDateString('zh-CN')
  };
}

/* ================================================================
 * 1. 复盘报告：自包含 HTML，唤起打印（可另存为 PDF）
 * ================================================================ */
function exportSprintReport() {
  const d = exportDataGather();
  const m = d.match, r = d.resume, rep = d.report;
  const byStatus = {};
  d.records.forEach(x => { byStatus[x.status] = (byStatus[x.status] || 0) + 1; });
  const stale = d.records.filter(x => typeof overdueOf === 'function' && overdueOf(x) > 0);
  const dims = r && r.dims ? [
    ['定位与结构', r.dims.positioning], ['量化与证据', r.dims.quant],
    ['岗位匹配度', r.dims.match], ['真实可信度', r.dims.credibility],
    ['语言与规范', r.dims.expression]
  ].filter(x => x[1] != null) : [];
  const bar = v => `<div class="bar"><i style="width:${v}%;${v < 50 ? 'background:#f87171' : v < 70 ? 'background:#fbbf24' : ''}"></i><b>${v}</b></div>`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>CodeMate 求职冲刺复盘报告 · ${d.date}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;background:#0b0b0e;color:#e8e8ee;padding:36px 40px;line-height:1.65}
  h1{font-size:26px}.h-mint{color:#3df59d}
  .sub{color:#8a8a96;font-size:12.5px;margin-top:6px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
  .card{border:1px solid #23232a;border-radius:14px;padding:18px;background:#101014;page-break-inside:avoid}
  .card h2{font-size:14px;color:#3df59d;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
  .score{font-size:52px;font-weight:800}
  .chip{display:inline-block;border:1px solid #3df59d55;color:#8ff5c8;border-radius:999px;padding:2px 12px;font-size:12px;margin:3px 4px 0 0}
  .chip.warn{border-color:#fbbf2466;color:#fbbf24}.chip.bad{border-color:#f8717166;color:#f87171}
  ul{padding-left:18px}li{font-size:13px;margin:5px 0;color:#d9d9e2}
  .bar{position:relative;height:8px;background:#23232a;border-radius:4px;margin:9px 0 4px}
  .bar i{display:block;height:100%;background:#3df59d;border-radius:4px}
  .bar b{position:absolute;right:0;top:-19px;font-size:11px;color:#b6b6c2;font-weight:600}
  .bar span{display:block;font-size:11.5px;color:#8a8a96;margin-top:3px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
  td,th{border-bottom:1px solid #23232a;padding:7px 6px;text-align:left}
  .muted{color:#62626e;font-size:11px;margin-top:22px;text-align:center}
  .big{display:flex;align-items:center;gap:18px}
  @media print{body{background:#fff;color:#111}.card{background:#fff;border-color:#ddd}
    h2,.h-mint{color:#0a8f54!important}.chip{color:#0a8f54;border-color:#0a8f54}.bar{background:#eee}
    .sub,.muted,li,td{color:#333}.bar b,.bar span{color:#555}}
</style></head><body>
  <h1>CodeMate <span class="h-mint">求职冲刺复盘报告</span></h1>
  <div class="sub">生成时间：${d.date} · 由阿里云百炼 · 通义千问 Qwen 多 Agent 协作产出 · 数据仅来自本机工作台</div>

  <div class="grid2">
    <div class="card">
      <h2>🎯 人岗匹配总览</h2>
      ${m ? `<div class="big"><div class="score h-mint">${m.score}</div>
        <div><div class="chip">${escHTML(m.level)}</div>
        <p style="font-size:13px;margin-top:8px;color:#b6b6c2">${escHTML(m.summary)}</p></div></div>`
        : '<p class="sub">尚未运行「人岗匹配」Agent。</p>'}
    </div>
    <div class="card">
      <h2>📄 简历体检五维</h2>
      ${dims.length ? dims.map(([n, v]) => `<div class="bar" style="margin-top:14px"><i style="width:${v}%"></i><b>${v}</b><span>${n}</span></div>`).join('')
        : '<p class="sub">尚未运行「简历优化」Agent。</p>'}
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>💚 核心亮点</h2>
      ${m && m.highlights ? '<ul>' + m.highlights.map(x => `<li>${escHTML(x)}</li>`).join('') + '</ul>' : '<p class="sub">—</p>'}
    </div>
    <div class="card">
      <h2>⚠ 匹配风险</h2>
      ${m && m.risks ? '<ul>' + m.risks.map(x => `<li>${escHTML(x)}</li>`).join('') + '</ul>' : '<p class="sub">—</p>'}
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>🔑 JD 关键词对齐</h2>
      ${r && r.kwHit ? r.kwHit.map(x => `<span class="chip">${escHTML(x)}</span>`).join('') : '<p class="sub">—</p>'}
      <div style="margin-top:8px">${r && r.kwMissing ? r.kwMissing.map(x => `<span class="chip warn">${escHTML(x)}</span>`).join('') : ''}</div>
    </div>
    <div class="card">
      <h2>🎙 模拟面试能力评估</h2>
      ${rep ? [['技术深度', rep.scores.depth], ['项目理解', rep.scores.comprehension], ['表达能力', rep.scores.exp]]
        .map(([n, v]) => `<div class="bar" style="margin-top:14px"><i style="width:${v}%"></i><b>${v}</b><span>${n}</span></div>`).join('')
        : '<p class="sub">尚未完成一场模拟面试。</p>'}
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>✔ 下一步行动清单</h2>
      <ul>
        ${(r && r.todo ? r.todo.slice(0, 4) : (m && m.nextActions ? m.nextActions : [])).map(x => `<li>${escHTML(x)}</li>`).join('') || '<li class="sub">先运行匹配 / 简历 Agent 获取行动建议</li>'}
      </ul>
    </div>
    <div class="card">
      <h2>🗂 投递战局（${d.records.length} 家）</h2>
      <table><tr><th>状态</th><th>数量</th></tr>
        ${Object.keys(byStatus).map(k => `<tr><td>${escHTML(k)}</td><td>${byStatus[k]}</td></tr>`).join('') || '<tr><td colspan=2 class="sub">暂无投递记录</td></tr>'}
      </table>
      ${stale.length ? `<p style="margin-top:10px"><span class="chip bad">⏰ ${stale.length} 条已逾期需今日跟进</span></p>` : ''}
      ${d.schedules.length ? `<p style="margin-top:8px;font-size:12px;color:#8a8a96">📅 已安排面试日程 ${d.schedules.length} 场</p>` : ''}
    </div>
  </div>

  <div class="muted">CodeMate 工作台 · 2026 天猫 AI 黑客松高校挑战赛 · 效率进化赛道 · Powered by 通义千问 Qwen</div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.target = '_blank';
  a.download = 'CodeMate求职冲刺复盘报告_' + new Date().toISOString().slice(0, 10) + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('复盘报告已生成，在打印窗口可「另存为 PDF」 ✔');
}

function escHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ================================================================
 * 2. 求职冲刺 PPT（.pptx）
 * ================================================================ */
/* 多 CDN 兜底（国内赛场网络下 jsdelivr 偶发被重置） */
const PPTX_CDNS = [
  'https://registry.npmmirror.com/pptxgenjs/3.12.0/files/dist/pptxgen.bundle.js',
  'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.min.js'
];

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('CDN 失败：' + src));
    document.head.appendChild(s);
  });
}

async function loadPptxLib() {
  if (window.PptxGenJS) return window.PptxGenJS;
  let lastErr;
  for (const cdn of PPTX_CDNS) {
    try { await loadScriptOnce(cdn); if (window.PptxGenJS) return window.PptxGenJS; }
    catch (e) { lastErr = e; }
  }
  throw new Error('PPT 组件所有 CDN 均加载失败，请检查网络后重试');
}

async function exportSprintPPT(btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '正在生成 PPT…'; }
  try {
    const PptxGenJS = await loadPptxLib();
    const pptx = new PptxGenJS();
    const P = EXPORT_PALETTE;
    pptx.defineLayout({ name: 'CODEMATE', width: 13.33, height: 7.5 });
    pptx.layout = 'CODEMATE';
    pptx.author = 'CodeMate';
    pptx.subject = '应届生求职冲刺方案';
    pptx.title = 'CodeMate 求职冲刺 PPT';

    const d = exportDataGather();
    const font = 'Microsoft YaHei';

    /* 通用：深色底 + 标题条 + 页脚 */
    function newSlide(title, idx) {
      const s = pptx.addSlide();
      s.background = { color: P.bg };
      if (title) {
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.52, w: 0.12, h: 0.42, fill: { color: P.mint }, line: { type: 'none' } });
        s.addText(title, { x: 0.85, y: 0.46, w: 10.5, h: 0.55, fontSize: 25, bold: true, color: P.white, fontFace: font });
      }
      s.addText('CodeMate · 通义千问 Qwen 多 Agent 工作台', { x: 0.6, y: 7.06, w: 8, h: 0.3, fontSize: 9, color: P.dim, fontFace: font });
      if (idx) s.addText(String(idx), { x: 12.4, y: 7.02, w: 0.5, h: 0.3, fontSize: 10, color: P.dim, align: 'right', fontFace: font });
      return s;
    }
    const scoreColor = v => v >= 70 ? P.mint : v >= 50 ? P.amber : P.red;
    /* 横向分数条 */
    function hbar(s, y, label, v) {
      s.addText(label, { x: 0.85, y: y - 0.03, w: 2.4, h: 0.34, fontSize: 13, color: P.gray, fontFace: font });
      s.addShape(pptx.ShapeType.roundRect, { x: 3.35, y, w: 7.2, h: 0.26, rectRadius: 0.06, fill: { color: '1C1C22' }, line: { type: 'none' } });
      s.addShape(pptx.ShapeType.roundRect, { x: 3.35, y, w: Math.max(0.06, 7.2 * (v / 100)), h: 0.26, rectRadius: 0.06, fill: { color: scoreColor(v) }, line: { type: 'none' } });
      s.addText(String(v), { x: 10.72, y: y - 0.06, w: 0.8, h: 0.36, fontSize: 14, bold: true, color: scoreColor(v), fontFace: font });
    }
    function chipLines(s, arr, x, y, color) {
      if (!arr || !arr.length) { s.addText('—', { x, y, w: 5, h: 0.4, fontSize: 13, color: P.dim, fontFace: font }); return; }
      s.addText(arr.map(t => ({ text: String(t), options: { breakLine: true } })), {
        x, y, w: 5.3, h: 4.2, fontSize: 13.5, color, fontFace: font,
        bullet: { code: '2022', indent: 14 }, lineSpacingMultiple: 1.25, paraSpaceAfter: 6
      });
    }

    /* ---------- Slide 1 封面 ---------- */
    {
      const s = pptx.addSlide();
      s.background = { color: P.bg };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: P.mint }, line: { type: 'none' } });
      s.addText('CodeMate', { x: 0.9, y: 1.9, w: 11, h: 1.0, fontSize: 54, bold: true, color: P.white, fontFace: font });
      s.addText('应届生求职冲刺方案', { x: 0.9, y: 2.95, w: 11, h: 0.8, fontSize: 32, color: P.mint, fontFace: font });
      s.addText('人岗匹配 · 简历精修 · 模拟面试 · 投递调度 · 复盘导出', { x: 0.92, y: 3.95, w: 11, h: 0.5, fontSize: 15, color: P.gray, fontFace: font });
      s.addText('阿里云百炼 · 通义千问 Qwen ｜ ' + d.date, { x: 0.92, y: 5.9, w: 11, h: 0.4, fontSize: 13, color: P.dim, fontFace: font });
    }

    /* ---------- Slide 2 人岗匹配 ---------- */
    {
      const s = newSlide('🎯 人岗匹配体检', 2);
      const m = d.match;
      if (m) {
        s.addShape(pptx.ShapeType.ellipse, { x: 0.85, y: 1.55, w: 2.5, h: 2.5, fill: { color: P.panel }, line: { color: scoreColor(m.score), width: 3 } });
        s.addText(String(m.score), { x: 0.85, y: 2.05, w: 2.5, h: 1, fontSize: 56, bold: true, align: 'center', color: scoreColor(m.score), fontFace: font });
        s.addText('匹配分 / 100', { x: 0.85, y: 3.15, w: 2.5, h: 0.4, fontSize: 12, align: 'center', color: P.dim, fontFace: font });
        s.addText(m.level || '', { x: 0.85, y: 4.2, w: 2.5, h: 0.4, fontSize: 14, align: 'center', color: P.mintSoft, bold: true, fontFace: font });
        s.addText(m.summary || '', { x: 3.75, y: 1.55, w: 8.8, h: 1.1, fontSize: 17, color: P.gray, fontFace: font, lineSpacingMultiple: 1.3 });
        s.addText('优先行动建议', { x: 3.75, y: 2.75, w: 4, h: 0.4, fontSize: 15, bold: true, color: P.mint, fontFace: font });
        chipLines(s, m.nextActions, 3.75, 3.25, P.white);
      } else {
        s.addText('尚未运行「人岗匹配」Agent，先在工作台首页生成匹配体检。', { x: 0.9, y: 3, w: 11, h: 1, fontSize: 16, color: P.dim, fontFace: font });
      }
    }

    /* ---------- Slide 3 匹配五维 ---------- */
    {
      const s = newSlide('📊 匹配五维雷达（分数拆解）', 3);
      const m = d.match;
      if (m && Array.isArray(m.labels)) {
        m.labels.forEach((lb, i) => hbar(s, 1.7 + i * 0.78, lb, m.scores[i] || 0));
        s.addText('评分由通义千问结合 JD 与简历从严给出，梯度即补强优先级。', { x: 0.85, y: 6.1, w: 11, h: 0.4, fontSize: 12, color: P.dim, fontFace: font });
      } else {
        s.addText('暂无数据', { x: 0.9, y: 3, w: 8, h: 1, fontSize: 16, color: P.dim, fontFace: font });
      }
    }

    /* ---------- Slide 4 JD 关键词 ---------- */
    {
      const s = newSlide('🔑 JD 关键词对齐', 4);
      const r = d.resume;
      s.addText('已覆盖（可在简历 / 面试中主动展开）', { x: 0.85, y: 1.45, w: 5.5, h: 0.4, fontSize: 15, bold: true, color: P.mint, fontFace: font });
      chipLines(s, r && r.kwHit, 0.9, 2.0, P.mintSoft);
      s.addShape(pptx.ShapeType.line, { x: 6.65, y: 1.5, w: 0, h: 4.8, line: { color: P.line, width: 1 } });
      s.addText('待补强（写进学习计划，勿硬塞简历）', { x: 7.0, y: 1.45, w: 5.8, h: 0.4, fontSize: 15, bold: true, color: P.amber, fontFace: font });
      chipLines(s, r && r.kwMissing, 7.05, 2.0, P.amber);
    }

    /* ---------- Slide 5 简历体检 ---------- */
    {
      const s = newSlide('📄 简历体检与精修', 5);
      const r = d.resume;
      if (r) {
        s.addText(String(r.score || 0), { x: 0.85, y: 1.45, w: 1.6, h: 1, fontSize: 48, bold: true, color: scoreColor(r.score || 0), fontFace: font });
        s.addText('简历分', { x: 0.9, y: 2.5, w: 1.6, h: 0.4, fontSize: 12, color: P.dim, fontFace: font });
        const dims = [['定位与结构', r.dims && r.dims.positioning], ['量化与证据', r.dims && r.dims.quant], ['岗位匹配度', r.dims && r.dims.match],
          ['真实可信度', r.dims && r.dims.credibility], ['语言与规范', r.dims && r.dims.expression]].filter(x => x[1] != null);
        dims.forEach(([lb, v], i) => hbar(s, 1.5 + i * 0.62, lb, v));
        s.addText('最需要改的问题', { x: 0.85, y: 4.9, w: 4, h: 0.4, fontSize: 14, bold: true, color: P.red, fontFace: font });
        chipLines(s, (r.issues || []).slice(0, 3).map(x => x.text || x), 0.9, 5.35, P.gray);
      } else {
        s.addText('尚未运行「简历优化」Agent。', { x: 0.9, y: 3, w: 8, h: 1, fontSize: 16, color: P.dim, fontFace: font });
      }
    }

    /* ---------- Slide 6 模拟面试 ---------- */
    {
      const s = newSlide('🎙 模拟面试能力评估', 6);
      const rep = d.report;
      if (rep) {
        hbar(s, 2.0, '技术深度', rep.scores.depth);
        hbar(s, 3.0, '项目理解', rep.scores.comprehension);
        hbar(s, 4.0, '表达能力', rep.scores.exp);
        s.addText(rep.advice || '', { x: 0.85, y: 5.2, w: 11.5, h: 1, fontSize: 14, color: P.gray, fontFace: font, lineSpacingMultiple: 1.3 });
      } else {
        s.addText('完成一场模拟面试并生成复盘报告后，本页自动填充三维评分与短板。', { x: 0.9, y: 3, w: 11, h: 1, fontSize: 16, color: P.dim, fontFace: font });
      }
    }

    /* ---------- Slide 7 投递战局 ---------- */
    {
      const s = newSlide('🗂 投递战局与节奏', 7);
      const byStatus = {};
      d.records.forEach(x => { byStatus[x.status] = (byStatus[x.status] || 0) + 1; });
      const keys = Object.keys(byStatus);
      if (keys.length) {
        const maxN = Math.max(1, ...Object.values(byStatus));
        keys.forEach((k, i) => {
          const n = byStatus[k];
          const y = 1.7 + i * 0.72;
          s.addText(k, { x: 0.85, y: y - 0.02, w: 1.8, h: 0.34, fontSize: 14, color: P.gray, fontFace: font });
          s.addShape(pptx.ShapeType.roundRect, { x: 2.75, y, w: Math.max(0.12, 7 * n / maxN), h: 0.3, rectRadius: 0.06, fill: { color: k === 'offer' ? P.mint : k === '拒信' ? P.red : P.amber }, line: { type: 'none' } });
          s.addText(n + ' 家', { x: 2.9 + 7 * n / maxN, y: y - 0.03, w: 1.4, h: 0.34, fontSize: 13, bold: true, color: P.white, fontFace: font });
        });
        const offers = byStatus['offer'] || 0;
        s.addText(`投递 ${d.records.length} 家 ｜ Offer ${offers} 家 ｜ 转化率 ${Math.round(offers / d.records.length * 100)}%`,
          { x: 0.85, y: 5.6, w: 11, h: 0.5, fontSize: 17, bold: true, color: P.mint, fontFace: font });
      } else {
        s.addText('暂无投递记录。', { x: 0.9, y: 3, w: 8, h: 1, fontSize: 16, color: P.dim, fontFace: font });
      }
    }

    /* ---------- Slide 8 行动清单 ---------- */
    {
      const s = newSlide('🚀 冲刺行动清单', 8);
      const todo = (d.resume && d.resume.todo ? d.resume.todo.slice(0, 4) : []);
      s.addText('本周补强动作', { x: 0.85, y: 1.4, w: 5, h: 0.4, fontSize: 16, bold: true, color: P.mint, fontFace: font });
      chipLines(s, todo, 0.9, 1.95, P.white);
      s.addText('已安排面试', { x: 7.0, y: 1.4, w: 5, h: 0.4, fontSize: 16, bold: true, color: P.mint, fontFace: font });
      const sch = d.schedules.slice().sort((a, b) => String(a.datetime).localeCompare(String(b.datetime))).slice(0, 4)
        .map(e => `${e.company}｜${fmtDateTime(e.datetime)}${e.address ? '｜' + e.address : ''}`);
      chipLines(s, sch, 7.05, 1.95, P.white);
      s.addText('原则：缺失关键词不硬塞——用小项目与刷题证据补齐；每场面试后 24h 内完成复盘。',
        { x: 0.85, y: 6.0, w: 11.7, h: 0.6, fontSize: 13, color: P.amber, fontFace: font });
    }

    /* ---------- Slide 9 尾页 ---------- */
    {
      const s = pptx.addSlide();
      s.background = { color: P.bg };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.25, w: 13.33, h: 0.25, fill: { color: P.mint }, line: { type: 'none' } });
      s.addText('让每一次投递，都有 AI 陪跑', { x: 0.9, y: 2.5, w: 11.5, h: 0.9, fontSize: 36, bold: true, color: P.white, fontFace: font });
      s.addText('CodeMate · 效率进化赛道 · Powered by 阿里云百炼通义千问 Qwen', { x: 0.92, y: 3.6, w: 11.5, h: 0.5, fontSize: 15, color: P.mint, fontFace: font });
      if (d.stats) {
        const min = d.stats.savedMin || 0;
        s.addText(`已协同 ${Object.values(d.stats.calls || {}).reduce((a, b) => a + b, 0)} 次 ｜ 累计陪练 ${d.stats.sessions || 0} 场 ｜ 预计节省人工 ${min >= 60 ? (min / 60).toFixed(1) + ' 小时' : min + ' 分钟'}`,
          { x: 0.92, y: 4.5, w: 11.5, h: 0.5, fontSize: 13, color: P.dim, fontFace: font });
      }
    }

    await pptx.writeFile({ fileName: 'CodeMate求职冲刺PPT_' + new Date().toISOString().slice(0, 10) + '.pptx' });
    toast('求职冲刺 PPT 已生成（.pptx，可导入千问办公 / WPS） ✔');
  } catch (e) {
    toast(e.message || 'PPT 生成失败，请重试');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '📊 导出求职冲刺 PPT（.pptx）'; }
  }
}
