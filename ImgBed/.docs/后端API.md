# 后端 API 文档

## 文档概览

本文档描述 ImgBed 图床系统后端 API 的完整接口规范。

- **框架**: Hono (Node.js)
- **数据库**: SQLite (通过 Kysely ORM)
- **鉴权方式**: JWT Bearer Token
- **基础路径**: `/` (根路径)

## 通用约定

### 基础地址

开发环境默认: `http://localhost:3000`

生产环境根据部署配置而定。

### 统一响应结构

所有 JSON 响应遵循以下格式：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "error": {}
}
```

- `code`: 业务状态码，`0` 表示成功，非 `0` 表示失败
- `message`: 响应消息描述
- `data`: 成功时返回的数据对象
- `error`: 失败时返回的错误详情

### 鉴权方式

受保护的接口需要在请求头中携带 JWT Token：

```
Authorization: Bearer <token>
```

Token 通过 `/api/auth/login` 接口获取。中间件会验证 Token 的有效性及 `role` 字段是否为 `admin`。

未授权或 Token 无效时返回：

```json
{
  "code": 401,
  "message": "未授权：缺失有效的 Bearer Token",
  "error": {}
}
```

### CORS 配置

全局 CORS 配置来自 `config.security.corsOrigin`，默认为 `*`。

### 上传大小限制

默认最大上传文件大小为 `100MB`，可通过 `config.security.maxFileSize` 配置（单位：字节）。

### 常见错误码

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 请求成功 |
| 206 | 部分内容（Range 请求） |
| 400 | 请求参数错误 |
| 401 | 未授权或 Token 无效 |
| 403 | 禁止访问（如容量超限、防盗链拦截） |
| 404 | 资源不存在 |
| 409 | 冲突（如重名） |
| 413 | 文件过大 |
| 500 | 服务器内部错误 |
| 501 | 功能未实现 |
| 502 | 上游节点错误 |

---

## 认证接口 `/api/auth`

### 1. 登录

**接口**: `POST /api/auth/login`

**鉴权**: 否

**请求头**: `Content-Type: application/json`

**请求体**:

```json
{
  "username": "admin",
  "password": "admin"
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "username": "admin",
    "role": "admin"
  }
}
```

**失败响应** (401):

```json
{
  "code": 401,
  "message": "用户名或密码不正确",
  "error": {}
}
```

**行为说明**:

- 密码优先从数据库 `system_settings` 表的 `admin_password` 键读取，若不存在则使用 `config.admin.password`
- JWT 有效期默认 7 天（`config.jwt.expiresIn`）
- 载荷包含 `role`、`username`、`loginAt` 字段

---

### 2. 获取当前用户信息

**接口**: `GET /api/auth/me`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "获取成功",
  "data": {
    "username": "admin",
    "role": "admin"
  }
}
```

---

### 3. 登出

