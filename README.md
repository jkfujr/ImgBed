# ImgBed

一个基于 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 重构的自用图床程序, 移除 CloudFlare 部署, 重写了前端。

---

## 快速开始

### Docker 部署（推荐）

```bash
docker pull ghcr.io/jkfujr/imgbed:latest

docker run -d \
  --name imgbed \
  -p 13000:13000 \
  -v $(pwd)/data:/app/data \
  ghcr.io/jkfujr/imgbed:latest
```

访问 `http://localhost:13000`，使用默认账号：
- 用户名: `admin`
- 密码: `admin`

### 源码部署

#### 要求

- Node.js >= v24.11.0

#### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/jkfujr/ImgBed.git
cd ImgBed

# 2. 构建前端
cd ImgBed-web
npm install
npm run build
cp -r dist/* ../ImgBed/static/

# 3. 启动后端
cd ../ImgBed
npm install
npm start
# 服务运行在 http://localhost:13000
```

访问 `http://localhost:13000`，使用默认账号：
- 用户名: `admin`
- 密码: `admin`
---

## 感谢

[https://github.com/MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)