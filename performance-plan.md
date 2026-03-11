# Performance Intelligence Module — Implementation Plan

## Context

aidog 目前有 Token 优化和安全检测两大模块。用户希望增加第三个模块——**性能分析 (Performance Intelligence)**，在 token 统计基础上扩展质量/效率指标：响应延迟估算、缓存效率、工具调用分析、成本估算、代理/模型对比。

**数据采集变更：** 需要扩展 `extractToolCalls()` 以捕获 `is_error` 字段，同时扩展 `ToolCall` 类型定义和 `tool_calls` 存储格式。其余指标均从现有 `token_events` 表计算。

## Architecture Overview

完全复用安全模块的架构模式：Engine → Storage → API Routes → CLI → Frontend Pages。

```
src/performance/
  index.js          ← PerformanceEngine (核心计算)
  pricing.js        ← 模型定价配置
src/server/routes/
  performance.js    ← REST API
src/cli/commands/
  performance.js    ← CLI 命令
src/web/src/
  components/PerformanceShared.jsx
  pages/PerformanceOverview.jsx
  pages/PerformanceAgents.jsx
  pages/PerformanceTools.jsx
```

---

## Step 0: Ingest Pipeline — 扩展 tool_calls 捕获 is_error

> **Finding #2 修复：** 当前 `extractToolCalls()` 只存 `{ type, name, inputSize, outputSize }`，缺少错误状态。

**Edit: `src/plugins/interface.js`** — ToolCall typedef 增加 `@property {boolean} [isError]`

**Edit: `src/plugins/claude-code/parser.js`** — `extractToolCalls()` 增加：

```javascript
...(b.type === 'tool_result' && b.is_error ? { isError: true } : {}),
```

兼容性：`isError` 为 optional，旧数据不存在时视为 false。`tool_calls` 列已是 JSON，无需改 schema。

---

## Step 1: Model Pricing Config

**New file: `src/performance/pricing.js`**

- 导出 `MODEL_PRICING` 对象：按模型名前缀映射 input/output/cacheRead/cacheWrite 单价 (USD per 1M tokens)
- 覆盖 Claude (sonnet/opus/haiku)、GPT-4o、Gemini 等常见模型
- 导出 `estimateCost(model, inputTokens, outputTokens, cacheRead, cacheWrite)` 函数
- 模型匹配使用前缀匹配 + 默认兜底

## Step 2: Performance Engine

**New file: `src/performance/index.js`**

```javascript
export class PerformanceEngine {
  constructor({ storage })

  // 主入口：计算指定时间范围的 KPI
  async analyze({ days = 7, agent, sessionId } = {})

  // 子计算
  computeSessionMetrics(events)      // 每个 session 的指标
  computeAgentComparison(events)     // 按 agent 分组对比
  computeToolMetrics(events)         // 工具调用分析
  computeCostEstimate(events)        // 成本估算
  calculatePerformanceScore(metrics) // 综合评分 (0-100)
}
```

**计算的指标：**

| 指标 | 计算方式 | 数据来源 |
|------|---------|---------|
| 响应延迟估算 | user→assistant 的时间差 (非 assistant→assistant)，过滤 >300s 为用户空闲 | `timestamp` + `role` |
| Session 时长 | max(timestamp) - min(timestamp) | `timestamp` |
| 消息吞吐量 | eventCount / durationMinutes | 计算 |
| 缓存效率 | cache_read / max(input_tokens, 1)，跳过 input_tokens=0 的行 | `cache_read`, `input_tokens` |
| Token 效率 | output / input 比率 | `output_tokens`, `input_tokens` |
| 工具调用次数/分布 | 解析 tool_calls JSON | `tool_calls` |
| 工具成功率 | tool_calls JSON 中 isError 字段 (Step 0 扩展) | `tool_calls` JSON |
| 成本估算 | tokens × model pricing | `model`, token 字段 |
| 模型分布 | 按 model 分组统计 | `model` |

**性能评分 (100分制)：**

| 维度 | 满分 | 衡量内容 |
|------|------|---------|
| cacheEfficiency | 25 | 缓存命中率 |
| tokenEfficiency | 25 | 输入/输出比例合理性 |
| toolEfficiency | 20 | 工具调用成功率、payload 合理性 |
| sessionHygiene | 15 | Session 长度、吞吐量 |
| costEfficiency | 15 | 模型选用合理性 |

## Step 3: Database Schema

**Edit: `src/storage/schema.sql`** — 末尾追加：

```sql
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id              TEXT PRIMARY KEY,
  snapshot_type   TEXT NOT NULL,    -- 'full' | 'session' | 'agent'
  period_start    INTEGER NOT NULL,
  period_end      INTEGER NOT NULL,
  agent           TEXT,
  model           TEXT,
  metrics         TEXT NOT NULL,    -- JSON KPI blob
  perf_score      TEXT,            -- JSON { score, grade, breakdown }
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perf_snap_type ON performance_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_perf_snap_created ON performance_snapshots(created_at);
```

**Edit: `src/storage/sqlite.js`** — 新增方法：

- `savePerformanceSnapshot(snapshot)` — INSERT + 清理旧记录
- `getLatestPerformanceSnapshot(type)` — 最近一次快照
- `getPerformanceHistory(days)` — 评分趋势数据
- `_parsePerformanceSnapshotRow(row)` — JSON 解析

## Step 4: API Routes

**New file: `src/server/routes/performance.js`**

遵循 `security.js` 路由模式：

```text
POST /api/performance/analyze/trigger  — 触发分析 (localhost, 限频 30s)
GET  /api/performance/latest           — 最新快照 + 趋势
GET  /api/performance/overview         — 概览 KPI 数据 (实时计算，不依赖快照)
GET  /api/performance/agents           — 代理对比数据 (实时计算)
GET  /api/performance/tools            — 工具分析数据 (实时计算)
GET  /api/performance/history          — 评分时间线 (从快照表读取)
```

