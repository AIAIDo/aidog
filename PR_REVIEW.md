# PR Review: fix/i18n-score-labels

**分支:** `fix/i18n-score-labels` → `main`
**提交数:** 4 commits
**评审人:** Claude

---

## 概述

本 PR 将后端评分标签（score labels）从硬编码的中文改为英文，并在前端通过 i18n 实现多语言支持。同时将版本号从 `0.1.0` 升至 `0.1.1`。

## 变更范围

| 类别 | 文件 | 变更内容 |
|------|------|----------|
| 后端引擎 | `src/performance/index.js` | 中文标签 → 英文 (优秀→Excellent 等) |
| 后端引擎 | `src/rules/engine.js` | 中文标签 → 英文 |
| 后端引擎 | `src/security/index.js` | 中文标签 → 英文 (安全→Safe 等) |
| 前端页面 | `src/web/src/pages/PerformanceOverview.jsx` | 新增 `getPerformanceScoreLabel()` 函数，基于 grade 查询 i18n |
| 前端页面 | `src/web/src/pages/SecurityOverview.jsx` | 新增 `getSecurityScoreLabel()` 函数，基于 grade 查询 i18n |
| i18n 资源 | `locales/{en,ja,zh-CN}/performance.json` | 新增 `scoreLabels` 键 |
| i18n 资源 | `locales/{en,ja,zh-CN}/security.json` | 新增 `scoreLabels` 键 |
| 测试 | `tests/security/scoring.test.js` | 期望值更新为英文 |
| 测试 | `tests/security/storage.test.js` | 测试数据更新为英文 |
| E2E | `e2e/test-server.js` | mock 数据更新为英文 |
| 版本 | `package.json`, `package-lock.json` | 0.1.0 → 0.1.1 |
| 截图 | `docs/screenshots/*.png` | 更新截图 |

---

## 评审意见

### 整体评价: 可合并，有改进建议

PR 的核心目标——将前端评分标签国际化——已经正确实现。后端改为返回英文标签，前端根据 grade 字母查询 i18n 翻译，三种语言（en/ja/zh-CN）的翻译文件都已补齐。

---

### 建议 (非阻塞)

#### 1. 后端标签与前端 i18n 存在冗余逻辑

**问题：** 后端仍然在返回 `label` 字段（现在是英文），但前端已经不使用 `score.label`，而是通过 `getPerformanceScoreLabel(t, score.grade)` 根据 grade 字母来查 i18n。这意味着后端返回的 `label` 字段实际上被忽略了。

**建议：** 考虑以下两种方案之一：
- (a) 后端不再返回 `label`，只返回 `grade`，由前端统一负责展示文案
- (b) 后端支持 locale 参数，返回正确的 label

当前做法可以工作，但后端的英文 label 和前端的 i18n label 是重复的。

#### 2. `package-lock.json` 版本不一致

**问题：** `package.json` 版本从 `0.1.0` → `0.1.1`，但 `package-lock.json` 从 `1.0.0` → `0.1.1`。说明 main 分支上 `package-lock.json` 的 version 字段已经与 `package.json` 不同步（`1.0.0` vs `0.1.0`）。本 PR 修复了 lock 文件的不一致，但如果这是有意为之，建议在提交信息中说明。

#### 3. `Overview.jsx` 中已有类似逻辑，可考虑复用

**问题：** `Overview.jsx` 中已存在 `getGradeInfo()` 函数，使用 `t('grade.excellent')` 等键来翻译。`PerformanceOverview.jsx` 和 `SecurityOverview.jsx` 新增的函数逻辑类似但使用了不同的 i18n 键路径 (`overview.scoreLabels.xxx` vs `grade.xxx`)。

**建议：** 考虑统一为一个共享的工具函数，避免 grade→label 的映射逻辑分散在多处。

#### 4. CLI 命令中仍有大量硬编码中文

**不在本 PR 范围内**，但值得注意：`src/cli/commands/security.js` 中仍有大量硬编码中文（如 `安全健康分`、`泄漏安全`、`暴露安全` 等）。如果 i18n 是长期目标，后续可以处理 CLI 层。

#### 5. 安全分的 label 语义与性能分不同

**观察：** 性能分使用 Excellent/Good/Fair/Poor/Needs Improvement，安全分使用 Safe/Caution/Warning/Danger/Critical Risk。这个区分是合理的——只是确认这是有意的设计选择。前端正确地为两者使用了不同的 i18n 键。

---

### 代码质量

- `getPerformanceScoreLabel` 和 `getSecurityScoreLabel` 实现简洁，grade→i18n key 的映射清晰
- i18n 资源文件三种语言都已同步更新，键名一致
- 测试和 E2E mock 数据同步更新，保证测试可通过
- 截图同步更新

---

## 结论

**建议：合并 (Approve)**

核心功能正确实现，i18n 翻译完整。以上建议均为改进性质，不阻塞合并。
