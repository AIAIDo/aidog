# aidog 安全检测模块 — 实现计划 v2

## Context

aidog 目前专注于 Token 消耗监控与优化，缺乏安全维度的检测能力。开发者在使用 AI Agent 过程中面临两个安全风险：
1. **公网暴露**：本机服务端口或内网穿透工具（OpenClaw/ngrok/frp）将内部服务暴露到公网
2. **敏感信息泄漏**：在与 AI 对话过程中无意将密码、密钥、手机号等敏感信息发送给 AI 模型

本计划新增 `src/security/` 模块，并重新组织 Dashboard 侧边栏为分组导航（Token 优化 / 安全检测）。

---

## 一、模块结构

```
src/security/
├── index.js                  # SecurityEngine — 统一入口
├── types.js                  # JSDoc 类型定义
├── leakage/
│   ├── index.js              # LeakageScanner
│   └── rules/
│       ├── index.js           # 内置规则注册表
│       ├── phone.js           # S1 — 手机号
│       ├── id-card.js         # S2 — 身份证号
│       ├── bank-card.js       # S3 — 银行卡号
│       ├── password.js        # S4 — 密码模式
│       ├── server-login.js    # S5 — 服务器登录凭据
│       ├── db-connection.js   # S6 — 数据库连接串
│       ├── api-key.js         # S7 — API Key/Token
│       ├── ip-credential.js   # S8 — IP+凭据组合
│       ├── email.js           # S9 — 邮箱地址
│       └── custom.js          # 从 ~/.aidog/config.json 加载用户自定义规则
└── exposure/
    ├── index.js               # ExposureChecker
    ├── port-scanner.js        # 端口可达性检测 (net.connect)
    ├── process-scanner.js     # 穿透工具进程检测
    └── public-ip.js           # 公网 IP 获取

src/cli/commands/security.js   # aidog sec 命令
src/server/routes/security.js  # /api/security/* API
src/web/src/pages/Security.jsx # 安全检测页面（含内部 Tab）
src/web/src/pages/security/
├── SecurityOverview.jsx       # 扫描概览
├── ExposureScan.jsx           # 暴露检测结果
├── LeakageScan.jsx            # 泄露扫描结果
└── SecurityRules.jsx          # 规则列表
```

---

## 二、接入拓扑 — serve.js 与 createServer 唯一入口

### 现状问题

当前存在**两套 HTTP 服务实现**：
- `src/cli/commands/serve.js` (line 25-353)：`aidog serve` 实际走的入口，自建 express app + 内联路由
- `src/server/index.js` (line 28-183)：`createServer()` 工厂函数，引用了模块化路由，但**未被 serve.js 使用**

### 方案：在 serve.js 中直接注入 security 路由

Phase 1（本次实施）：在 `serve.js` 中直接注入 security 路由，与现有内联路由风格保持一致，不做架构大改。

```js
// serve.js 中新增（在 app.get('/api/plugins', ...) 之后）
const { SecurityEngine } = await import('../../security/index.js');
const securityEngine = new SecurityEngine({ storage, pluginRegistry: registry });
app.set('securityEngine', securityEngine);
const securityRouter = (await import('../../server/routes/security.js')).default;
app.use('/api/security', securityRouter);
```

同时在 `server/index.js` 的 `createServer()` 中也注册同一份 securityRouter，保证两个入口行为一致。

Phase 2（后续重构，不在本次范围）：将 serve.js 的内联路由全部迁移到 `src/server/routes/`，统一使用 `createServer()`。本次只加 `// TODO: migrate to createServer()` 注释。

---

## 三、数据源策略 — 统一走 PluginRegistry

### 现状问题

方案 v1 硬编码 `~/.claude/projects/**/*.jsonl`，与 aidog "跨 Agent" 定位不一致。`PluginRegistry` (registry.js:17-21) 已注册 Claude Code + Aider + OpenCode 三个插件。

### 方案：通过 PluginRegistry 获取数据源

```js
class SecurityEngine {
  constructor({ storage, pluginRegistry, customRules }) {
    this.pluginRegistry = pluginRegistry;
    this.leakageScanner = new LeakageScanner({ customRules });
    this.exposureChecker = new ExposureChecker();
  }

  async scanLeakage(options = {}) {
    const plugins = await this.pluginRegistry.getAvailable();
    const allPaths = [];
    for (const plugin of plugins) {
      if (typeof plugin.getDataPaths === 'function') {
        const paths = await plugin.getDataPaths(options.since);
        allPaths.push(...paths);
      }
    }
    return this.leakageScanner.scan(allPaths, options);
  }
}
```