> **Finding #3 修复 — 快照写入时机：**
>
> - `POST /analyze/trigger` 调用 `performanceEngine.analyze()` 后，将结果通过 `storage.savePerformanceSnapshot()` 持久化
> - `/overview`、`/agents`、`/tools` 不依赖快照表，直接实时查询 `token_events` 计算，确保无快照时也能返回数据
> - `/latest` 和 `/history` 从快照表读取，用于趋势对比
> - CLI `aidog perf analyze` 同样在计算后调用 `savePerformanceSnapshot()`

## Step 5: Server Integration

**Edit: `src/server/index.js`**
- 导入 `PerformanceEngine` 和 `performanceRouter`
- 初始化 `performanceEngine`，`app.set('performanceEngine', performanceEngine)`
- 注册路由 `app.use('/api/performance', performanceRouter)`

## Step 6: CLI Command

**New file: `src/cli/commands/performance.js`**

```bash
aidog perf analyze [--days 7] [--json]     # 运行性能分析 (计算 + 保存快照)
aidog perf overview [--days 7] [--json]    # 概览 KPI (对应 /overview)
aidog perf agents [--days 7] [--json]      # 代理对比 (对应 /agents)
aidog perf tools [--days 7] [--json]       # 工具分析 (对应 /tools)
aidog perf cost [--days 7] [--json]        # 成本估算
aidog perf history [--days 30] [--json]    # 评分趋势 (对应 /history)
```

> **Finding #5 修复：** CLI 子命令与 API 端点一一对应，确保 CLI/Web 功能对等。

**Edit: `src/cli/index.js`** — 注册 `registerPerformanceCommand(program)`

## Step 7: Frontend Shared Components

**New file: `src/web/src/components/PerformanceShared.jsx`**

- 从 SecurityShared 复用：`ScoreGauge`, `ScoreBar`, `StatCard`, `TrendBadge`, `Pagination`
- 新增 `usePerformanceData()` hook — 类似 `useScanData()`，调用 performance API
- 新增 `CostBadge` — 格式化 USD 成本显示
- 新增 `ToolBar` — 工具分布水平条

## Step 8: Frontend Pages

**New file: `src/web/src/pages/PerformanceOverview.jsx`**
- ScoreGauge + 5维 breakdown bars
- 4 StatCards: 估算成本、缓存命中率、平均响应时间、工具调用总数
- ScoreSparkline 趋势图
- "重新分析" 按钮触发 POST /analyze/trigger

**New file: `src/web/src/pages/PerformanceAgents.jsx`**
- 代理对比表格/卡片
- 每个 agent: tokens, cost, cache efficiency, model distribution
- Recharts BarChart 可视化

**New file: `src/web/src/pages/PerformanceTools.jsx`**
- 工具调用频率分布 (水平条形图)
- Top 10 工具 by token 消耗
- 工具 payload 大小分析

## Step 9: App.jsx Navigation

**Edit: `src/web/src/App.jsx`**

在 `安全检测` section 之后、`{ section: null }` 分隔线之前添加：

```javascript
{ section: '性能分析' },
{ path: '/performance', label: '性能概览', icon: <SpeedometerIcon /> },
{ path: '/performance/agents', label: '代理对比', icon: <AgentsIcon /> },
{ path: '/performance/tools', label: '工具分析', icon: <ToolIcon /> },
```

添加 Routes 和 PageTitle 映射。

## Step 10: Build & Test

```bash
npm run build:web
npm test
# 手动验证：启动 server，访问 /performance 页面
```

---

## Key Files to Modify

| File | Action |
|------|--------|
| `src/plugins/interface.js` | EDIT — ToolCall 增加 isError 字段 |
| `src/plugins/claude-code/parser.js` | EDIT — extractToolCalls 捕获 is_error |
| `src/performance/pricing.js` | CREATE |
| `src/performance/index.js` | CREATE |
| `src/storage/schema.sql` | EDIT — 追加 performance_snapshots 表 |
| `src/storage/sqlite.js` | EDIT — 追加 4 个方法 |
| `src/server/routes/performance.js` | CREATE |
| `src/server/index.js` | EDIT — 注册 engine + router |
| `src/cli/commands/performance.js` | CREATE |
| `src/cli/index.js` | EDIT — 注册命令 |
| `src/web/src/components/PerformanceShared.jsx` | CREATE |
| `src/web/src/pages/PerformanceOverview.jsx` | CREATE |
| `src/web/src/pages/PerformanceAgents.jsx` | CREATE |
| `src/web/src/pages/PerformanceTools.jsx` | CREATE |
| `src/web/src/App.jsx` | EDIT — 导航 + 路由 |

## Reusable Existing Code

- `SecurityShared.jsx` 的 `ScoreGauge`, `ScoreBar`, `StatCard`, `TrendBadge`, `ScoreSparkline`, `Pagination` 组件
- `SecurityEngine.computeTrend()` 的线性回归趋势算法
- `useApi.js` 的 `useFetch`, `useApi` hooks
- `security.js` 路由的 localhostOnly 中间件和限频逻辑
- `sqlite.js` 的 prepared statement 和 transaction 模式
- `cli/commands/security.js` 的 CLI 子命令结构

## Verification

1. `npm test` — 确保现有测试通过
2. `npm run build:web` — 前端构建成功
3. 启动 server (`node bin/aidog.js serve`)，访问 `/performance` 页面
4. 点击"重新分析"按钮，验证 API 返回数据
5. 检查 `/performance/agents` 和 `/performance/tools` 页面渲染正常
6. CLI: `node bin/aidog.js perf analyze --json` 输出合理
