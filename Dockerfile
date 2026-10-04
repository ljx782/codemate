# CodeMate 求职工作台 — 魔搭创空间 Docker 镜像
# 服务零第三方依赖（仅用 Node 内置模块），镜像极小、构建极快
FROM node:22-slim

WORKDIR /app

# 拷贝全部静态资源与极简 Node 服务
COPY . .

# 魔搭创空间强制要求服务监听 0.0.0.0:7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
