# openilink-chatroom

微信聊天室 App，基于 OpeniLink Hub App 生态，部署在 Cloudflare Workers + D1。

```
══ #general ══
话题：今天聊什么？
在线：alice、bob
＊ 你加入了房间
```

## 命令

| 命令 | 说明 |
|------|------|
| `/join <房间名>` | 加入或创建房间 |
| `/leave` | 离开当前房间 |
| `/who` | 查看当前房间成员 |
| `/rooms` | 查看所有房间列表 |
| `/nick <昵称>` | 设置昵称 |
| `/topic <内容>` | 设置房间话题 |

## 部署

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create openilink-chatroom
```

将输出的 `database_id` 填入 `wrangler.toml`。

```bash
npx wrangler d1 execute openilink-chatroom --file=migrations/0001_init.sql
```

### 2. 配置环境变量

```bash
# Worker 的公开 URL（部署后填写）
# 在 wrangler.toml 的 [vars] 中修改 WORKER_URL

# 管理后台 Token
npx wrangler secret put ADMIN_TOKEN
```

### 3. 部署 Worker

```bash
npm install
npx wrangler deploy
```

### 4. 部署管理页面（CF Pages）

在 Cloudflare Dashboard → Pages → Create project，连接仓库，构建目录设为 `admin`，无需构建命令。

---

## 在 OpeniLink Hub 注册 App

在 Hub 管理后台 → Apps → Create App，填写：

**基本信息**
- Name: `微信聊天室`
- Slug: `wechat-chatroom`

**Commands**
```json
[
  {"name": "/join",  "description": "加入或创建房间", "usage": "/join <房间名>"},
  {"name": "/leave", "description": "离开当前房间"},
  {"name": "/who",   "description": "查看房间成员"},
  {"name": "/rooms", "description": "查看所有房间"},
  {"name": "/nick",  "description": "设置昵称", "usage": "/nick <昵称>"},
  {"name": "/topic", "description": "设置房间话题", "usage": "/topic <内容>"}
]
```

**Events**
```json
["message.text"]
```

**Scopes**
```json
["messages.send"]
```

**Redirect URL**（关键：带上你的 Hub 地址）
```
https://openilink-chatroom.workers.dev/install?hub=https://your-hub.example.com
```

> 每个 Hub 实例的 `redirect_url` 中 `hub=` 参数需填写对应的 Hub 地址。

---

## 本地开发

```bash
npm install
npx wrangler d1 execute openilink-chatroom --local --file=migrations/0001_init.sql
npx wrangler dev
```

Worker 运行在 `http://localhost:8787`，管理页面直接用浏览器打开 `admin/index.html`。
