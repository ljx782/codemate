/* =====================================================================
 * agent-resume.js — Agent 2｜程序员简历优化实验室
 * 方法论与输出契约全部来自 skill-resume.js（RESUME_SKILL）
 * 本文件只负责：取数 → AI/离线调用 → 渲染（评分/关键词/STAR/精修/成品简历）
 * 对外暴露：runResume / resumeStore / loadResumeExample / clearResume / copyResumeMD
 *           recognizeResumeImage（Qwen-VL 截图识别）
 * ===================================================================== */

let resumeStore = null;

/* 结果归一化：模型字段缺失/类型错误时逐项兜底，保证渲染不崩
 * useMock=true（离线/整包兜底）：空数组用离线模板补齐；
 * useMock=false（真实 AI 成功）：空就留空，由渲染隐藏对应分区，绝不混入模板假数据 */
function normalizeResume(d, useMock) {
  d = d || {};
  const mock = RESUME_SKILL.mock();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
  const str = (v, fb) => (typeof v === 'string' && v.trim()) ? v : fb;

  d.score = clamp(d.score, 0, 100) || mock.score;
  d.scoreText = useMock ? str(d.scoreText, mock.scoreText) : str(d.scoreText, '');
  d.profile = useMock ? str(d.profile, mock.profile) : str(d.profile, '');

  const dimObj = (d.dims && typeof d.dims === 'object' && !Array.isArray(d.dims)) ? d.dims : {};
  const dims = RESUME_SKILL.DIM_KEYS.map(k => clamp(dimObj[k], 0, 100));
  d.dims = dims.some(v => v > 0) ? dims : mock.dims;

  d.kwHit = (Array.isArray(d.kwHit) ? d.kwHit : []).map(String).filter(Boolean).slice(0, 8);
  d.kwMissing = (Array.isArray(d.kwMissing) ? d.kwMissing : []).map(String).filter(Boolean).slice(0, 8);

  d.stars = (Array.isArray(d.stars) ? d.stars : []).slice(0, 3).map(s => ({
    title: str(s.title, '项目经历'),
    stack: str(s.stack, '技术栈待补充'),
    situation: str(s.situation, ''),
    task: str(s.task, ''),
    action: str(s.action, ''),
    result: str(s.result, '')
  })).filter(s => s.action || s.result);
  if (!d.stars.length && useMock) d.stars = mock.stars;

  d.rewrites = (Array.isArray(d.rewrites) ? d.rewrites : []).slice(0, 2).map(r => ({
    before: str(r.before, ''),
    after: str(r.after, '')
  })).filter(r => r.before && r.after);
  if (!d.rewrites.length && useMock) d.rewrites = mock.rewrites;

  d.issues = (Array.isArray(d.issues) ? d.issues : []).slice(0, 5).map(q => ({
    level: ['danger', 'critical', 'warn', 'tip'].includes(q.level) && q.level !== 'critical' ? q.level
      : q.level === 'critical' ? 'danger' : 'warn',
    text: str(q.text, '')
  })).filter(q => q.text);
  if (!d.issues.length && useMock) d.issues = mock.issues;

  d.todo = (Array.isArray(d.todo) ? d.todo : []).map(String).filter(Boolean).slice(0, 4);
  if (!d.todo.length && useMock) d.todo = mock.todo;

  d.md = str(d.md, useMock ? mock.md : '');
  delete d.factBase;   /* 事实底座仅用于约束生成，不参与渲染 */
  return d;
}

