/* =====================================================================
 * 极简静态文件服务器：node server.js → http://localhost:8787
 * 额外：与云端同款的 /api/qwen 代理（通义千问 / 阿里云百炼），
 * 支持普通 JSON 与 SSE 流式（stream:true）两种透传，便于本地联调。
 *   本地启用云端代理：
 *     PowerShell → $env:DASHSCOPE_API_KEY="sk-xxxx"; node server.js
 *   未设置环境变量时代理保持禁用。
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* 本地默认 8787；魔搭创空间 Docker 要求监听 0.0.0.0:7860，由环境变量注入 */
const PORT = process.env.PORT || 8787;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const UPSTREAM = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DEFAULT_MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const MAX_TOKENS_CAP = 4000;
/* 允许客户端指定的模型（其余强制回落默认模型，防止越权盗刷） */
const MODEL_ALLOWLIST = [
  'qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-vl-plus', 'qwen-vl-max',
  'qwen3-omni-flash', 'qwen3.5-omni-flash', 'qwen3-omni-plus', 'qwen3.5-omni-plus'
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/* ---------------- 云端代理（镜像 netlify/functions/qwen.js） ---------------- */
async function handleProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Content-Type': 'text/plain' });
    return res.end();
  }
  if (req.method === 'GET') {
    return sendJSON(res, 200, { proxy: true, enabled: !!API_KEY, model: DEFAULT_MODEL });
  }
  if (req.method !== 'POST') return sendJSON(res, 405, { error: { message: 'Method Not Allowed' } });
  if (!API_KEY) return sendJSON(res, 503, { error: { message: '本地未设置 DASHSCOPE_API_KEY 环境变量' } });

  let raw = '';
  for await (const chunk of req) raw += chunk;
  let payload;
  try { payload = JSON.parse(raw || '{}'); }
  catch (e) { return sendJSON(res, 400, { error: { message: '请求体不是合法 JSON' } }); }
  if (!Array.isArray(payload.messages) || !payload.messages.length) {
    return sendJSON(res, 400, { error: { message: 'messages 不能为空' } });
  }
  /* 模型白名单 + token 上限；stream / response_format / enable_thinking 原样透传 */
  payload.model = MODEL_ALLOWLIST.includes(payload.model) ? payload.model : DEFAULT_MODEL;
  payload.max_tokens = Math.min(Number(payload.max_tokens) || 2200, MAX_TOKENS_CAP);

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return sendJSON(res, 502, { error: { message: '本地代理无法连接阿里云百炼上游服务' } });
  }

  /* 流式：原样转发 SSE，逐块推送，保证打字机实时性 */
  if (payload.stream) {
    res.writeHead(upstream.status, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (e) { /* 客户端断开等 */ }
    return res.end();
  }

  /* 普通 JSON：透传状态码与响应体 */
  const text = await upstream.text();
  res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

/* ---------------- 静态文件 ---------------- */
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/api/qwen') return handleProxy(req, res);

  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
/* 拉长空闲 keep-alive（Node 默认 5s 先于浏览器回收 socket，
   Chrome 复用半死连接发 POST 会 net::ERR_ABORTED） */
server.keepAliveTimeout = 75000;
server.headersTimeout = 76000;
server.listen(PORT, HOST, () => {
  console.log('CodeMate running at http://' + HOST + ':' + PORT);
  console.log('Qwen proxy: ' + (API_KEY ? 'ENABLED (default model=' + DEFAULT_MODEL + ')' : 'disabled（设置 $env:DASHSCOPE_API_KEY 可本地启用）'));
});
