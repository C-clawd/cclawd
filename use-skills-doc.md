# OpenClaw Skills 配置指南

本指南帮助新用户配置 OpenClaw 的三个核心 Skills：

- 🧠 **Elite Longterm Memory** - AI 代理记忆系统
- 🔍 **Tavily Search** - AI 优化的网页搜索
- 🌐 **Agent Browser** - 浏览器自动化

## 📋 目录

- [前置条件](#前置条件)
- [Skill 1: Elite Longterm Memory](#skill-1-elite-longterm-memory)
- [Skill 2: Tavily Search](#skill-2-tavily-search)
- [Skill 3: Agent Browser](#skill-3-agent-browser)
- [完整配置示例](#完整配置示例)
- [验证与测试](#验证与测试)
- [常见问题](#常见问题)

---

## 前置条件

### 1. 安装 OpenClaw

```bash
# 安装 OpenClaw
npm install -g openclaw

# 验证安装
openclaw --version
```

### 2. 创建工作目录

```bash
# 创建工作目录
mkdir ~/clawd

# 进入目录
cd ~/clawd
```

### 3. 初始化 OpenClaw

```bash
# 初始化配置
openclaw init
```

---

## Skill 1: Elite Longterm Memory

### 📖 功能介绍

Elite Longterm Memory 是终极 AI 代理记忆系统，提供：

- ✅ 持久化记忆 - 对话压缩或重启后仍能记住信息
- ✅ 语义搜索 - 通过向量搜索快速找到相关记忆
- ✅ 分层存储 - Hot RAM / Warm Store / Cold Store / Archive / Cloud
- ✅ WAL 协议 - 先保存状态，再响应，确保持久性
- ✅ 人类可读 - 直接编辑 SESSION-STATE.md、MEMORY.md

### 🔧 安装步骤

#### 1. 安装 Skill

```bash
# 使用 clawhub 安装
clawhub install elite-longterm-memory

# 或手动克隆到 skills 目录
git clone https://github.com/NextFrontierBuilds/elite-longterm-memory.git ~/clawd/skills/elite-longterm-memory

# 安装依赖
cd ~/clawd/skills/elite-longterm-memory
pnpm install
```

#### 2. 初始化记忆系统

```bash
# 在工作目录下初始化
cd ~/clawd
npx elite-longterm-memory init
```

**预期输出：**

```
🧠 Initializing Elite Longterm Memory...
✓ Created SESSION-STATE.md (Hot RAM)
✓ Created MEMORY.md (Curated Archive)
✓ Created memory/ directory
✓ Created memory/2026-03-03.md

🎉 Elite Longterm Memory initialized!
```

#### 3. 检查状态

```bash
npx elite-longterm-memory status
```

**预期输出：**

```
🧠 Elite Longterm Memory Status

✓ SESSION-STATE.md (0.3KB, modified 2026/3/3 13:51:37)
✓ MEMORY.md (20 lines, 0.4KB)
✓ memory/ (1 daily logs)
• LanceDB not initialized (optional)
```

### 📝 配置文件

#### 1. 配置 `openclaw.json`

在 `~/.openclaw/openclaw.json` 中添加以下配置：

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/clawd",
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "sources": ["memory"],
        "query": {
          "minScore": 0.3,
          "maxResults": 10
        }
      }
    }
  },
  "skills": {
    "load": {
      "extraDirs": ["~/clawd/skills"], // 根据实际安装路径调整
      "watch": true,
      "watchDebounceMs": 250
    },
    "entries": {
      "elite-longterm-memory": {
        "enabled": true
      }
    }
  }
}
```

#### 2. 配置环境变量

创建或编辑 `~/.openclaw/.env` 文件：

```bash
# OpenAI或Gemini或Voyage API Key（必需）
OPENAI_API_KEY=your-openai-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here
VOYAGE_API_KEY=your-voyage-api-key-here

```

**获取 OpenAI API Key：**

1. 访问 https://platform.openai.com/api-keys
2. 登录并创建新的 API Key
3. 复制 API Key 到 `.env` 文件

### 🎯 使用方法

#### 命令行操作

```bash
# 查看状态
npx elite-longterm-memory status

# 创建今日日志
npx elite-longterm-memory today

# 查看帮助
npx elite-longterm-memory help
```

#### 文件位置

| 文件             | 路径                       | 用途                     |
| ---------------- | -------------------------- | ------------------------ |
| SESSION-STATE.md | `~/clawd/SESSION-STATE.md` | 当前活动上下文（热存储） |
| MEMORY.md        | `~/clawd/MEMORY.md`        | 精选的长期记忆           |
| memory/          | `~/clawd/memory/`          | 每日日志目录             |

#### 对话测试

在 OpenClaw Agent 对话中说：

```
记住我偏好使用 React 和 TypeScript 开发前端项目
```

期待 AI 响应：

```
好的，我会记住你偏好使用 React 和 TypeScript 开发前端项目
```

---

## Skill 2: Tavily Search

### 📖 功能介绍

Tavily Search 是通过 Tavily API 进行 AI 优化的网页搜索工具：

- ✅ AI 优化的搜索结果
- ✅ 支持多种搜索模式（普通、深度、新闻）
- ✅ 自动提取网页内容
- ✅ 返回相关链接和摘要

### 🔧 安装步骤

#### 1. 安装 Skill

````bash
# 使用 clawhub 安装
clawhub install tavily-search

# 或手动克隆
git clone https://github.com/clawd/skill-tavily.git ~/clawd/skills/tavily-search


#### 2. 获取 API Key

1. 访问 https://tavily.com
2. 注册账号并登录
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制 API Key

### 📝 配置文件

#### 配置 `openclaw.json`

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "skills": {
    "entries": {
      "tavily": {
        "enabled": true,
        "apiKey": "tvly-your-api-key-here"
      }
    }
  }
}
````

#### 配置环境变量（可选）

在 `~/.openclaw/.env` 文件中添加：

```bash
# Tavily API Key
TAVILY_API_KEY=tvly-your-api-key-here
```

### 🎯 使用方法

#### 命令行测试

```bash
# 基本搜索
node ~/clawd/skills/tavily-search/scripts/search.mjs "your query"

# 指定结果数量
node ~/clawd/skills/tavily-search/scripts/search.mjs "your query" -n 10

# 深度搜索
node ~/clawd/skills/tavily-search/scripts/search.mjs "your query" --deep

# 新闻搜索（最近 7 天）
node ~/clawd/skills/tavily-search/scripts/search.mjs "your query" --topic news

# 新闻搜索（指定天数）
node ~/clawd/skills/tavily-search/scripts/search.mjs "your query" --topic news --days 2
```

#### 提取网页内容

```bash
# 提取单个 URL
node ~/clawd/skills/tavily-search/scripts/extract.mjs "https://example.com"

# 提取多个 URL
node ~/clawd/skills/tavily-search/scripts/extract.mjs "url1" "url2" "url3"
```

#### 对话测试

在 OpenClaw Agent 对话中说：

```
帮我搜索最新的 AI 新闻
```

或

```
查询一下 Python 最佳实践
```

---

## Skill 3: Agent Browser

### 📖 功能介绍

Agent Browser 是快速 Rust-based 无头浏览器自动化 CLI，支持：

- ✅ 导航、点击、输入和页面快照
- ✅ Rust + Node.js 回退
- ✅ 结构化命令
- ✅ 适用于 AI 代理

### 🔧 安装步骤

#### 1. 安装 Skill

````bash
# 使用 clawhub 安装
clawhub install agent-browser

# 或手动克隆
git clone https://github.com/clawd/skill-agent-browser.git ~/clawd/skills/agent-browser

#### 2. 验证安装

```bash
# 检查 Skill 状态
openclaw skills list
````

**预期输出：**

```
│ ✓ ready   │ 📦 Agent Browser  │ openclaw-workspace
```

### 🎯 使用方法

Agent Browser 会在需要浏览器自动化时被自动调用，无需手动触发。

**示例场景：**

- 打开网页并截图
- 填写表单
- 点击按钮
- 提取页面信息

在 OpenClaw Agent 对话中说：

```
帮我打开 example.com 并截个图
```

或

```
帮我登录这个网站并截图
```

---

## 完整配置示例

### `~/.openclaw/openclaw.json`

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "zai/glm-4.7"
      },
      "models": {
        "openai/gpt-5": {},
        "zai/glm-4.7": {
          "alias": "GLM"
        }
      },
      "workspace": "~/clawd",
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "sources": ["memory"],
        "query": {
          "minScore": 0.3,
          "maxResults": 10
        }
      }
    }
  },
  "skills": {
    "load": {
      "extraDirs": ["~/clawd/skills"],
      "watch": true,
      "watchDebounceMs": 250
    },
    "install": {
      "nodeManager": "pnpm"
    },
    "entries": {
      "tavily": {
        "enabled": true,
        "apiKey": "tvly-your-api-key-here"
      },
      "elite-longterm-memory": {
        "enabled": true
      }
    }
  }
}
```

### `~/.openclaw/.env`

```bash
# OpenAI或Gemini或Voyage API Key（必需）
OPENAI_API_KEY=your-openai-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here
VOYAGE_API_KEY=your-voyage-api-key-here