/* 点击「AI 优化简历」：有 Key 走真实 AI（携带当前 JD 定向），否则 Skill 离线模板 */
async function runResume() {
  let text = $('resumeInput').value.trim();
  if (!text) { text = DEMO.resume; $('resumeInput').value = text; }
  const jdText = ($('jdInput') && $('jdInput').value || '').trim();
  disableBtn('resumeBtn');
  showLoading('resumeLoading');
  $('resumeResult').classList.add('hidden');
  LS.set('resumeInput', text);

  if (AI.enabled) {
    try {
      const raw = await AI.chatJSON(
        RESUME_SKILL.buildMessages(text, jdText),
        { task: 'std', stat: 'resume', schema: RESUME_SKILL.SCHEMA, temperature: 0.2, max_tokens: 4000, timeout: 150000 }
      );
      resumeStore = normalizeResume(raw, false);
      /* 核心成品缺失视为本次生成失败，整包走离线模板，不渲染半成品 */
      if (!resumeStore.md) throw new Error('EMPTY');
      resumeStore._real = true;
    } catch (e) {
      toast(e.message || 'AI 调用失败，已切换 Skill 离线模板');
      resumeStore = RESUME_SKILL.mock();
    }
  } else {
    await sleep(1200);                       /* 模拟推理耗时 */
    resumeStore = RESUME_SKILL.mock();
  }
  resumeStore._jdTailored = !!(AI.enabled && jdText);
  renderResume(resumeStore);
  hideLoading('resumeLoading');
  enableBtn('resumeBtn');
  /* 联动 Agent 3 简历上下文 */
  if ($('interviewResumeCtx')) $('interviewResumeCtx').value = text;
}

/* 小圆环（92px，conic-gradient） */
function scoreRingHTML(score) {
  const color = score >= 80 ? '#3df59d' : score >= 60 ? '#8ff5c8' : score >= 45 ? '#fbbf24' : '#f87171';
  return `
    <div style="width:92px;height:92px;flex:0 0 92px;border-radius:50%;
      background:conic-gradient(${color} ${score * 3.6}deg,#1d1d22 0deg);display:grid;place-items:center">
      <div style="width:70px;height:70px;border-radius:50%;background:#0c0c0f;display:grid;place-items:center">
        <b style="font-size:24px;font-weight:800;color:${color};line-height:1">${score}</b>
      </div>
    </div>`;
}

