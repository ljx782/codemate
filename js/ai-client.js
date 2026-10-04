/* =====================================================================
 * ai-client.js — 通义千问 Qwen 大模型客户端（阿里云百炼 · 真实 AI）
 * 三种工作模式（优先级：自有 Key 直连 > 云端代理 > 本地模拟）：
 *  · direct：用户在「AI 设置」填入自己的百炼 Key（仅存本机 localStorage），
 *            浏览器直接跨域调用 DashScope OpenAI 兼容接口；
 *  · proxy：部署到云端且配置了 DASHSCOPE_API_KEY 时，页面同源请求
 *           /api/qwen，由服务端转发，访问者无需填 Key；
 *  · off：  两者都不可用，各 Agent 回退本地模拟逻辑。
 *
 * 能力：
 *  · chat()      非流式调用，支持 json_object / json_schema 严格模式
 *  · chatStream()流式 SSE，onChunk(增量文本, 累计文本) 实时回显
 *  · 模型分级路由：task = fast(turbo) / std(plus) / pro(max) / vision(vl-plus)
 *  · 统一关闭 Qwen3 思考模式（enable_thinking:false），低延迟、输出稳定
 *  · AIStats 用量钩子：每次成功调用上报 token / 场景（若统计模块已加载）
 * ===================================================================== */

/* 任务档位 → 模型（对应百炼 Agent 2.0 的 经济/均衡/性能/多模态 叙事） */
const TASK_MODELS = {
  fast: 'qwen-turbo',          /* 经济档：面试官多轮对话、邮件话术，高频低成本 */
  std: 'qwen-plus',            /* 均衡档：JD/简历/匹配度等结构化分析 */
  pro: 'qwen-max',             /* 性能档：最终复盘评分报告 */
  vision: 'qwen-vl-plus',      /* 多模态档：简历图片识别 */
  omni: 'qwen3.5-omni-flash'   /* 全模态档：语音模拟面试（文本+音频输出） */
};
/* 云端代理允许透传的模型白名单（防止越权指定任意模型盗刷） */
const MODEL_ALLOWLIST = [
  'qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-vl-plus', 'qwen-vl-max',
  'qwen3-omni-flash', 'qwen3.5-omni-flash', 'qwen3-omni-plus', 'qwen3.5-omni-plus'
];

