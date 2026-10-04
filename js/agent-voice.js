/* =====================================================================
 * agent-voice.js — P2 · 语音模拟面试
 *  · 面试官语音：阿里云百炼 Qwen3.5-Omni 全模态模型（文本+音频流式输出）
 *  · 张嘴答题：浏览器 Web Speech API 语音识别（Chrome / Edge，中文），
 *    识别文本直接进入多轮对话与复盘报告，链路与打字完全一致
 *  · Omni 异常时自动降级浏览器本地朗读（speechSynthesis），面试不中断
 * 由 agent-interview.js 的 interviewAsk() 在 interview.voice=true 时调用
 * ===================================================================== */

const Voice = {
  on: false,
  recog: null,
  listening: false,
  baseText: '',
  audioEl: null,
  supportedRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
};

/* ---------------- PCM → WAV（Omni 返回 24kHz / mono / 16bit 裸 PCM） ---------------- */
function pcmBase64ToWavBlob(b64, sampleRate = 24000) {
  const bin = atob(b64);
  const dataLen = bin.length;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true);          /* PCM fmt chunk */
  v.setUint16(20, 1, true);           /* PCM */
  v.setUint16(22, 1, true);           /* mono */
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ws(36, 'data');
  v.setUint32(40, dataLen, true);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < dataLen; i++) u8[44 + i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'audio/wav' });
}

/* 播放 Omni 语音；失败 / 被浏览器拦截时在最后一条气泡内放手动播放条 */
function playOmniAudio(b64) {
  if (!b64) return;
  if (!Voice.audioEl) Voice.audioEl = new Audio();
  const url = URL.createObjectURL(pcmBase64ToWavBlob(b64));
  Voice.audioEl.pause();
  Voice.audioEl.src = url;
  Voice.audioEl.play().catch(() => {
    /* 自动播放被拦：挂一个手动播放按钮到最新气泡 */
    const box = $('chatBox');
    if (!box) return;
    const last = box.lastElementChild;
    if (!last) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost !py-1 !px-2.5 !text-[11px] mt-1';
    btn.textContent = '🔊 播放面试官语音';
    btn.onclick = () => Voice.audioEl.play();
    last.appendChild(btn);
  });
  Voice.audioEl.onended = () => setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* 浏览器本地朗读（降级方案） */
function speakLocal(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, ''));
    u.lang = 'zh-CN';
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

/* ================================================================
 * 语音回合：供 agent-interview.js 调用，签名对齐 chatStream
 * resolve 面试官文本（同时自动播放语音）
 * ================================================================ */
async function voiceAsk(messages, onPaint) {
  try {
    const r = await AI.chatOmni(messages, { voice: 'Ethan', temperature: 0.7, max_tokens: 700, timeout: 90000 }, onPaint);
    playOmniAudio(r.audioB64);
    if (r.text && r.text.trim()) return r.text.trim();
    return '（面试官已通过语音回复，请点击气泡中的播放条收听）';
  } catch (e) {
    /* Omni 不可用：退回普通文本流式 + 本地朗读，保证面试不中断 */
    const text = await AI.chatStream(messages,
      { task: 'fast', stat: 'interview', temperature: 0.7, max_tokens: 600, timeout: 60000 },
      (_p, full) => onPaint(full));
    speakLocal(text);
    toast('Omni 语音服务暂不可用，已改用浏览器本地朗读');
    return text;
  }
}

/* ================================================================
 * 语音模式开关
 * ================================================================ */
function toggleVoiceMode() {
  const btn = $('voiceToggleBtn');
  if (!Voice.on) {
    if (!AI.enabled) { toast('语音面试官需要接入真实 AI（云端代理或自有 Key）'); return; }
    Voice.on = true;
    if (typeof interview !== 'undefined') interview.voice = true;
    if (btn) { btn.textContent = '🔊 语音模式：开'; btn.classList.add('!border-[#3df59d]/60', '!text-[#3df59d]'); }
    const mic = $('micBtn');
    if (mic && Voice.supportedRecognition) mic.classList.remove('hidden');
    toast(Voice.supportedRecognition
      ? '语音模式已开启：面试官将用 Qwen-Omni 语音回答，点 🎤 张嘴答题'
      : '语音模式已开启：面试官将语音回答；当前浏览器不支持语音识别，请继续打字');
  } else {
    Voice.on = false;
    if (typeof interview !== 'undefined') interview.voice = false;
    stopMic();
    if (Voice.audioEl) Voice.audioEl.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (btn) { btn.textContent = '🔇 语音模式'; btn.classList.remove('!border-[#3df59d]/60', '!text-[#3df59d]'); }
    $('micBtn')?.classList.add('hidden');
    toast('语音模式已关闭');
  }
}

/* ================================================================
 * 麦克风语音识别（Web Speech API）
 * ================================================================ */
function ensureRecognition() {
  if (Voice.recog || !Voice.supportedRecognition) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let fin = '', itm = '';
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) fin += t; else itm += t;
    }
    const el = $('userAnswer');
    if (el) el.value = (Voice.baseText + fin + itm).replace(/\s+/g, ' ').trim();
  };
  rec.onerror = () => { Voice.listening = false; updateMicUI(); };
  rec.onend = () => {
    Voice.listening = false;
    updateMicUI();
    const v = ($('userAnswer')?.value || '').trim();
    if (v && typeof interview !== 'undefined' && interview.started && !interview.busy) submitAnswer();
  };
  Voice.recog = rec;
}

function updateMicUI() {
  const btn = $('micBtn');
  if (!btn) return;
  btn.textContent = Voice.listening ? '🔴 正在聆听…（点击结束）' : '🎤 张嘴答题';
  btn.classList.toggle('!border-red-400/60', Voice.listening);
  btn.classList.toggle('!text-red-400', Voice.listening);
}

function toggleMic() {
  if (!Voice.on) { toast('请先开启语音模式'); return; }
  if (!Voice.supportedRecognition) { toast('当前浏览器不支持语音识别，请使用 Chrome / Edge，或直接打字回答'); return; }
  if (typeof interview === 'undefined' || !interview.started) { toast('请先点击「开始模拟面试」'); return; }
  if (interview.busy) { toast('面试官正在说话，请稍候…'); return; }
  ensureRecognition();
  if (Voice.listening) { Voice.recog.stop(); return; }
  Voice.baseText = ($('userAnswer')?.value || '').trim();
  if (Voice.baseText) Voice.baseText += ' ';
  try {
    Voice.recog.start();
    Voice.listening = true;
    updateMicUI();
  } catch (e) { /* 快速重复点击偶发 InvalidStateError */ }
}

function stopMic() {
  if (Voice.listening && Voice.recog) { try { Voice.recog.stop(); } catch (e) { /* */ } }
  Voice.listening = false;
}
