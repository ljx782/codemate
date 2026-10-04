/* =====================================================================
 * Netlify Function：通义千问 Qwen 云端代理（阿里云百炼）
 * 部署后前端同源调用 /.netlify/functions/qwen（经 netlify.toml
 * 重写为 /api/qwen），API Key 只保存在服务端：
 *   DASHSCOPE_API_KEY  必填（阿里云百炼控制台获取，sk- 开头）
 *   QWEN_MODEL         可选，默认 qwen-plus（也可 qwen-turbo / qwen-max）
 *
 * 约定：
 *   GET  → 健康探测，返回代理是否可用（不泄露 Key）
 *   POST → 透传百炼 OpenAI 兼容 Chat Completions 请求并原样回传响应
 *   OPTIONS → CORS 预检
 * 安全：
 *   · Key 永不下发到浏览器，响应中不回显；
 *   · 前端经 netlify.toml 重写做同源调用，故不下发任何跨域允许头，
 *     第三方网站从浏览器发起的调用会被 CORS 直接拦截；
 *   · 校验 Origin/Referer 与 Host 同源，挡掉随手构造的跨站请求；
 *   · 限制单次 max_tokens 上限，降低被盗刷成本。
 *   注意：以上能拦截网页层面的盗用，无法阻止持伪造头的脚本直调，
 *   公开站点建议再在 Netlify 侧开启速率限制（高并发场景）。
 *
 * DASHSCOPE_API_KEY 必须在 Netlify 环境变量中配置；源码不包含访问密钥。
 * ===================================================================== */

const UPSTREAM = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MAX_TOKENS_CAP = 4000;
/* 允许客户端按任务档位指定的模型（与 ai-client.js TASK_MODELS 对齐）；
   非白名单值一律回落环境默认模型，防止越权指定任意模型盗刷 */
const MODEL_ALLOWLIST = [
  'qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-vl-plus', 'qwen-vl-max',
  'qwen3-omni-flash', 'qwen3.5-omni-flash', 'qwen3-omni-plus', 'qwen3.5-omni-plus'
];

function json(statusCode, payload) {
  /* 同源 API：不输出 Access-Control-Allow-* 头，跨站读取会被浏览器拦截 */
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

/* 判断请求是否来自本站页面（同源），直接 curl 无 Origin 时不额外放行写操作 */
function isSameOrigin(event) {
  const h = event.headers || {};
  const pick = k => (h[k] || h[k.toLowerCase()] || '');
  const origin = pick('origin') || pick('referer');
  const host = pick('host') || (event.headers?.host || '');
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  /* 预检：同源请求本不会触发预检；跨站预检不返回任何 CORS 允许头即被浏览器拦截 */
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Content-Type': 'text/plain' },
      body: ''
    };
  }

  const apiKey = process.env.DASHSCOPE_API_KEY || '';
  const model = process.env.QWEN_MODEL || 'qwen-plus';

  /* 健康探测：只暴露"是否已配置"，不暴露 Key */
  if (event.httpMethod === 'GET') {
    return json(200, { proxy: true, enabled: !!apiKey, model });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: { message: 'Method Not Allowed' } });
  if (!isSameOrigin(event)) return json(403, { error: { message: '仅允许本站页面调用' } });
  if (!apiKey) return json(503, { error: { message: '云端尚未配置 DASHSCOPE_API_KEY 环境变量' } });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: { message: '请求体不是合法 JSON' } });
  }
  if (!Array.isArray(payload.messages) || !payload.messages.length) {
    return json(400, { error: { message: 'messages 不能为空' } });
  }

  /* 模型白名单 + token 上限；stream / response_format / enable_thinking 原样透传 */
  payload.model = MODEL_ALLOWLIST.includes(payload.model) ? payload.model : model;
  payload.max_tokens = Math.min(Number(payload.max_tokens) || 2200, MAX_TOKENS_CAP);

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json(502, { error: { message: '云端代理无法连接阿里云百炼上游服务' } });
  }

  /* SSE 流式：Netlify Node18+ 运行时支持直接返回 Web Response，
     把上游 ReadableStream 原样转发，保证打字机逐字实时性 */
  if (payload.stream && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    });
  }

  /* 普通 JSON：透传上游状态码与响应体，便于前端做 401/402/429 分流 */
  const text = await upstream.text();
  return {
    statusCode: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: text
  };
};