const AI = {
  KEY: '',
  MODEL: 'qwen-plus',              /* 用户自填 Key 时的默认模型 */
  DIRECT_ENDPOINT: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  PROXY_ENDPOINT: '/api/qwen',
  enabled: false,
  mode: 'off',                     /* 'direct' | 'proxy' | 'off' */
  proxy: { available: false, enabled: false, model: 'qwen-plus' },

  /* 启动时读取本机配置并评估模式；顺带清理 DeepSeek 时期的旧存储键 */
  init() {
    ['codemate_dsKey', 'codemate_dsModel'].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
    this.KEY = LS.get('qwenKey', '');
    this.MODEL = LS.get('qwenModel', 'qwen-plus') || 'qwen-plus';
    this.evaluate();
  },
  /* 部署环境探测：GET /api/qwen，6 秒内无应答视为无云端代理 */
  async detectProxy() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(this.PROXY_ENDPOINT, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        this.proxy = { available: true, enabled: !!d.enabled, model: d.model || 'qwen-plus' };
      } else {
        this.proxy = { available: false, enabled: false, model: 'qwen-plus' };
      }
    } catch (e) {
      this.proxy = { available: false, enabled: false, model: 'qwen-plus' };
    }
    this.evaluate();
  },
  evaluate() {
    if (this.KEY) { this.mode = 'direct'; this.enabled = true; }
    else if (this.proxy.available && this.proxy.enabled) {
      this.mode = 'proxy';
      this.enabled = true;
      this.MODEL = this.proxy.model;
    } else { this.mode = 'off'; this.enabled = false; }
    refreshAIStatus();
  },
  save(key, model) {
    this.KEY = (key || '').trim();
    this.MODEL = model || 'qwen-plus';
    LS.set('qwenKey', this.KEY);
    LS.set('qwenModel', this.MODEL);
    this.evaluate();
  },
  clear() {
    this.KEY = '';
    LS.set('qwenKey', '');
    this.evaluate();
  },

  /* 解析本次调用使用的模型：显式 model > task 档位 > 环境默认 */
  pickModel(opts = {}) {
    if (opts.model && MODEL_ALLOWLIST.includes(opts.model)) return opts.model;
    if (opts.task && TASK_MODELS[opts.task]) return TASK_MODELS[opts.task];
    return this.mode === 'proxy' ? this.proxy.model : this.MODEL;
  },

  /* 构造请求体 */
  _buildBody(messages, opts, stream) {
    const body = {
      model: this.pickModel(opts),
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.max_tokens || 2200,
      enable_thinking: false,
      stream: !!stream
    };
    if (opts.schema) body.response_format = {
      type: 'json_schema',
      json_schema: { name: opts.schema.name || 'result', strict: true, schema: opts.schema.schema }
    };
    else if (opts.json) body.response_format = { type: 'json_object' };
    /* Function Calling（MCP 风格本地工具）：tools=[{type:'function',function:{...}}] */
    if (Array.isArray(opts.tools) && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice || 'auto';
    }
    /* DashScope 兼容模式：流式默认不下发 usage，需显式索取（末帧携带） */
    if (stream) body.stream_options = { include_usage: true };
    return body;
  },

  /* 核心调用：messages=[{role,content}...]，返回助手文本 */
  async chat(messages, opts = {}) {
    if (!this.enabled) throw new AIError('NO_KEY', '尚未配置 API Key 或云端代理');
    const useProxy = this.mode === 'proxy';

    const doFetch = async (body) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
      const init = {
        method: 'POST',
        headers: useProxy
          ? { 'Content-Type': 'application/json' }
          : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.KEY },
        body: JSON.stringify(body),
        signal: ctrl.signal
      };
      /* 复用半死 keep-alive socket 时 Chrome 会瞬间 ERR_ABORTED：原样重试一次 */
      let netAttempts = 0; const t0 = Date.now();
      try {
        for (;;) {
          try {
            return await fetch(useProxy ? this.PROXY_ENDPOINT : this.DIRECT_ENDPOINT, init);
          } catch (e) {
            if (e.name === 'AbortError') throw new AIError('TIMEOUT', 'AI 响应超时（>90s），请重试');
            if (netAttempts++ === 0 && Date.now() - t0 < 5000) continue;
            throw new AIError('NETWORK', useProxy
              ? '无法连接云端 AI 代理（网络异常），已切换本地模拟'
              : '无法连接阿里云百炼（网络或跨域被拦截），已切换本地模拟');
          }
        }
      } finally {
        clearTimeout(timer);
      }
    };

    const ensureOK = async (resp) => {
      if (resp.ok) return;
      const d = await resp.json().catch(() => ({}));
      const detail = d.error?.message || '';
      if (resp.status === 401) throw new AIError('AUTH', useProxy ? '云端 API Key 失效，请联系站点管理员' : '百炼 API Key 无效或已失效，请检查后重试');
      if (resp.status === 402) throw new AIError('QUOTA', useProxy ? '云端百炼账户额度不足，请联系站点管理员' : '阿里云百炼账户余额不足或欠费，请充值后重试');
      if (resp.status === 403) throw new AIError('FORBID', '云端代理拒绝了本次请求');
      if (resp.status === 429) throw new AIError('RATE', '请求过于频繁（触发限流），请稍后再试');
      if (resp.status === 503) throw new AIError('NOKEY', '云端尚未配置 DASHSCOPE_API_KEY');
      throw new AIError('HTTP' + resp.status, 'AI 服务返回错误 (' + resp.status + ') ' + detail);
    };

    /* json_schema 在个别模型上可能不被支持：失败一次后自动降级 json_object */
    let resp = await doFetch(this._buildBody(messages, opts, false));
    if (!resp.ok && opts.schema) {
      const d = await resp.clone().json().catch(() => ({}));
      const msg = String(d.error?.message || '');
      if (/response_format|json_schema|invalid/i.test(msg)) {
        resp = await doFetch(this._buildBody(messages, { ...opts, schema: null, json: true }, false));
      }
    }
    await ensureOK(resp);

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new AIError('EMPTY', 'AI 返回内容为空，请重试');
    this._track(opts.stat || opts.task || 'call', data.usage, this.pickModel(opts));
    return text;
  },

  /* 流式调用：onChunk(deltaText, fullText)，resolve 完整文本 */
  async chatStream(messages, opts = {}, onChunk) {
    if (!this.enabled) throw new AIError('NO_KEY', '尚未配置 API Key 或云端代理');
    const useProxy = this.mode === 'proxy';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
    const fetchOpts = {
      method: 'POST',
      headers: useProxy
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.KEY },
      body: JSON.stringify(this._buildBody(messages, opts, true)),
      signal: ctrl.signal
    };
    /* 复用半死 keep-alive socket 时 Chrome 会瞬间 ERR_ABORTED：原样重试一次 */
    let resp, netAttempts = 0, t0 = Date.now();
    try {
      for (;;) {
        try {
          resp = await fetch(useProxy ? this.PROXY_ENDPOINT : this.DIRECT_ENDPOINT, fetchOpts);
          break;
        } catch (e) {
          if (e.name === 'AbortError') throw new AIError('TIMEOUT', 'AI 响应超时（>90s），请重试');
          if (netAttempts++ === 0 && Date.now() - t0 < 5000) continue;
          throw e;
        }
      }
    } catch (e) {
      clearTimeout(timer);
      throw new AIError('NETWORK', useProxy
        ? '无法连接云端 AI 代理（网络异常）'
        : '无法连接阿里云百炼（网络或跨域被拦截）');
    }
    clearTimeout(timer);
    if (!resp.ok || !resp.body) {
      const d = await resp.json().catch(() => ({}));
      const detail = d.error?.message || '';
      if (resp.status === 429) throw new AIError('RATE', '请求过于频繁（触发限流），请稍后再试');
      if (resp.status === 401) throw new AIError('AUTH', 'API Key 无效或已失效');
      throw new AIError('HTTP' + resp.status, 'AI 服务返回错误 (' + resp.status + ') ' + detail);
    }

    /* 逐行解析 SSE：data: {chunk} / data: [DONE] */
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', full = '', usage = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch (e) { continue; }
        if (json.usage) usage = json.usage;
        const piece = json.choices?.[0]?.delta?.content || '';
        if (piece) {
          full += piece;
          try { onChunk && onChunk(piece, full); } catch (cbErr) { /* 渲染异常不中断流 */ }
        }
      }
    }
    if (!full) throw new AIError('EMPTY', 'AI 返回内容为空，请重试');
    this._track(opts.stat || opts.task || 'stream', usage, this.pickModel(opts));
    return full;
  },

  /* 用量统计钩子（AIStats 由 agent-overview.js 提供，未加载时静默跳过） */
  _track(stat, usage, model) {
    try {
      if (typeof AIStats !== 'undefined' && AIStats && AIStats.track) {
        AIStats.track(stat, usage || {}, model);
      }
    } catch (e) { /* ignore */ }
  },

  /* 便捷方法：要求 JSON 输出并容错解析（opts.schema 可给严格 Schema） */
  async chatJSON(messages, opts = {}) {
    const text = await this.chat(messages, { ...opts, json: !opts.schema });
    return extractJSON(text);
  },

  /* Qwen3.5-Omni 全模态：流式返回文本 + 音频（24kHz/16bit/mono PCM base64 分片）
   * resolve { text, audioB64 }；onText(fullText) 用于打字机渲染 */
  async chatOmni(messages, opts = {}, onText) {
    if (!this.enabled) throw new AIError('NO_KEY', '尚未配置 API Key 或云端代理');
    const useProxy = this.mode === 'proxy';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
    const body = {
      model: this.pickModel({ task: 'omni' }),
      messages,
      stream: true,
      stream_options: { include_usage: true },
      modalities: ['text', 'audio'],
      audio: { voice: opts.voice || 'Ethan', format: 'wav' },
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens || 800,
      enable_thinking: false
    };
    const fetchOpts = {
      method: 'POST',
      headers: useProxy
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal
    };
    /* 复用半死 keep-alive socket 时 Chrome 会瞬间 ERR_ABORTED：原样重试一次 */
    let resp, netAttempts = 0, t0 = Date.now();
    try {
      for (;;) {
        try {
          resp = await fetch(useProxy ? this.PROXY_ENDPOINT : this.DIRECT_ENDPOINT, fetchOpts);
          break;
        } catch (e) {
          if (e.name === 'AbortError') throw new AIError('TIMEOUT', '语音服务响应超时，请重试');
          if (netAttempts++ === 0 && Date.now() - t0 < 5000) continue;
          throw e;
        }
      }
    } catch (e) {
      clearTimeout(timer);
      throw new AIError('NETWORK', '无法连接全模态语音服务');
    }
    clearTimeout(timer);
    if (!resp.ok || !resp.body) {
      const d = await resp.json().catch(() => ({}));
      throw new AIError('HTTP' + resp.status, d.error?.message || ('语音服务错误 (' + resp.status + ')'));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', text = '', audioB64 = '', usage = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch (e) { continue; }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) { text += delta.content; try { onText && onText(text); } catch (e) { /* */ } }
        if (delta.audio && delta.audio.data) audioB64 += delta.audio.data;
      }
    }
    if (!text && !audioB64) throw new AIError('EMPTY', '语音模型返回为空');
    this._track('interview', usage, body.model);
    return { text, audioB64 };
  },

  /* Function Calling：返回原始 assistant message（可能含 content 与 tool_calls） */
  async chatTool(messages, tools, opts = {}) {
    if (!this.enabled) throw new AIError('NO_KEY', '尚未配置 API Key 或云端代理');
    const useProxy = this.mode === 'proxy';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
    const init = {
      method: 'POST',
      headers: useProxy
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.KEY },
      body: JSON.stringify(this._buildBody(messages, { ...opts, tools }, false)),
      signal: ctrl.signal
    };
    /* 复用半死 keep-alive socket 时 Chrome 会瞬间 ERR_ABORTED：原样重试一次 */
    let resp, netAttempts = 0; const t0 = Date.now();
    try {
      for (;;) {
        try {
          resp = await fetch(useProxy ? this.PROXY_ENDPOINT : this.DIRECT_ENDPOINT, init);
          break;
        } catch (e) {
          if (e.name === 'AbortError') throw new AIError('TIMEOUT', 'AI 响应超时，请重试');
          if (netAttempts++ === 0 && Date.now() - t0 < 5000) continue;
          throw new AIError('NETWORK', '工具调用请求失败（网络异常）');
        }
      }
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
    clearTimeout(timer);
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new AIError('HTTP' + resp.status, d.error?.message || ('AI 服务返回错误 (' + resp.status + ')'));
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg || (!msg.content && !(msg.tool_calls || []).length)) {
      throw new AIError('EMPTY', 'AI 未返回内容或工具调用');
    }
    this._track(opts.stat || 'tool', data.usage, this.pickModel(opts));
    return msg;
  },

  /* 连通性测试（设置弹窗用） */
  async ping() {
    const t0 = Date.now();
    await this.chat(
      [{ role: 'user', content: '回复两个字：正常' }],
      { max_tokens: 20, temperature: 0, timeout: 20000, task: 'fast', stat: 'ping' }
    );
    return Date.now() - t0;
  }
};