/* 渲染优化结果 */
function renderResume(d) {
  $('resumeResult').classList.remove('hidden');
  const issueMeta = {
    danger: { icon: '🚨', cls: 'text-[#f87171]' },
    warn: { icon: '⚠️', cls: 'text-[#fbbf24]' },
    tip: { icon: '💡', cls: 'text-emerald-300' }
  };
  const dimBars = RESUME_SKILL.DIM_NAMES.map((name, i) => {
    const v = d.dims[i] || 0;
    const c = v >= 80 ? '#3df59d' : v >= 60 ? '#8ff5c8' : v >= 45 ? '#fbbf24' : '#f87171';
    return `
      <div class="flex items-center gap-2">
        <span class="w-[78px] shrink-0 text-right text-[11px] text-[#9a9aa5]">${name}</span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1d1d22]">
          <span class="block h-full rounded-full" style="width:${v}%;background:${c}"></span>
        </span>
        <b class="w-7 shrink-0 text-right text-[11px]" style="color:${c}">${v}</b>
      </div>`;
  }).join('');

  const section = (title, color, body) => `
    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider ${color}">${title}</div>
      ${body}
    </div>`;

  const kwCard = (d.kwHit.length || d.kwMissing.length) ? section(
    d._jdTailored ? 'JD 关键词对齐（本稿已按目标岗位定向）' : 'JD 关键词对齐', 'text-sky-400', `
      <div class="space-y-2.5 text-[12px]">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="mr-1 text-[#9a9aa5]">已覆盖</span>
          ${d.kwHit.map(k => `<span class="chip chip-green !normal-case !tracking-normal">${esc(k)}</span>`).join('')}
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="mr-1 text-[#9a9aa5]">待补强</span>
          ${d.kwMissing.length
            ? d.kwMissing.map(k => `<span class="chip !normal-case !tracking-normal !border-amber-400/40 !text-amber-300">${esc(k)}</span>`).join('')
            : '<span class="text-[#7c7c87]">无明显缺口</span>'}
        </div>
        <p class="pt-1 leading-relaxed text-[#7c7c87]">缺失关键词不要硬塞：会的写进技能栏并在项目里给证据，不会的列入下方补强清单。</p>
      </div>`) : '';

  const profileCard = d.profile ? section('个人总结（可直接放简历顶部）', 'text-emerald-400', `
      <p class="whitespace-pre-line rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12.5px] leading-relaxed text-[#d8d8e0]">${esc(d.profile)}</p>
      <p class="mt-2 text-[10.5px] text-[#7c7c87]">事实型表达，让 HR 自己推出结论，不写性格软词。</p>`) : '';

  const starsCard = d.stars.length ? section('项目 STAR 深度拆解（备面提纲）', 'text-emerald-400', `
      <div class="space-y-3">
        ${d.stars.map(s => `
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3.5">
            <div class="mb-1.5 text-[13px] font-bold">📌 ${esc(s.title)}</div>
            <div class="mb-2 font-mono text-[10.5px] text-sky-300">${esc(s.stack)}</div>
            <div class="grid gap-1.5 text-[12px] leading-relaxed text-[#b6b6c2] sm:grid-cols-2">
              <div><b class="text-[#3df59d]">S 情境</b>　${esc(s.situation)}</div>
              <div><b class="text-emerald-400">T 任务</b>　${esc(s.task)}</div>
              <div><b class="text-amber-400">A 行动</b>　${esc(s.action)}</div>
              <div><b class="text-[#2dd4bf]">R 结果</b>　${esc(s.result)}</div>
            </div>
          </div>`).join('')}
      </div>`) : '';

  const rewriteCard = d.rewrites.length ? section('句子级精修示范', 'text-sky-400', `
      <div class="space-y-2.5">
        ${d.rewrites.map(r => `
          <div class="rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3 text-[12px] leading-relaxed">
            <div class="flex gap-2 text-[#9a9aa5]"><span class="shrink-0 font-bold">原文</span><span class="line-through decoration-[#f87171]/50">${esc(r.before)}</span></div>
            <div class="my-1.5 text-center text-[#3df59d]">↓</div>
            <div class="flex gap-2 text-[#d8f7e7]"><span class="shrink-0 font-bold text-[#3df59d]">精修</span><span>${esc(r.after)}</span></div>
          </div>`).join('')}
      </div>`) : '';

  const issueCard = d.issues.length ? section('简历问题检测', 'text-red-400', `
      <div class="space-y-2">
        ${d.issues.map(q => `
          <div class="flex gap-2.5 rounded-lg border border-[#23232a] bg-[#0c0c0f] p-3">
            <span class="text-base leading-6">${issueMeta[q.level].icon}</span>
            <span class="${issueMeta[q.level].cls} text-[12px] leading-relaxed">${esc(q.text)}</span>
          </div>`).join('')}
      </div>`) : '';

  const todoCard = d.todo.length ? section('你还需要补充 / 动手', 'text-amber-400', `
      <div class="space-y-1.5">
        ${d.todo.map(t => `
          <div class="flex items-start gap-2 text-[12px] leading-relaxed text-[#cfcfd8]">
            <span class="mt-px text-amber-400">☐</span><span>${esc(t)}</span>
          </div>`).join('')}
      </div>`) : '';

  $('resumeResult').innerHTML = `
    <!-- 体检评分 -->
    <div class="card fade-up p-4">
      <div class="mb-3 text-[12px] font-bold uppercase tracking-wider text-[#3df59d]">简历体检 · 五维评分</div>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
        ${scoreRingHTML(d.score)}
        <div class="min-w-0 flex-1">
          <p class="mb-3 text-[12.5px] leading-relaxed text-[#cfcfd8]">${esc(d.scoreText)}</p>
          <div class="space-y-1.5">${dimBars}</div>
        </div>
      </div>
    </div>

    ${kwCard}
    ${profileCard}
    ${starsCard}
    ${rewriteCard}
    ${issueCard}
    ${todoCard}

    <!-- 成品简历 -->
    <div class="card fade-up p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-emerald-400">
          一页纸成品简历（可直接投递）
          ${d._real ? '<span class="chip chip-green !normal-case !tracking-normal">通义千问 Qwen 实时生成</span>' : '<span class="chip !normal-case !tracking-normal">Skill 离线模板</span>'}
        </div>
        <button class="btn btn-ghost !py-1.5 !px-3 !text-[11px]" onclick="copyResumeMD()">复制 Markdown</button>
      </div>
      <div class="doc-md rounded-lg border border-[#23232a] bg-[#0b0b0e] p-4">${mdRender(d.md)}</div>
      <p class="mt-3 text-[10.5px] leading-relaxed text-[#6a6a75]">
        方法论参考：${RESUME_SKILL.sources.map(s => `<span class="chip !normal-case !tracking-normal !py-0.5 !px-2 !text-[10px]">${s}</span>`).join(' ')}
        · 终稿请压到 1 页 A4、单栏导出 PDF，并自行核实全部数字与事实。
      </p>
    </div>`;
}

