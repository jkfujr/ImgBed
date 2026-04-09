# ImgBed

一个基于 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 重构的自用图床程序, 移除 CloudFlare 部署, 重写了前端。

---

## 快速开始

### 要求

- Node.js >= v24.11.0

### 部署

```bash
# 1. 克隆仓库
git clone https://github.com/jkfujr/ImgBed.git
cd ImgBed

# 2. 安装并启动后端
cd ImgBed
npm install
npm start
# 后端运行在 http://localhost:3000

# 3. 安装并启动前端（新终端）
cd ../ImgBed-web
npm install
npm run dev
# 前端运行在 http://localhost:5173
```

### 登录

访问 `http://localhost:5173/login`，使用默认账号：

- 用户名: `admin`
- 密码: `admin`
---

## 感谢

[https://github.com/MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)