**接口**: `POST /api/auth/logout`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "登出成功",
  "data": {}
}
```

**行为说明**:

- JWT 本身无状态，实际登出由前端清除 Token 实现
- 此接口仅作为语义化端点

---

### 4. 修改管理员密码

**接口**: `PUT /api/auth/password`

**鉴权**: 是

**请求体**:

```json
{
  "newPassword": "newpassword123"
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "密码修改成功",
  "data": {}
}
```

**失败响应** (400):

```json
{
  "code": 400,
  "message": "新密码不能为空且长度不能少于6位",
  "error": {}
}
```

**行为说明**:

- 新密码写入数据库 `system_settings` 表，覆盖 `config.json` 中的密码
- 最小长度 6 位

---

## 上传接口 `/api/upload`

### 1. 上传文件

**接口**: `POST /api/upload`

**鉴权**: 是

**请求头**: `Content-Type: multipart/form-data`

**FormData 参数**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 上传的文件对象 |
| channel | String | 否 | 指定存储渠道 ID，不指定则使用负载均衡或默认渠道 |
| preferredType | String | 否 | 偏好的存储类型（用于负载均衡） |
| directory | String | 否 | 文件所属目录，默认 `/` |
| tags | String | 否 | 标签，逗号分隔 |
| is_public | Boolean/String | 否 | 是否公开，默认 `false` |

**成功响应** (200):

```json
{
  "code": 0,
  "message": "文件上传成功",
  "data": {
    "id": "a1b2c3d4e5f6_example.jpg",
    "url": "/a1b2c3d4e5f6_example.jpg",
    "file_name": "a1b2c3d4e5f6_example.jpg",
    "original_name": "example.jpg",
    "size": 102400
  }
}
```

**失败响应**:

- 400: 未检测到文件、非法文件格式
- 403: 渠道容量已达停用阈值
- 413: 文件体积超出限制
- 500: 底层存储失败

**行为说明**:

- 仅支持图片类型：`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`
- 文件 ID 由 SHA1 哈希前 12 位 + 清洗后的原文件名 + 扩展名组成
- 支持容量检查模式：
  - `auto`（默认）：使用内存缓存快速检查
  - `always`：每次上传全量统计数据库
- 返回的 `url` 为相对路径，可直接访问 `GET /:id`

---

## 文件管理接口 `/api/files`

所有接口均需管理员鉴权。

### 1. 获取文件列表

**接口**: `GET /api/files`

**鉴权**: 是

**Query 参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | Number | 否 | 页码，默认 1 |
| pageSize | Number | 否 | 每页数量，默认 20 |
| directory | String | 否 | 按目录筛选 |
| search | String | 否 | 文件名关键词搜索 |

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "id": "a1b2c3d4e5f6_example.jpg",
        "file_name": "a1b2c3d4e5f6_example.jpg",
        "original_name": "example.jpg",
        "mime_type": "image/jpeg",
        "size": 102400,
        "storage_channel": "local",
        "directory": "/",
        "created_at": "2026-04-01T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

---

### 2. 获取文件详情

**接口**: `GET /api/files/:id`

**鉴权**: 是

**Path 参数**: `id` - 文件 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "a1b2c3d4e5f6_example.jpg",
    "file_name": "a1b2c3d4e5f6_example.jpg",
    "original_name": "example.jpg",
    "mime_type": "image/jpeg",
    "size": 102400,
    "storage_channel": "local",
    "directory": "/",
    "created_at": "2026-04-01T10:00:00.000Z"
  }
}
```

**失败响应** (404):

```json
{
  "code": 404,
  "message": "抱歉，指定的文件未找到",
  "error": {}
}
```

---

### 3. 修改文件属性

**接口**: `PUT /api/files/:id`

**鉴权**: 是

**Path 参数**: `id` - 文件 ID

**请求体**:

```json
{
  "file_name": "new_name.jpg",
  "directory": "/photos",
  "is_public": true
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "文件部分信息更新已完成",
  "data": {
    "id": "a1b2c3d4e5f6_example.jpg",
    "file_name": "new_name.jpg"
  }
}
```

---

### 4. 删除文件

**接口**: `DELETE /api/files/:id`

**鉴权**: 是

