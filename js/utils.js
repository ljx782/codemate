/* =====================================================================
 * utils.js — 通用工具层
 * DOM 简写 / HTML 转义 / Markdown 渲染 / Canvas 雷达图 /
 * 加载状态 / localStorage 封装 / Toast
 * 所有模块共享，无业务依赖，需最先加载。
 * ===================================================================== */

/* DOM 简写 */
const $ = id => document.getElementById(id);

/* HTML 转义，防止示例文本注入 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ---------- 极简 Markdown -> HTML（按行解析，安全可控） ---------- */
function mdInline(t) {
  return t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function mdRender(src) {
  const out = [];
  let inList = null;
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
    if (m = line.match(/^### (.*)$/))       { closeList(); out.push('<h3>' + mdInline(m[1]) + '</h3>'); }
    else if (m = line.match(/^## (.*)$/))   { closeList(); out.push('<h2>' + mdInline(m[1]) + '</h2>'); }
    else if (m = line.match(/^# (.*)$/))    { closeList(); out.push('<h1>' + mdInline(m[1]) + '</h1>'); }
    else if (m = line.match(/^[-*] (.*)$/)) {
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + mdInline(m[1]) + '</li>');
    }
    else if (m = line.match(/^\d+\. (.*)$/)) {
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + mdInline(m[1]) + '</li>');
    }
    else if (/^---+$/.test(line)) { closeList(); out.push('<hr>'); }
    else { closeList(); out.push('<p>' + mdInline(line) + '</p>'); }
  }
  closeList();
  return out.join('\n');
}

/* ---------- Canvas 三维/多维雷达图（HiDPI 适配） ---------- */
function radar(canvasId, labels, scores, retry) {
  const cv = $(canvasId);
  if (!cv || !cv.parentElement) return;
  /* 容器尚不可见（宽度 0）时延迟重试，避免画出空白图 */
  if (cv.parentElement.clientWidth === 0) {
    if ((retry || 0) < 10) setTimeout(() => radar(canvasId, labels, scores, (retry || 0) + 1), 80);
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.parentElement.clientWidth;
  const H = 300;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.width = '100%';
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);

  const cx = cv.width / 2, cy = cv.height / 2 - 6 * dpr;
  const N = labels.length;
  const radius = Math.min(cv.width, cv.height) * 0.285;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;

  /* 背景网格 4 层 */
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = ang(i % N);
      const x = cx + Math.cos(a) * radius * k / 4;
      const y = cy + Math.sin(a) * radius * k / 4;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(150,150,170,.12)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }
  /* 轴线 */
  for (let i = 0; i < N; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang(i)) * radius, cy + Math.sin(ang(i)) * radius);
    ctx.strokeStyle = 'rgba(150,150,170,.15)';
    ctx.stroke();
  }
  /* 数据多边形 */
  const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  grad.addColorStop(0, 'rgba(61,245,157,.5)');
  grad.addColorStop(1, 'rgba(45,212,191,.4)');
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const v = Math.max(0, Math.min(100, scores[i % N])) / 100;
    const x = cx + Math.cos(ang(i % N)) * radius * v;
    const y = cy + Math.sin(ang(i % N)) * radius * v;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#3df59d';
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
  /* 顶点 */
  for (let i = 0; i < N; i++) {
    const v = Math.max(0, Math.min(100, scores[i])) / 100;
    const x = cx + Math.cos(ang(i)) * radius * v;
    const y = cy + Math.sin(ang(i)) * radius * v;
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * dpr, 0, 7);
    ctx.fillStyle = '#8ff5c8';
    ctx.fill();
  }
  /* 文字标签：按角度动态对齐，长标签自动折两行，避免被画布边缘裁切 */
  ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  /* 超长标签按 6 字折行（中文按字符；英文/符号串也能断开） */
  const wrapLabel = t => {
    t = String(t);
    if (t.length <= 6) return [t];
    const mid = Math.ceil(t.length / 2);
    let cut = mid;
    for (let k = mid; k < t.length; k++) { if (/[/／、，,·\-—]/.test(t[k])) { cut = k + 1; break; } }
    return [t.slice(0, cut), t.slice(cut)];
  };
  const pad = 16 * dpr, lineH = 13 * dpr;
  for (let i = 0; i < N; i++) {
    const a = ang(i);
    const x = cx + Math.cos(a) * (radius + pad);
    const y = cy + Math.sin(a) * (radius + pad);
    const lines = wrapLabel(labels[i]);
    /* 右侧标签左对齐、右侧锚点向右排；左侧反之；正上/正下居中 */
    if (Math.cos(a) > 0.35) ctx.textAlign = 'left';
    else if (Math.cos(a) < -0.35) ctx.textAlign = 'right';
    else ctx.textAlign = 'center';
    const top = lines.length === 1 ? y : y - lineH / 2;
    ctx.fillStyle = '#c9c9d4';
    lines.forEach((ln, k) => ctx.fillText(ln, x, top + k * lineH));
    /* 分数放在标签块下方 */
    ctx.fillStyle = 'rgba(61,245,157,.95)';
    ctx.fillText(String(Math.round(scores[i])), x, top + lines.length * lineH + 2 * dpr);
  }
}

/* ---------- 加载态 / 按钮态 ---------- */
function showLoading(elId) { $(elId)?.classList.remove('hidden'); }
function hideLoading(elId) { $(elId)?.classList.add('hidden'); }
function disableBtn(btnId) {
  const b = $(btnId);
  if (b) { b.disabled = true; b.dataset.txt = b.innerHTML; b.innerHTML = '<span class="spin"></span>&nbsp;处理中…'; }
}
function enableBtn(btnId) {
  const b = $(btnId);
  if (b) { b.disabled = false; if (b.dataset.txt) b.innerHTML = b.dataset.txt; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- localStorage 封装（统一前缀，刷新不丢） ---------- */
const LS = {
  get(k, d) {
    try { const v = localStorage.getItem('codemate_' + k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  },
  set(k, v) { localStorage.setItem('codemate_' + k, JSON.stringify(v)); }
};

/* ---------- 轻量 Toast ---------- */
let toastEl = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText =
      'position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(10px);' +
      'background:#151519;border:1px solid rgba(61,245,157,.35);color:#f2f2f4;' +
      'padding:11px 20px;border-radius:12px;font-size:13px;font-weight:500;z-index:999;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.55),0 0 24px rgba(61,245,157,.12);opacity:0;transition:all .3s';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  requestAnimationFrame(() => { toastEl.style.opacity = '1'; toastEl.style.transform = 'translateX(-50%) translateY(0)'; });
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2200);
}