# Tavily API Key（可选，也可在 openclaw.json 中配置）
TAVILY_API_KEY=tvly-your-api-key-here
```

---

## 验证与测试

### 1. 检查 Skills 状态

```bash
openclaw skills list
```

**预期输出：**

```
│ ✓ ready   │ 📦 Agent Browser  │ openclaw-workspace
│ ✓ ready   │ 🧠 elite-longterm-memory │ openclaw-workspace
│ ✓ ready   │ 📦 tavily         │ openclaw-workspace
```

### 2. 检查 Gateway 状态

```bash
openclaw gateway status
```

### 3. 启动 Gateway

```bash
openclaw gateway
```

### 4. 打开你的聊天工具

```
如：飞书AI机器人
```

### 5. 测试每个 Skill

#### 测试 Elite Longterm Memory

**发送消息：**

```
记住我偏好使用 React 开发
```

**期待响应：**

```
好的，我会记住你偏好使用 React 开发
```

**验证文件：**

```bash
cat ~/clawd/SESSION-STATE.md
```

#### 测试 Tavily Search

**发送消息：**

```
帮我搜索最新的 AI 新闻
```

**期待响应：**

```
以下是最新的 AI 新闻...
```

#### 测试 Agent Browser

**发送消息：**

```
帮我打开 example.com 并截个图
```

**期待响应：**

```
正在打开 example.com...
```

---

## 常见问题

### Q1: `openclaw skills list` 显示 skill 为 `missing`？

**原因：** 配置文件错误或依赖未安装。

**解决方法：**

1. 检查配置文件格式是否正确
2. 检查 `skills.load.extraDirs` 路径是否正确，根据实际安装路径调整
3. 重新安装依赖：
   ```bash
   cd ~/clawd/skills/skill-name
   pnpm install
   ```

### Q2: Elite Longterm Memory 不自动写入？

**原因：** `memorySearch` 未启用或配置错误。

**解决方法：**

1. 检查 `openclaw.json` 中的 `memorySearch` 配置
2. 确保 `OPENAI_API_KEY` 已在 `.env` 文件中设置
3. 重启 Gateway：
   ```bash
   openclaw gateway restart
   ```

### Q3: Tavily Search 提示 API Key 错误？

**原因：** API Key 未配置或无效。

**解决方法：**

1. 检查 `openclaw.json` 中的 `apiKey` 字段
2. 或检查 `.env` 文件中的 `TAVILY_API_KEY`
3. 验证 API Key 是否有效：访问 https://tavily.com

### Q4: Gateway 无法启动？

**原因：** 端口被占用或配置文件错误。

**解决方法：**

1. 检查端口是否被占用：

   ```bash
   netstat -ano | findstr :18789
   ```

2. 如果端口被占用，停止进程或使用其他端口

3. 检查配置文件：
   ```bash
   openclaw doctor
   ```

### Q5: 配置文件验证失败？

**原因：** JSON 格式错误或字段名错误。

**解决方法：**

1. 使用 JSON 验证工具检查格式
2. 检查字段名是否正确（区分大小写）
3. 运行：
   ```bash
   openclaw doctor --fix
   ```

### Q6: 记忆文件未更新？

**原因：** Gateway 需要重启或配置未生效。

**解决方法：**

1. 重启 Gateway：

   ```bash
   openclaw gateway restart
   ```

2. 检查 Gateway 日志：

   ```bash
   openclaw gateway logs
   ```

3. 验证配置：
   ```bash
   openclaw config show
   ```

---

## 📚 参考资源

### 官方文档

- OpenClaw 文档: https://docs.openclaw.ai
- ClawHub: https://clawhub.ai

### Skill 仓库

- Elite Longterm Memory: https://github.com/NextFrontierBuilds/elite-longterm-memory
- Tavily Search: https://github.com/clawd/skill-tavily
- Agent Browser: https://github.com/clawd/skill-agent-browser

### API 服务

- OpenAI: https://platform.openai.com
- Gemini: https://ai.google.dev
- Voyage: https://www.voyageai.com
- Tavily: https://tavily.com

---

## 🎊 总结

完成以上配置后，您将拥有：

✅ **Elite Longterm Memory** - AI 代理记忆系统  
✅ **Tavily Search** - AI 优化的网页搜索  
✅ **Agent Browser** - 浏览器自动化

所有 Skills 都将显示为 `✓ ready` 状态，可以开始使用了！

祝您使用愉快！🚀
