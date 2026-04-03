# ImgBed

基于 [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 重构的自用图床。

## 项目简介

项目用于完成图片的上传、管理、分类、存储通道配置与直链访问，适合用于个人或私有化部署场景。

## 项目结构

- `/ImgBed`：后端服务，提供认证、文件管理、上传、目录管理、存储通道、系统配置和图片直链访问等能力
- `/ImgBed-web`：前端管理端，提供登录、图片管理、目录管理、存储通道管理和系统设置等页面

## 功能特性

- 登录认证与管理员后台
- 图片上传与文件管理
- 目录管理与分类整理
- 存储通道管理与切换
- 系统参数配置
- 图片直链访问

## 安装

### 后端

```bash
cd /ImgBed
npm install
```

### 前端

```bash
cd /ImgBed-web
npm install
```

## 启动

### 后端开发模式

```bash
cd /ImgBed
npm run dev
```

### 后端生产启动

```bash
cd /ImgBed
npm start
```

### 前端开发模式

```bash
cd /ImgBed-web
npm run dev
```

### 前端打包

```bash
cd /ImgBed-web
npm run build
```

前端开发模式下会自动将 `/api` 和图片直链请求代理到后端服务。

## 配置

后端配置文件位于 `//config.json`，常用配置项如下：

- `server`：服务端口与主机地址
- `database`：数据库文件路径
- `jwt`：登录令牌有效期与密钥
- `admin`：默认管理员账号密码
- `storage`：默认存储通道、上传通道和存储策略
- `security`：跨域来源与文件大小限制

## 技术栈

- 前端：React、Vite、React Router、MUI、Axios
- 后端：Node.js、Hono、better-sqlite3、Kysely、jose、sharp

## 致谢

感谢 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)
