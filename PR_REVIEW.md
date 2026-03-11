# PR Review: fix/i18n-score-labels (第二轮)

**分支:** `fix/i18n-score-labels` → `main`
**提交数:** 5 commits
**评审人:** Claude

---

## 概述

本 PR 将后端评分标签（score labels）从硬编码的中文改为英文，并在前端通过 i18n 实现多语言支持。同时将版本号从 `0.1.0` 升至 `0.1.1`。

**第二轮更新：** 新增提交 `df9691c` 解决测试文件中的 secret-scanning 误报问题。

## 变更范围

| 类别 | 文件 | 变更内容 |
|------|------|----------|
| 后端引擎 | `src/performance/index.js` | 中文标签 → 英文 (优秀→Excellent 等) |
| 后端引擎 | `src/rules/engine.js` | 中文标签 → 英文 |
| 后端引擎 | `src/security/index.js` | 中文标签 → 英文 (安全→Safe 等) |
| 前端页面 | `PerformanceOverview.jsx` | 新增 `getPerformanceScoreLabel()`，基于 grade 查询 i18n |
| 前端页面 | `SecurityOverview.jsx` | 新增 `getSecurityScoreLabel()`，基于 grade 查询 i18n |
| i18n 资源 | `locales/{en,ja,zh-CN}/performance.json` | 新增 `scoreLabels` 键 |
| i18n 资源 | `locales/{en,ja,zh-CN}/security.json` | 新增 `scoreLabels` 键 + placeholder 去除 AWS key 示例 |
| 测试 | `tests/security/scoring.test.js` | 期望值更新为英文 |
| 测试 | `tests/security/storage.test.js` | 测试数据更新为英文 |
| 测试 | `tests/security/rules.test.js` | **NEW** 拆分 secret 字符串避免扫描误报 |
| 测试 | `tests/security/leakage-openclaw.test.js` | **NEW** 拆分 GitHub PAT 避免扫描误报 |
| E2E | `e2e/test-server.js` | mock 数据更新为英文 |
| 版本 | `package.json`, `package-lock.json` | 0.1.0 → 0.1.1 |
| 截图 | `docs/screenshots/*.png` | 更新截图 |

---

## 新提交评审: `df9691c` — Avoid secret-scanning false positives

### 变更内容

1. **`tests/security/rules.test.js`** — 将测试中的 API key / PAT 字面量拆分为数组 `.join()`：
   - `'sk-abcdefghij...'` → `['sk', 'abcdefghij...'].join('-')`
   - `'ghp_aBcDeFg...'` → `['ghp', 'aBcDeFg...'].join('_')`
   - `'github_pat_11A6...'` → `['github_pat', '11A6...'].join('_')`
   - `'AKIAIOSFODNN7EXAMPLE'` → `['AKIA', 'IOSFODNN7EXAMPLE'].join('')`

2. **`tests/security/leakage-openclaw.test.js`** — 将 GitHub PAT 提取为 `demoGitHubPat` 常量，同样使用 `.join('_')` 拆分。

3. **`locales/{en,ja,zh-CN}/security.json`** — placeholder 示例中的 `AKIAIOSFODNN7EXAMPLE` 替换为 `demo_access_key_value`。

### 评价

变更合理。使用 `[].join()` 拆分是避免 secret scanner 误报的常见模式，不影响测试逻辑——运行时拼接后的值与原始值完全一致，测试行为不变。

**一个小观察：** `AKIAIOSFODNN7EXAMPLE` 本身是 AWS 官方文档中的示例 key（非真实密钥），但替换为 `demo_access_key_value` 也没有坏处，且更安全。

---

## 上轮建议跟进状态

| # | 建议 | 状态 |
|---|------|------|
| 1 | 后端 label 与前端 i18n 冗余 | 未处理（非阻塞，可后续优化） |
| 2 | `package-lock.json` 版本跳跃 | 未处理（非阻塞） |
| 3 | `Overview.jsx` grade 映射函数可复用 | 未处理（非阻塞） |
| 4 | CLI 硬编码中文 | 不在本 PR 范围 |
| 5 | 安全分/性能分 label 语义不同（确认设计） | 已确认为有意设计 |

---

## 结论

**建议：合并 (Approve)**

两轮评审均无阻塞性问题。核心 i18n 功能正确实现，新增的 secret-scanning 防护合理有效。上轮提出的改进建议均为优化性质，不影响合并。