### AgentPlugin 接口扩展

在 `src/plugins/interface.js` 中新增**可选方法**：

```js
/** @property {(since?: Date) => Promise<string[]>} [getDataPaths] - 返回原始数据文件路径列表 */
```

### 阶段划分

- **Phase 1（本次）**：Claude Code 插件实现 `getDataPaths()`（复用现有 `#findJSONLFiles()`），LeakageScanner 支持 JSONL 格式
- **Phase 2（后续）**：Aider/OpenCode 插件各自实现 `getDataPaths()` + 对应格式解析器

---

## 四、严重级别体系对齐

### 现状问题

`Severity` 类型（types.js:19）只有 `"high" | "medium" | "low"`，formatSeverity（formatters/index.js:120-131）也只处理这三级。

### 方案：扩展现有体系

**扩展 `src/types.js`**：
```js
/** @typedef {"critical" | "high" | "medium" | "low"} Severity */
```

**扩展 `formatSeverity()`**：
```js
case 'critical':
  return chalk.red.bold('🔴 严重');
```

**影响评估**：现有 R1-R15 规则最高为 `"high"`，不受影响。存量代码中 `switch(severity)` 的 `default` 分支已覆盖未知值，向后兼容。`"critical"` 仅用于安全模块中需立即处理的发现（身份证/银行卡/数据库连接串明文泄漏）。

---

## 五、内置敏感信息规则 (S1-S9)

| ID | 名称 | 严重级别 | 正则示例 | 脱敏示例 |
|----|------|----------|----------|----------|
| S1 | 手机号 | medium | `1[3-9]\d{9}` | `138****1234` |
| S2 | 身份证号 | critical | `\d{17}[\dXx]` + 校验位验证 | `110101****0011` |
| S3 | 银行卡号 | critical | `[3-6]\d{15,18}` + Luhn 校验 | `6222****1234` |
| S4 | 密码模式 | high | `password\|passwd\|pwd\s*[=:]\s*\S+` | `password=****` |
| S5 | 服务器登录 | high | `ssh\s+\w+@`, `mysql\s+-u\s*\S+\s+-p` | `ssh ****@host` |
| S6 | 数据库连接串 | critical | `mysql\|postgres\|mongodb://[^:]+:[^@]+@` | `mysql://user:****@host` |
| S7 | API Key | high | `sk-[a-zA-Z0-9]{20+}`, `ghp_`, `AKIA`, `glpat-` | `sk-...xxxx` |
| S8 | IP+凭据 | high | `\d+\.\d+\.\d+\.\d+.*pwd=` | `192.168.*.*...pwd=****` |
| S9 | 邮箱 | low | 标准邮箱正则 | `u***@domain.com` |

**自定义规则** 配置在 `~/.aidog/config.json` 的 `security.customRules` 下。自定义规则加载时 try/catch 包裹 `new RegExp()`，无效正则跳过并打印 warning。

---

## 六、安全与权限

### 6.1 触发权限

| 操作 | 触发方式 | 权限控制 |
|------|----------|----------|
| 暴露检测 | CLI 或 Dashboard 手动触发 | 仅 localhost 可触发 |
| 泄漏扫描 | CLI 或 Dashboard 手动触发 | 同上 |
| 定时扫描 | 不自动运行 | 安全扫描仅手动触发，不加入 AnalysisScheduler |

### 6.2 CORS 策略

现有 server/index.js:44 CORS 为 `*`，新增写操作需收紧：

```js
function localhostOnly(req, res, next) {
  const remoteIp = req.ip || req.connection.remoteAddress;
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIp);
  if (!isLocal) {
    return res.status(403).json({ error: 'Security scan can only be triggered from localhost' });
  }
  next();
}
// 应用到 POST /scan/trigger
router.post('/scan/trigger', localhostOnly, handler);
```

### 6.3 速率限制

```js
let lastScanTime = 0;
const MIN_SCAN_INTERVAL = 30_000; // 30 秒

router.post('/scan/trigger', localhostOnly, async (req, res) => {
  const now = Date.now();
  if (now - lastScanTime < MIN_SCAN_INTERVAL) {
    return res.status(429).json({ error: 'Scan rate limited', retryAfterMs: MIN_SCAN_INTERVAL - (now - lastScanTime) });
  }
  lastScanTime = now;
  // ...
});
```