**Path 参数**: `id` - 文件 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "执行单体删除扫尾动作结束",
  "data": {
    "id": "a1b2c3d4e5f6_example.jpg"
  }
}
```

**行为说明**:

- 会尝试删除底层存储的物理文件
- 底层删除失败时仍会清理数据库记录
- 自动更新渠道容量缓存

---

### 5. 批量操作

**接口**: `POST /api/files/batch`

**鉴权**: 是

**支持的操作**: `delete`、`move`、`migrate`

#### 5.1 批量删除

**请求体**:

```json
{
  "action": "delete",
  "ids": ["file1", "file2"]
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "完毕，已成功清除 2 份上传档案",
  "data": {
    "deleted": 2
  }
}
```

---

#### 5.2 批量移动目录

**请求体**:

```json
{
  "action": "move",
  "ids": ["file1", "file2"],
  "target_directory": "/photos"
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "移库完成，已将 2 宗物品改签至 /photos",
  "data": {}
}
```

---

#### 5.3 批量迁移存储渠道

**请求体**:

```json
{
  "action": "migrate",
  "ids": ["file1", "file2"],
  "target_channel": "s3-1"
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "迁移完成：成功 2，失败 0，跳过 0",
  "data": {
    "total": 2,
    "success": 2,
    "failed": 0,
    "skipped": 0,
    "errors": []
  }
}
```

**行为说明**:

- 仅支持迁移到 `local`、`s3`、`huggingface` 类型
- 目标渠道必须启用且允许上传
- 迁移失败不会删除源文件

---

## 目录管理接口 `/api/directories`

所有接口均需管理员鉴权。

### 1. 获取目录树

**接口**: `GET /api/directories`

**鉴权**: 是

**Query 参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | String | 否 | `flat` 返回平层数组，否则返回树形结构 |

**成功响应** (200) - 树形:

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "photos",
      "path": "/photos",
      "parent_id": null,
      "children": [
        {
          "id": 2,
          "name": "2024",
          "path": "/photos/2024",
          "parent_id": 1,
          "children": []
        }
      ]
    }
  ]
}
```

**成功响应** (200) - 平层 (`type=flat`):

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "photos",
      "path": "/photos",
      "parent_id": null
    },
    {
      "id": 2,
      "name": "2024",
      "path": "/photos/2024",
      "parent_id": 1
    }
  ]
}
```

---

### 2. 创建目录

**接口**: `POST /api/directories`

**鉴权**: 是

**请求体**:

```json
{
  "name": "photos",
  "parent_id": null
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "创建成功",
  "data": {
    "id": 1,
    "name": "photos",
    "path": "/photos",
    "parent_id": null
  }
}
```

**失败响应**:

- 400: 目录名称不能为空
- 404: 指定的父级目录不存在
- 409: 该层级下同名目录已存在

---

### 3. 修改目录

**接口**: `PUT /api/directories/:id`

**鉴权**: 是

**Path 参数**: `id` - 目录 ID

**请求体**:

```json
{
  "name": "new_name"
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "变更已应用",
  "data": {
    "id": 1,
    "name": "new_name",
    "path": "/new_name"
  }
}
```

**行为说明**:

- 重命名会级联更新所有子目录的 `path`
- 会同步更新该目录下所有文件的 `directory` 字段

---

### 4. 删除目录

**接口**: `DELETE /api/directories/:id`

**鉴权**: 是

**Path 参数**: `id` - 目录 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "安全移除完成",
  "data": {}
}
```

**失败响应**:

- 403: 目录下仍有文件或子目录

**行为说明**:

- 删除前必须确保目录下无文件且无子目录

---

## 系统配置接口 `/api/system`

所有接口均需管理员鉴权。

### 1. 读取系统配置

**接口**: `GET /api/system/config`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "server": {
      "port": 3000,
      "host": "0.0.0.0"
    },
    "jwt": {
      "secret": "******",
      "expiresIn": "7d"
    },
    "security": {
      "corsOrigin": "*",
      "maxFileSize": 104857600
    },
    "storage": {
      "default": "local-1"
    }
  }
}
```

**行为说明**:

- `jwt.secret` 字段已脱敏

---

### 2. 更新系统配置

**接口**: `PUT /api/system/config`

**鉴权**: 是

**请求体**:

```json
{
  "server": {
    "port": 3001
  },
  "security": {
    "corsOrigin": "https://example.com",
    "maxFileSize": 209715200
  },
  "storage": {
    "default": "s3-1"
  },
  "upload": {
    "quotaCheckMode": "auto",
    "fullCheckIntervalHours": 6
  }
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "配置已保存，部分配置需重启服务后生效"
}
```

**行为说明**:

- 仅允许修改 `server.port`、`security.*`、`storage.default`、`upload.*`
- 部分配置需重启服务生效

---

### 3. 获取存储渠道列表

**接口**: `GET /api/system/storages`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "id": "local-1",
        "type": "local",
        "name": "Local Storage",
        "enabled": true,
        "allowUpload": true,
        "weight": 1,
        "quotaLimitGB": null,
        "usedBytes": 1048576,
        "config": {
          "basePath": "./data/storage"
        }
      }
    ],
    "default": "local-1"
  }
}
```

