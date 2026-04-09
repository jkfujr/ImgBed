FROM node:24-slim

# 安装必要的系统依赖（sharp 需要）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制后端代码
COPY package*.json ./
RUN npm install --omit=dev

COPY . ./

# 清理构建依赖
RUN apt-get purge -y --auto-remove python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# 创建数据目录
RUN mkdir -p /app/data/storage

# 暴露端口
EXPOSE 13000

# 启动服务
CMD ["node", "main.js"]