/* 模型短名（徽标展示用） */
function qwenShortName(m) {
  if (m === 'qwen-max') return 'Max';
  if (m === 'qwen-turbo') return 'Turbo';
  if (m === 'qwen-flash') return 'Flash';
  if (m && m.indexOf('vl') !== -1) return 'VL';
  return 'Plus';
}

/* 自定义错误类型 */
function AIError(code, message) {
  this.code = code;
  this.message = message;
}
AIError.prototype = Object.create(Error.prototype);
AIError.prototype.name = 'AIError';

/* 从模型文本中提取 JSON（容忍 ```json 代码块包裹与前后多余文字） */
function extractJSON(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) { /* 继续兜底 */ }
  const s = t.indexOf('{'), e2 = t.lastIndexOf('}');
  if (s !== -1 && e2 > s) {
    try { return JSON.parse(t.slice(s, e2 + 1)); } catch (e2err) { /* ignore */ }
  }
  throw new AIError('PARSE', 'AI 返回格式无法解析，已切换本地模拟');
}

/* ---------- 顶部 AI 状态徽标（三种模式） ---------- */
function refreshAIStatus() {
  const dot = $('aiDot');
  const txt = $('aiStateText');
  if (!dot || !txt) return;
  dot.style.boxShadow = '0 0 8px #3df59d';
  if (AI.mode === 'proxy') {
    dot.style.background = '#3df59d';
    txt.textContent = '云端 AI · 阿里云百炼代理';
    txt.style.color = '#3df59d';
  } else if (AI.mode === 'direct') {
    dot.style.background = '#3df59d';
    txt.textContent = '真实 AI · 自有 Key · Qwen ' + qwenShortName(AI.MODEL);
    txt.style.color = '#3df59d';
  } else {
    dot.style.background = '#7c7c87';
    dot.style.boxShadow = 'none';
    txt.textContent = '模拟模式 · 未接入 AI';
    txt.style.color = '#8a8a96';
  }
  /* 同步弹窗内的云端状态条 */
  const note = $('aiProxyNote');
  if (note) {
    if (AI.proxy.available && AI.proxy.enabled) {
      note.style.display = 'block';
      note.className = 'mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-[11.5px] leading-relaxed text-emerald-300';
      note.textContent = '☁️ 已检测到云端 AI 代理（通义千问 ' + AI.proxy.model + '）：Key 由部署环境统一提供，'
        + (AI.KEY ? '但你填写的自有 Key 当前优先生效。' : '所有访客无需填写 Key 即可直接使用真实 AI。');
    } else {
      note.style.display = 'none';
    }
  }
}