**行为说明**:

- 敏感字段（`botToken`、`secretAccessKey` 等）已脱敏为 `***`

---

### 4. 获取存储渠道统计

**接口**: `GET /api/system/storages/stats`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 3,
    "enabled": 2,
    "allowUpload": 2,
    "byType": {
      "local": 1,
      "s3": 1,
      "telegram": 1
    }
  }
}
```

---

### 5. 测试存储渠道连接

**接口**: `POST /api/system/storages/test`

**鉴权**: 是

**请求体**:

```json
{
  "type": "s3",
  "config": {
    "endpoint": "https://s3.amazonaws.com",
    "region": "us-east-1",
    "bucket": "my-bucket",
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  }
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "连接成功",
  "data": {
    "ok": true
  }
}
```

**失败响应** (400):

```json
{
  "code": 400,
  "message": "连接失败原因"
}
```

---

### 6. 获取负载均衡配置

**接口**: `GET /api/system/load-balance`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "strategy": "default",
    "scope": "global",
    "enabledTypes": [],
    "weights": {},
    "stats": {}
  }
}
```

---

### 7. 更新负载均衡配置

**接口**: `PUT /api/system/load-balance`

**鉴权**: 是

**请求体**:

```json
{
  "strategy": "weighted",
  "scope": "global",
  "enabledTypes": ["local", "s3"],
  "weights": {
    "local-1": 2,
    "s3-1": 1
  }
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "负载均衡配置已更新"
}
```

**支持的策略**: `default`、`round-robin`、`random`、`least-used`、`weighted`

---

### 8. 新增存储渠道

**接口**: `POST /api/system/storages`

**鉴权**: 是

**请求体**:

```json
{
  "id": "s3-1",
  "type": "s3",
  "name": "AWS S3",
  "enabled": true,
  "allowUpload": true,
  "weight": 1,
  "enableQuota": true,
  "quotaLimitGB": 100,
  "disableThresholdPercent": 95,
  "config": {
    "endpoint": "https://s3.amazonaws.com",
    "region": "us-east-1",
    "bucket": "my-bucket",
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  }
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "存储渠道已新增",
  "data": {
    "id": "s3-1",
    "type": "s3",
    "name": "AWS S3",
    "enabled": true
  }
}
```

**失败响应**:

- 400: ID 不合法、type 不合法、name 为空、ID 已存在

**行为说明**:

- `id` 仅允许字母、数字、连字符
- 支持的 `type`: `local`、`s3`、`telegram`、`discord`、`huggingface`、`external`
- `enableQuota` 为 `false` 时 `quotaLimitGB` 存储为 `null`（不限制）

---

### 9. 编辑存储渠道

**接口**: `PUT /api/system/storages/:id`

**鉴权**: 是

**Path 参数**: `id` - 渠道 ID

**请求体**:

```json
{
  "name": "New Name",
  "enabled": true,
  "allowUpload": false,
  "weight": 2,
  "enableQuota": true,
  "quotaLimitGB": 50,
  "config": {
    "endpoint": "https://new-endpoint.com"
  }
}
```

**成功响应** (200):

```json
{
  "code": 0,
  "message": "存储渠道已更新",
  "data": {
    "id": "s3-1",
    "name": "New Name"
  }
}
```

**行为说明**:

- 敏感字段值为 `null` 时不覆盖（前端留空表示不修改）

---

### 10. 删除存储渠道

**接口**: `DELETE /api/system/storages/:id`

**鉴权**: 是

**Path 参数**: `id` - 渠道 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "存储渠道已删除"
}
```

**失败响应**:

- 400: 不能删除当前默认渠道
- 404: 渠道不存在

---

### 11. 设为默认渠道

**接口**: `PUT /api/system/storages/:id/default`

**鉴权**: 是

**Path 参数**: `id` - 渠道 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "已将 \"s3-1\" 设为默认渠道"
}
```

