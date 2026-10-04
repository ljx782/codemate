/* =====================================================================
 * EdgeOne Pages 边缘函数：通义千问 Qwen 云端代理（阿里云百炼）
 *
 * 文件即路由：edge-functions/api/qwen.js → 同源路径 /api/qwen
 * 前端 ai-client.js 启动时会探测 /api/qwen，与 Netlify 版共用同一
 * 调用契约，无需改动任何前端代码。
 *
 * 环境变量（在 EdgeOne Pages 控制台 → 项目 → 边缘函数/环境变量中配置）：
 *   DASHSCOPE_API_KEY  必填（阿里云百炼控制台获取，sk- 开头）
 *   QWEN_MODEL         可选，默认 qwen-plus
 *
 * 约定：
 *   GET  → 健康探测，返回代理是否可用（不泄露 Key）
 *   POST → 透传百炼 OpenAI 兼容 Chat Completions 请求并原样回传响应
 *   OPTIONS → 预检（同源调用本不会触发）
 *
 * 运行时为 Web 标准（Request/Response/fetch），与 Netlify 版的
 * event 回调式签名不同，其余安全策略保持一致：
 *   · Key 只从 env 读取、永不下发；
 *   · 校验同源，跨站浏览器调用会被 CORS 拦截；
 *   · 强制服务端模型并限制 max_tokens 上限，降低被盗刷成本。
 *
 * DASHSCOPE_API_KEY 必须在部署平台环境变量中配置；源码不包含访问密钥。
 * ===================================================================== */

const UPSTREAM = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MAX_TOKENS_CAP = 4000;
/* 允许客户端按任务档位指定的模型（与 ai-client.js TASK_MODELS 对齐）；
   非白名单值一律回落环境默认模型，防止越权指定任意模型盗刷 */
const MODEL_ALLOWLIST = ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-vl-plus', 'qwen-vl-max'];

/* 统一 JSON 响应；同源 API 不下发任何 Access-Control-Allow-* 头 */
function json(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/* 判断请求是否来自本站页面：Origin/Referer 的 host 须与请求 Host 一致 */
function isSameOrigin(request) {
  const origin = request.headers.get('origin') || request.headers.get('referer');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch (e) {
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  /* 跨站预检：不返回任何 CORS 允许头，浏览器侧即被拦截 */
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  const apiKey = env?.DASHSCOPE_API_KEY || '';
  const model = env?.QWEN_MODEL || 'qwen-plus';

  /* 健康探测：只暴露“是否已配置”，不暴露 Key */
  if (request.method === 'GET') {
    return json(200, { proxy: true, enabled: !!apiKey, model });
  }

  if (request.method !== 'POST') {
    return json(405, { error: { message: 'Method Not Allowed' } });
  }
  if (!isSameOrigin(request)) {
    return json(403, { error: { message: '仅允许本站页面调用' } });
  }
  if (!apiKey) {
    return json(503, { error: { message: '云端尚未配置 DASHSCOPE_API_KEY 环境变量' } });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json(400, { error: { message: '请求体不是合法 JSON' } });
  }
  if (!payload || !Array.isArray(payload.messages) || !payload.messages.length) {
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

  /* SSE 流式：边缘运行时原生支持 ReadableStream，直接透传上游响应体，
     保证打字机逐字实时性 */
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
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
