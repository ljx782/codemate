/* =====================================================================
 * app.js — 应用入口
 * 模块导航切换 / trae 风格点阵粒子背景 / 启动初始化（恢复本地数据）
 * 依赖：utils.js、demo-data.js、agent-*.js（需最后加载）
 * ===================================================================== */

/* ---------- 模块导航 ---------- */
function selectModule(id) {
  document.querySelectorAll('.module').forEach(s =>
    s.classList.toggle('hidden', s.id !== id));
  document.querySelectorAll('[data-nav]').forEach(n =>
    n.classList.toggle('active', n.dataset.nav === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(n =>
    n.addEventListener('click', () => selectModule(n.dataset.nav)));
}

/* ---------- trae 风格点阵粒子背景 ----------
 * 一团由小方块构成的"星云"：中心密集、边缘消散，
 * 薄荷绿 → 灰白渐变，带轻微呼吸明灭。 */
let dotAnim = null;
function initDots() {
  const cv = $('dotCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, dots = [];

  /* 可复现的伪随机，保证每次刷新图案稳定 */
  let seed = 20260915;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    dots = [];
    const count = W < 768 ? 380 : 760;
    /* 星云中心偏右上（对标 trae 首屏构图） */
    const cx = W * 0.62, cy = H * 0.30;
    const rx = W * 0.30, ry = H * 0.20;
    for (let i = 0; i < count; i++) {
      /* 椭圆内均匀取点 + 高斯聚集 */
      const g = (rand() + rand() + rand()) / 3;
      const ang = rand() * Math.PI * 2;
      const rr = Math.pow(rand(), 0.55);
      const x = cx + Math.cos(ang) * rx * rr * (0.6 + g);
      const y = cy + Math.sin(ang) * ry * rr * (0.6 + g);
      /* 越靠近中心越绿越亮 */
      const dn = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const green = rand() > dn * 0.9;
      dots.push({
        x, y,
        size: (1.6 + rand() * 2.2) * dpr,
        alpha: 0.10 + (1 - Math.min(dn, 1)) * 0.5 * rand(),
        green,
        phase: rand() * Math.PI * 2,
        speed: 0.4 + rand() * 0.8
      });
    }
  }

  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const d of dots) {
      const breathe = 0.65 + 0.35 * Math.sin(t * d.speed + d.phase);
      ctx.globalAlpha = d.alpha * breathe;
      ctx.fillStyle = d.green ? '#3df59d' : '#8b8b97';
      ctx.fillRect(d.x * dpr, d.y * dpr, d.size, d.size);
    }
    ctx.globalAlpha = 1;
    dotAnim = requestAnimationFrame(frame);
  }

  build();
  dotAnim = requestAnimationFrame(frame);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { cancelAnimationFrame(dotAnim); build(); frame(performance.now()); }, 200);
  });
}

/* ---------- 启动初始化 ---------- */
function init() {
  AI.init();                 /* 读取本机通义千问配置（自有 Key） */
  bindNav();
  initDots();
  refreshAIStatus();
  /* 异步探测云端代理（Netlify Functions）；探测完成后自动切换徽标与模式 */
  AI.detectProxy();
  renderRecords();                                  /* Agent 4 台账（含逾期预警条） */
  overdueToastOnce();                               /* P2：每日一次逾期提醒 */
  renderSchedules();                                /* P2：面试日程列表 */
  /* 默认面试时间：明天 14:00，方便演示工具调用 */
  (function () {
    const d = new Date(Date.now() + 86400000);
    const pad = n => String(n).padStart(2, '0');
    $('toolDatetime').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T14:00`;
  })();
  const savedJd = LS.get('jdInput', '');
  if (savedJd) $('jdInput').value = savedJd;
  const savedRs = LS.get('resumeInput', '');
  if (savedRs) $('resumeInput').value = savedRs;
  initOverview();                                   /* Agent 0 总览 + 效率看板（依赖上面恢复的文本） */
  /* 面试上下文给默认演示内容，开箱即可体验 */
  if (!$('interviewJdCtx').value) {
    $('interviewJdCtx').value = '岗位：C++ 后端开发工程师（校招） · 核心要求：编程语言 / 算法 / 操作系统与网络';
  }
  if (!$('interviewResumeCtx').value) {
    $('interviewResumeCtx').value = DEMO.resume.slice(0, 120) + '\n…（校园点餐小程序）';
  }
  $('compDate').value = new Date().toISOString().slice(0, 10);
}

document.addEventListener('DOMContentLoaded', init);