---

### 12. 启用/禁用渠道

**接口**: `PUT /api/system/storages/:id/toggle`

**鉴权**: 是

**Path 参数**: `id` - 渠道 ID

**成功响应** (200):

```json
{
  "code": 0,
  "message": "渠道已启用",
  "data": {
    "enabled": true
  }
}
```

---

### 13. 获取容量统计

**接口**: `GET /api/system/quota-stats`

**鉴权**: 是

**成功响应** (200):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "stats": {
      "local-1": 1048576,
      "s3-1": 2097152
    }
  }
}
```

**行为说明**:

- `auto` 模式：从内存缓存读取
- `always` 模式：全量统计数据库

---

## 公共访问接口

### 1. 获取文件直链

**接口**: `GET /:id`

**鉴权**: 否

**Path 参数**: `id` - 文件 ID

**请求头**:

| 请求头 | 说明 |
|--------|------|
| Range | 可选，支持断点续传（如 `bytes=0-1023`） |
| Referer | 可选，用于防盗链校验 |

**成功响应** (200/206):

返回文件二进制流，响应头包含：

```
Content-Type: image/jpeg
Content-Length: 102400
Content-Disposition: inline; filename*=UTF-8''example.jpg
Cache-Control: public, max-age=31536000
Accept-Ranges: bytes
```

**206 响应**（Range 请求）:

```
Content-Range: bytes 0-1023/102400
Content-Length: 1024
```

**失败响应** (404):

```json
{
  "code": 404,
  "message": "文件未找到或标识符无效",
  "data": {}
}
```

**失败响应** (403):

```
403 Forbidden
```

**失败响应** (501):

```
Not Implemented Chunk Merge
```

**行为说明**:

- 支持防盗链：检查 `Referer`/`Origin` 是否在 `config.security.allowedDomains` 白名单
- 支持 Range 请求，返回 206 状态码
- 分片文件（`is_chunked=true`）暂未实现，返回 501
- 缓存策略：`max-age=31536000`（1年）

---

## 附录：关键配置项与行为说明

### 配置文件位置

- 主配置：`config.json`
- 数据库：`data/database.sqlite`
- 本地存储：`data/storage/`

### 默认配置

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "admin": {
    "username": "admin",
    "password": "admin"
  },
  "jwt": {
    "expiresIn": "7d"
  },
  "security": {
    "corsOrigin": "*",
    "maxFileSize": 104857600
  },
  "upload": {
    "quotaCheckMode": "auto",
    "fullCheckIntervalHours": 6
  }
}
```

### 容量检查模式

- `auto`（推荐）：使用内存缓存 + 定时全量校正，性能最优
- `always`：每次上传全量统计数据库，精确但慢

### 已知行为与限制

1. **登录密码优先级**：数据库 `system_settings.admin_password` > `config.admin.password`

2. **上传限制**：仅支持图片类型（`.jpg`、`.png`、`.gif`、`.webp`、`.svg`、`.bmp`、`.ico`）

3. **文件 ID 生成**：SHA1 哈希前 12 位 + 清洗后的文件名 + 扩展名

4. **删除行为**：底层存储删除失败时仍会清理数据库记录

5. **迁移限制**：仅支持迁移到 `local`、`s3`、`huggingface` 类型，迁移失败不删除源文件

6. **目录重命名**：会级联更新所有子目录路径和文件 `directory` 字段

7. **配置更新**：部分配置（如 `server.port`）需重启服务生效

8. **分片文件**：`GET /:id` 对 `is_chunked=true` 的文件返回 501

9. **防盗链**：空白名单视为不限制，无 Referer 默认放行

10. **容量统计**：`always` 模式下 `/api/system/quota-stats` 会全量扫描数据库

---

## 文档版本

- 版本：1.0
- 更新日期：2026-04-02
- 基于源码版本：ImgBed v1.0.0

---