### 6.4 返回字段脱敏边界

| 字段 | 存储 | API 返回 | 原则 |
|------|------|----------|------|
| masked_snippet | 脱敏后 | 脱敏后 | 永远不存原始值 |
| context | 脱敏后 | 脱敏后 | 敏感部分也做替换 |
| tunnel_command | 脱敏后 | 脱敏后 | 去除 --authtoken 等值 |
| file_path | 完整路径 | 完整路径 | 本地工具，路径不敏感 |
| public_ip | 存储 | 返回 | 用户需要知道 |

脱敏在 LeakageScanner.scanRecord() 阶段完成，写入 Finding 时已脱敏。

### 6.5 审计日志

每次扫描触发记录到 `security_scans` 表，含 `trigger_source`（cli/api）字段。

---

## 七、SQLite Schema 扩展

在 `src/storage/schema.sql` 末尾追加：

```sql
CREATE TABLE IF NOT EXISTS security_scans (
  id              TEXT PRIMARY KEY,
  scan_type       TEXT NOT NULL,          -- 'full' | 'leakage' | 'exposure'
  trigger_source  TEXT DEFAULT 'cli',     -- 'cli' | 'api'
  scanned_at      INTEGER NOT NULL,
  public_ip       TEXT,
  files_scanned   INTEGER DEFAULT 0,
  lines_scanned   INTEGER DEFAULT 0,
  total_findings  INTEGER DEFAULT 0,
  security_score  TEXT,                   -- SecurityHealthScore JSON
  scan_cursor     TEXT,                   -- JSON: 增量游标
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_findings (
  id              TEXT PRIMARY KEY,
  scan_id         TEXT NOT NULL,
  category        TEXT NOT NULL,          -- 'leakage' | 'exposure'
  rule_id         TEXT NOT NULL,
  rule_name       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  source          TEXT,
  session_id      TEXT,
  message_id      TEXT,
  line_number     INTEGER,
  masked_snippet  TEXT,
  context         TEXT,
  file_path       TEXT,
  port            INTEGER,
  service         TEXT,
  public_ip       TEXT,
  reachable       INTEGER,
  remediation     TEXT,
  tunnel_tool     TEXT,
  tunnel_pid      INTEGER,
  tunnel_command  TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES security_scans(id)
);

-- 去重索引：同一文件+行号+规则 = 同一个 finding
CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_dedup
  ON security_findings(file_path, line_number, rule_id)
  WHERE category = 'leakage';

CREATE INDEX IF NOT EXISTS idx_sf_scan ON security_findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_sf_rule ON security_findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_sf_severity ON security_findings(severity);
```

---

## 八、增量与幂等策略

### 8.1 增量扫描游标

```js
/** @typedef {{ filePath: string, lastOffset: number, lastMtime: number }} ScanCursor */
```

扫描流程：
1. 获取上次 `security_scans.scan_cursor` JSON
2. 对每个文件比较 `mtime`：未变 → 跳过；已变 → 从 `lastOffset` 开始读取新增部分
3. 新文件 → 全量扫描
4. 完成后保存新游标

### 8.2 Findings 去重

使用 UNIQUE 索引 `(file_path, line_number, rule_id)` + `INSERT OR IGNORE`。暴露类 findings 每次扫描是新快照，不做去重。

### 8.3 历史清理

默认保留最近 30 次扫描记录，旧的自动清理（含关联 findings）。

---

## 九、API Contract

### POST /api/security/scan/trigger

**Request:**
```json
{ "type": "full|leakage|exposure", "since": "2026-03-01", "ruleIds": ["S1"], "ports": [22, 3306] }
```

**Response 200:**
```json
{
  "scanId": "sec_abc123", "status": "completed", "scannedAt": 1709856000000, "duration_ms": 3420,
  "leakage": { "filesScanned": 12, "linesScanned": 34521, "totalFindings": 4,
    "findingsBySeverity": { "critical": 1, "high": 2, "medium": 1, "low": 0 },
    "findingsByRule": { "S6": 1, "S4": 1, "S7": 1, "S1": 1 } },
  "exposure": { "publicIp": "203.0.113.42", "portFindings": 1, "tunnelFindings": 0 },
  "securityScore": { "score": 72, "grade": "C", "label": "警告", "breakdown": { "leakage": 22, "exposure": 50 } }
}
```