/* ---------- AI 设置弹窗 ---------- */
function openAISettings() {
  $('aiModal').classList.remove('hidden');
  $('aiKeyInput').value = AI.KEY || '';
  $('aiModelSelect').value = ['qwen-max', 'qwen-turbo', 'qwen-flash'].includes(AI.MODEL) ? AI.MODEL : 'qwen-plus';
  $('aiTestResult').textContent = '';
  refreshAIStatus();
}
function closeAISettings() { $('aiModal').classList.add('hidden'); }

async function testAIKey() {
  const key = $('aiKeyInput').value.trim();
  const model = $('aiModelSelect').value;
  const resultEl = $('aiTestResult');

  if (!key) {
    if (AI.mode === 'proxy') {
      resultEl.textContent = '正在测试云端代理…';
      resultEl.style.color = '#8a8a96';
      try {
        const ms = await AI.ping();
        resultEl.textContent = `云端代理连接成功 ✔（${ms}ms），访客可免填 Key 使用`;
        resultEl.style.color = '#34d399';
      } catch (e) {
        resultEl.textContent = '✖ ' + e.message;
        resultEl.style.color = '#f87171';
      }
      return;
    }
    resultEl.textContent = '请填写百炼 API Key（或先在云端配置代理）';
    resultEl.style.color = '#fbbf24';
    return;
  }

  AI.save(key, model);
  resultEl.textContent = '正在测试连接…';
  resultEl.style.color = '#8a8a96';
  try {
    const ms = await AI.ping();
    resultEl.textContent = `连接成功 ✔（${ms}ms），已切换为自有 Key 直连模式`;
    resultEl.style.color = '#34d399';
  } catch (e) {
    resultEl.textContent = '✖ ' + e.message;
    resultEl.style.color = '#f87171';
  }
}

function saveAISettings() {
  AI.save($('aiKeyInput').value, $('aiModelSelect').value);
  if (AI.mode === 'direct') toast('已保存，使用你的 Key 直连通义千问 Qwen ✔');
  else if (AI.mode === 'proxy') toast('已清除自有 Key，改用云端百炼代理 ✔');
  else toast('未接入 AI，使用本地模拟模式');
  closeAISettings();
}
