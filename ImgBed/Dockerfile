FROM node:24-slim AS builder

# 安装原生模块编译依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY main.js ./
COPY src ./src
COPY static ./static


FROM node:24-bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    libvips \
    libsqlite3-0 && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/main.js ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/static ./static

# 创建数据目录
RUN mkdir -p /app/data/storage

# 暴露端口
EXPOSE 13000

# 启动服务
CMD ["node", "main.js"]