**错误码：** 403（非 localhost） | 429（速率限制，含 retryAfterMs） | 500

### GET /api/security/scan/latest

**Query:** `?type=full|leakage|exposure`
**Response 200:** `{ "scan": { ... }, "findings": [ ... ] }` | **404:** 无记录

### GET /api/security/findings

**Query params:**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| scanId | string | latest | 扫描批次 ID |
| category | string | all | leakage / exposure |
| severity | string | all | 过滤严重级别 |
| ruleId | string | all | 过滤规则 ID |
| page | number | 1 | 页码 |
| pageSize | number | 50 | 每页条数 (max 200) |
| sort | string | severity | severity / createdAt / ruleId |
| order | string | desc | asc / desc |

**Response 200:**
```json
{
  "findings": [
    { "id": "f_001", "scanId": "sec_abc123", "category": "leakage", "ruleId": "S6",
      "ruleName": "数据库连接串", "severity": "critical", "source": "user_message",
      "sessionId": "sess_xyz", "lineNumber": 142,
      "maskedSnippet": "mysql://root:****@10.0.0.1/db",
      "context": "连接 mysql://root:****@10.0.0.1/db 进行迁移" }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 4, "totalPages": 1 }
}
```

### GET /api/security/rules

**Response 200:**
```json
{
  "rules": [
    { "id": "S1", "name": "手机号", "severity": "medium", "category": "leakage",
      "builtIn": true, "description": "检测中国大陆手机号", "patternCount": 1 }
  ],
  "totalBuiltIn": 9, "totalCustom": 0
}
```

### GET /api/security/history

**Query:** `?days=30`
**Response 200:**
```json
{ "history": [ { "scanId": "...", "scannedAt": ..., "totalFindings": 5, "securityScore": { "score": 72, "grade": "C" } } ], "trend": "improving" }
```

---

## 十、外部依赖鲁棒性

### 10.1 公网 IP 获取

多源容错，依次尝试 `api.ipify.org` → `api.my-ip.io` → `httpbin.org/ip`。每个请求设 5 秒 AbortController 超时。全部失败返回 null，暴露检测跳过端口探测仅执行进程检测，结果标记 `note: "无法获取公网 IP，跳过端口可达性检测"`。

### 10.2 端口探测

`net.createConnection` 设 3 秒超时，单端口失败不影响其他。并发控制：最多 5 个并发探测。

### 10.3 进程检测跨平台

| 平台 | 命令 | 超时 |
|------|------|------|
| darwin/linux | `ps aux` | 5s |
| win32 | `tasklist /V /FO CSV` | 5s |
| 其他 | 静默返回空数组 | - |

`execSync` 超时或异常静默返回空。命令行中 `--authtoken`/`--token` 值做脱敏。

---

## 十一、CLI 命令

新增 `src/cli/commands/security.js`，在 `src/cli/index.js` 注册：

```
aidog security (alias: sec)
├── scan         完整扫描  --since --severity --json
├── exposure     暴露检测  --ports --timeout --json
├── leakage      泄漏扫描  --since --rules --json
└── rules        列出规则
```

---

## 十二、Dashboard 改造

修改 `src/web/src/App.jsx`，NAV_ITEMS 改为分组结构：

```jsx
const NAV_ITEMS = [
  { section: 'Token 优化' },
  { path: '/', label: 'Overview', icon: ... },
  { path: '/sessions', label: 'Sessions', icon: ... },
  { path: '/analysis', label: 'Analysis', icon: ... },
  { path: '/optimize', label: 'Optimize', icon: ... },
  { section: '安全检测' },
  { path: '/security', label: 'Security', icon: ... },
  { section: null },  // 分隔线
  { path: '/plugins', label: 'Plugins', icon: ... },
  { path: '/settings', label: 'Settings', icon: ... },
];
```

Security 页面内部 Tab：扫描概览 | 暴露检测 | 泄露扫描 | 检测规则

---

## 十三、安全健康分

满分 100 = 泄露 50 + 暴露 50，独立于 Token 健康分。
- 泄露扣分：critical -15, high -8, medium -3, low -1
- 暴露扣分：端口可达 critical -20, high -12, medium -5; 穿透工具每个 -10
- 等级：A(90+) 安全 / B(75+) 注意 / C(60+) 警告 / D(40+) 危险 / F(<40) 严重危险