/* 复制 Markdown 到剪贴板 */
function copyResumeMD() {
  if (!resumeStore) return;
  navigator.clipboard.writeText(resumeStore.md)
    .then(() => toast('成品简历 Markdown 已复制 ✔'))
    .catch(() => toast('复制失败，请手动选择复制'));
}

/* ================================================================
 * Qwen-VL 简历截图识别（多模态）
 * 前端先压缩（最长边 1600 / JPEG），规避云端函数 6MB 请求体限制
 * ================================================================ */
function fileToShrunkDataURL(file, maxEdge) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const edge = maxEdge || 1600;
      if (Math.max(w, h) > edge) {
        const k = edge / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let out = cv.toDataURL('image/jpeg', 0.85);
      if (out.length > 5_000_000) out = cv.toDataURL('image/jpeg', 0.62); /* 兜底再压一档 */
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

async function recognizeResumeImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!AI.enabled) {
    toast('图片识别需接入真实 AI（云端代理或自有百炼 Key）');
    input.value = '';
    return;
  }
  if (!/^image\//.test(file.type)) { toast('请选择图片文件（PNG / JPG 等）'); input.value = ''; return; }

  disableBtn('resumeOcrBtn');
  toast('Qwen-VL 正在识别简历图片…');
  try {
    const dataUrl = await fileToShrunkDataURL(file);
    const text = await AI.chat([
      { role: 'system', content: '你是简历图片识别助手。把图片中的简历内容完整转写为纯文本，保留教育经历、专业技能、项目经历等分段标题与换行，按简历原有顺序输出，不要输出任何解释、总结或 Markdown 符号。' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '请识别并转写这份简历图片中的全部文字内容。' }
      ] }
    ], { task: 'vision', stat: 'vision', temperature: 0.1, max_tokens: 2500, timeout: 120000 });

    const clean = text.trim();
    if (!clean) { toast('未识别到文字，请换更清晰的图片重试'); }
    else {
      const cur = $('resumeInput').value.trim();
      $('resumeInput').value = cur ? cur + '\n\n' + clean : clean;
      LS.set('resumeInput', $('resumeInput').value);
      if (typeof refreshOverviewMeta === 'function') refreshOverviewMeta();
      toast('简历图片识别完成，文本已填入 ✔');
    }
  } catch (e) {
    toast('图片识别失败：' + (e.message || '请重试'));
  } finally {
    input.value = '';
    enableBtn('resumeOcrBtn');
  }
}

/* 示例 / 清空 */
function loadResumeExample() { $('resumeInput').value = DEMO.resume; runResume(); }
function clearResume() {
  $('resumeInput').value = '';
  LS.set('resumeInput', '');
  $('resumeResult').classList.add('hidden');
  if (typeof refreshOverviewMeta === 'function') refreshOverviewMeta();
}