---

## 十四、测试矩阵

### A. 规则准确率（precision/recall）

| 规则 | 正例 | 反例（误报控制） |
|------|------|------------------|
| S1 手机号 | `13812345678` | `1678901234567`(timestamp)、`12345678901`(非手机段) |
| S2 身份证 | 合法校验位 | 18位随机数字(校验位不过)、UUID 数字串 |
| S3 银行卡 | Luhn 通过的 16-19 位 | Luhn 失败、IP、timestamp |
| S4 密码 | `password=abc123`、`-p mypass` | `password_reset`(变量名)、`password: ''`(空值) |
| S6 DB连接 | `mysql://root:pass@host/db` | `mysql://localhost/db`(无密码)、文档模板 |
| S7 API Key | `sk-abc...(≥20字符)` | `sk-test`(太短)、`sklearn`(库名) |

### B. 脱敏正确性

手机号中间4位 `****` / 密码值完全替换 / DB 连接串密码段替换 / API Key 保留前缀+后4位 / 进程 `--authtoken` 值替换

### C. 可靠性（网络/系统异常）

所有 IP 服务超时 → null / 端口超时 → unreachable / ps 超时 → 空数组 / 不支持平台 → 空数组

### D. 增量与幂等

首次全量 → 保存游标 / 文件未修改 → 跳过 / 新增内容 → 仅扫新增 / 同一 finding 重复插入 → IGNORE

### E. 并发

并发触发 → 第二次 429 / 扫描中再触发 → "scan in progress"

### F. API 路由

trigger 200 / latest 200 / findings 分页 / severity 过滤 / 非 localhost 403 / 频率限制 429

---

## 十五、关键集成点

| 文件 | 修改内容 |
|------|----------|
| `src/cli/index.js` | 导入注册 registerSecurityCommand |
| `src/cli/commands/serve.js` (line 56+) | 注入 SecurityEngine + 挂载 security 路由 |
| `src/server/index.js` (line 109+) | 同步注册 securityRouter |
| `src/storage/schema.sql` | 追加两张表 + 索引 |
| `src/storage/sqlite.js` | 新增 security CRUD 方法 |
| `src/types.js` (line 19) | Severity 增加 critical |
| `src/cli/formatters/index.js` (line 120) | formatSeverity 增加 critical |
| `src/plugins/interface.js` | 新增可选 getDataPaths() |
| `src/plugins/claude-code/index.js` | 实现 getDataPaths() |
| `src/web/src/App.jsx` | 侧边栏分组 + Security 路由 |

---

## 十六、实施步骤

1. 类型和骨架 — 扩展 types.js Severity、创建 src/security/ 目录
2. 泄漏扫描器 — S1-S9 规则 + 脱敏 + 自定义规则加载 + LeakageScanner + 增量游标
3. 暴露检测器 — ExposureChecker（多源 IP/端口探测/进程检测/跨平台）
4. 插件接口扩展 — interface.js 新增 getDataPaths()、Claude Code 实现
5. 存储层 — schema.sql 扩展 + SQLiteStorage 新增方法
6. CLI 命令 — aidog sec 子命令 + formatSeverity 扩展
7. Server 接入 — serve.js + server/index.js 双入口注入（含 localhost 校验/速率限制）
8. Dashboard — 侧边栏分组 + Security 页面（4 Tab）
9. 测试 — 按矩阵：规则准确率 → 脱敏 → 可靠性 → 增量 → 并发 → API
10. 文档归档 — 保存到 docs/plans/2026-03-07-security-module-design.md

---

## 验证方式

1. `aidog sec scan` — 完整扫描 CLI 输出 + 健康分
2. `aidog sec exposure` — 端口检测 + 穿透工具检测（含离线降级）
3. `aidog sec leakage --since 2026-03-01` — JSONL 敏感信息检测
4. `aidog sec leakage` 连续两次 — 验证增量扫描
5. `aidog sec rules` — 列出内置 + 自定义规则
6. `aidog serve` → `/security` — 侧边栏分组 + Tab
7. `curl -X POST localhost:3000/api/security/scan/trigger` — API 触发 + localhost 校验
8. `npm test` — 测试矩阵全部通过
