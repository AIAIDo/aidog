const BASE_RULE_META = {
  session: {
    zh: '会话结构',
    en: 'Session structure',
  },
  tools: {
    zh: '工具调用',
    en: 'Tool usage',
  },
  output: {
    zh: '输出质量',
    en: 'Output quality',
  },
  cache: {
    zh: '缓存效率',
    en: 'Cache efficiency',
  },
  retrieval: {
    zh: '检索路径',
    en: 'Retrieval path',
  },
  validation: {
    zh: '验证成本',
    en: 'Validation cost',
  },
  model: {
    zh: '模型匹配',
    en: 'Model fit',
  },
};

const RULE_LIBRARY = {
  R1_context_growth: {
    aliases: ['R1'],
    category: 'session',
    zh: {
      title: '上下文越来越长',
      summary: '同一个会话不断叠加历史内容，后续每一轮都在重复消耗更多输入 token。',
      actions: ['开启新话题时新建会话。', '把长背景整理成短摘要，而不是每轮重复粘贴。', '只保留当前任务需要的约束和材料。'],
    },
    en: {
      title: 'Context keeps growing',
      summary: 'The same session keeps carrying more history, so every later turn gets more expensive.',
      actions: ['Start a new session for a new topic.', 'Replace long background with a short summary.', 'Keep only the instructions and files needed for the current task.'],
    },
  },
  R2_tool_loop: {
    aliases: ['R2'],
    category: 'tools',
    zh: {
      title: '工具调用在兜圈子',
      summary: 'Agent 连续重复调用相似工具，但没有产生有效进展。',
      actions: ['先明确要找的目标文件或目录，再发起工具调用。', '失败两三次后切换思路，不要继续重试同一动作。', '给出更具体的路径、关键词或命令范围。'],
    },
    en: {
      title: 'Tool calls are looping',
      summary: 'The agent keeps calling similar tools without making progress.',
      actions: ['State the exact target file, folder, or outcome first.', 'Stop retrying the same action after a couple of failures.', 'Provide narrower paths or search keywords.'],
    },
  },
  R3_large_output: {
    aliases: ['R3'],
    category: 'output',
    zh: {
      title: '输出内容过长',
      summary: '回复内容明显超过任务需要，生成了大量并不必要的文本。',
      actions: ['在提示词里明确要求“先给结论，再按需展开”。', '要求输出摘要、要点或 diff，而不是整段大文本。', '对列表和日志设置条数上限。'],
    },
    en: {
      title: 'Output is too long',
      summary: 'The response is much longer than the task requires.',
      actions: ['Ask for a conclusion first and details only on demand.', 'Prefer summaries, bullet points, or diffs over long prose.', 'Set limits for list items and logs.'],
    },
  },
  R4_cache_hit: {
    category: 'cache',
    zh: {
      title: '缓存命中率偏低',
      summary: '重复出现的上下文没有被稳定复用，导致相同内容反复计费。',
      actions: ['把固定背景、规范和项目说明整理成稳定模板。', '避免频繁改写同一段系统提示词。', '把常用说明放进固定文件，而不是每轮临时拼接。'],
    },
    en: {
      title: 'Cache hit rate is low',
      summary: 'Repeated context is not being reused consistently, so the same content is paid for again.',
      actions: ['Keep stable instructions and background in reusable templates.', 'Avoid rewriting the same system prompt every turn.', 'Move recurring guidance into fixed project docs.'],
    },
  },
  R5_mcp_overhead: {
    category: 'tools',
    zh: {
      title: 'MCP 开销偏高',
      summary: 'MCP 工具调用本身消耗了大量上下文和往返成本，收益不明显。',
      actions: ['只保留当前任务必需的 MCP Server。', '优先先缩小查询范围，再调用 MCP。', '能用本地文件或明确路径解决时，不要先走通用 MCP 搜索。'],
    },
    en: {
      title: 'MCP overhead is high',
      summary: 'MCP tool usage is costing a lot of context and round trips without enough payoff.',
      actions: ['Keep only the MCP servers needed for the current task.', 'Narrow the search scope before calling MCP.', 'Use direct file paths when possible.'],
    },
  },
  R6_retry_loop: {
    category: 'tools',
    zh: {
      title: '错误重试过多',
      summary: '同类失败操作被反复重试，token 持续增加，但问题并没有被解决。',
      actions: ['遇到重复报错时先检查权限、路径或参数。', '把错误信息直接总结给模型，让它换方案。', '设定“失败两次就停止重试”的使用习惯。'],
    },
    en: {
      title: 'Too many retries',
      summary: 'The same kind of failed action is repeated, increasing token cost without resolving the problem.',
      actions: ['Check permissions, paths, or parameters after repeated failures.', 'Summarize the error and ask for a different approach.', 'Adopt a habit of stopping after two failed retries.'],
    },
  },
  R7_file_reread: {
    category: 'retrieval',
    zh: {
      title: '重复读取同一文件',
      summary: '同一个文件被反复读取，说明检索策略过粗，或上下文中没有保留已读结果。',
      actions: ['先记住关键文件名和段落，再继续下一步。', '只读取必要片段，不要反复全量打开。', '先定位相关函数或模块，再读文件内容。'],
    },
    en: {
      title: 'The same file is read repeatedly',
      summary: 'Repeated reads usually mean the retrieval strategy is too broad or the important result was not retained.',
      actions: ['Keep note of key files and relevant sections.', 'Read targeted snippets instead of reopening full files.', 'Find the right function or module before reading content.'],
    },
  },
  R8_large_file_read: {
    category: 'retrieval',
    zh: {
      title: '一次读取了过大的文件',
      summary: '把大文件整段塞进上下文，带来了高成本，但真正有用的信息只占一小部分。',
      actions: ['先搜索关键词，再读取命中片段。', '优先看文件结构、目录或函数名，不要直接全量展开。', '对日志、构建产物和锁文件设置忽略策略。'],
    },
    en: {
      title: 'A very large file was read',
      summary: 'A large file was pushed into context even though only a small part was actually useful.',
      actions: ['Search for keywords first, then read the matching slice.', 'Inspect structure and symbols before opening the whole file.', 'Ignore build output, logs, and lockfiles unless needed.'],
    },
  },
  R9_glob_abuse: {
    category: 'retrieval',
    zh: {
      title: '搜索范围过大',
      summary: '使用过宽的匹配规则扫描了大量无关文件。',
      actions: ['把搜索限定到已知目录。', '优先用更具体的文件名、扩展名或关键词。', '排除 `node_modules`、`dist`、日志和缓存目录。'],
    },
    en: {
      title: 'Search scope is too broad',
      summary: 'A wide file match scanned many irrelevant files.',
      actions: ['Limit searches to likely directories.', 'Use more specific filenames, extensions, or keywords.', 'Exclude `node_modules`, `dist`, logs, and cache folders.'],
    },
  },
  R10_bash_truncation: {
    category: 'tools',
    zh: {
      title: '命令输出被截断',
      summary: '命令一次性返回太多内容，关键线索被淹没或被截断，后续又会重复执行。',
      actions: ['对命令输出加 `head`、`tail` 或行数限制。', '先 grep 关键词，再看原文。', '把大输出拆成多次小查询。'],
    },
    en: {
      title: 'Command output was truncated',
      summary: 'A command returned too much text, so the useful signal was buried or cut off.',
      actions: ['Use `head`, `tail`, or line limits.', 'Filter with `grep` before viewing the full output.', 'Break one large command into smaller targeted queries.'],
    },
  },
  R11_test_suite: {
    category: 'validation',
    zh: {
      title: '一次跑了过大的测试集',
      summary: '为了验证一个小改动，却触发了整套测试，带来了不必要的成本和等待时间。',
      actions: ['优先运行受影响模块的测试。', '先跑单测，再决定是否跑全集。', '把最小复现命令告诉模型，而不是让它自己猜。'],
    },
    en: {
      title: 'The test run is too large',
      summary: 'A small change triggered a full test suite instead of a focused verification step.',
      actions: ['Run the most relevant test target first.', 'Start with unit tests before broader suites.', 'Tell the model the smallest valid test command.'],
    },
  },
  R12_model_mismatch: {
    category: 'model',
    zh: {
      title: '模型规格和任务不匹配',
      summary: '当前任务太简单或太明确，却用了成本更高的模型。',
      actions: ['简单查询、格式整理和小改动优先用轻量模型。', '复杂推理、架构设计再切换到高阶模型。', '为不同任务预设默认模型。'],
    },
    en: {
      title: 'The model is oversized for the task',
      summary: 'The task is simple, but a more expensive model was used.',
      actions: ['Use lighter models for lookup, formatting, and small edits.', 'Switch to heavier models only for deep reasoning or design work.', 'Define default models by task type.'],
    },
  },
  R13_session_length: {
    category: 'session',
    zh: {
      title: '会话拉得太长',
      summary: '一个会话承载了太多子任务，历史负担越来越重，后续每轮都更贵。',
      actions: ['一个主题一个会话，不要把所有事情都堆在同一个窗口。', '阶段结束后新开会话，并附上简短总结。', '把最终结论沉淀到文档，而不是依赖长会话记忆。'],
    },
    en: {
      title: 'The session is too long',
      summary: 'Too many sub-tasks were packed into one session, so history keeps getting heavier.',
      actions: ['Use one session per topic.', 'Start a fresh session after each phase with a short summary.', 'Store conclusions in docs instead of relying on a huge chat history.'],
    },
  },
  R14_search_wide: {
    category: 'retrieval',
    zh: {
      title: '搜索太广但收益有限',
      summary: '为了找少量信息，扫描了过大的范围，效率不高。',
      actions: ['先问清楚目标对象是什么，再开始搜索。', '从最可能的目录开始逐层缩小。', '把“找什么”和“排除什么”一起告诉模型。'],
    },
    en: {
      title: 'Search is wide with low payoff',
      summary: 'A lot of content was scanned to find only a small amount of relevant information.',
      actions: ['Clarify the target before searching.', 'Start from the most likely directory and narrow down quickly.', 'Tell the model both what to find and what to exclude.'],
    },
  },
  R15_io_ratio: {
    category: 'output',
    zh: {
      title: '输入很多，输出很少',
      summary: '塞给模型的信息远超实际产出，说明上下文里有明显冗余。',
      actions: ['减少背景材料，只保留当前决策所需内容。', '先让模型列出还缺什么，再补充资料。', '把原始材料改成摘要、表格或 checklist。'],
    },
    en: {
      title: 'Heavy input, tiny output',
      summary: 'The model received much more information than it used in the final answer.',
      actions: ['Trim context to what matters for the current decision.', 'Ask the model what extra input it actually needs.', 'Convert raw materials into summaries, tables, or checklists.'],
    },
  },
  R16_opencode_mcp_saturation: {
    category: 'tools',
    zh: {
      title: 'OpenCode 的 MCP 调用过密',
      summary: 'OpenCode 会话频繁调用 MCP，说明检索路径不够直接。',
      actions: ['先给出更精确的文件路径和任务边界。', '避免让模型“自己到处找”，改为指定位置核查。', '关闭当前任务不需要的 MCP 能力。'],
    },
    en: {
      title: 'OpenCode is overusing MCP',
      summary: 'The session is making dense MCP calls, which usually means the retrieval path is not direct enough.',
      actions: ['Provide exact file paths and task boundaries.', 'Stop asking the model to explore everywhere on its own.', 'Disable MCP capabilities not needed for this task.'],
    },
  },
  R17_gemini_low_output: {
    category: 'output',
    zh: {
      title: 'Gemini 输入很多但产出很少',
      summary: '大量上下文被送入模型，但最终输出很少，通常表示上下文污染或提示过宽。',
      actions: ['缩短上下文，只保留与问题直接相关的材料。', '让模型先回答核心问题，再决定是否补充背景。', '避免在一个请求里混入多个目标。'],
    },
    en: {
      title: 'Gemini has high input and low output',
      summary: 'A lot of context went in, but very little value came out, often due to noisy context.',
      actions: ['Shorten context to directly relevant material.', 'Ask for the core answer first.', 'Avoid mixing multiple goals into one prompt.'],
    },
  },
  R18_codex_o1_overhead: {
    category: 'model',
    zh: {
      title: 'Codex 使用了过重的推理模型',
      summary: '小任务使用了 `o1/o1-preview` 这类高成本模型，性价比偏低。',
      actions: ['日常修复、查文件、改文案优先用轻量模型。', '只有在复杂规划或多步推理时再启用高阶推理模型。', '为常见任务建立默认模型选择策略。'],
    },
    en: {
      title: 'Codex is using an overly heavy reasoning model',
      summary: 'Small tasks are using `o1/o1-preview`, which is often not cost-effective.',
      actions: ['Use lighter models for everyday edits and file inspection.', 'Reserve heavy reasoning models for complex planning.', 'Create a default model policy for common tasks.'],
    },
  },
};

const PAGE_COPY = {
  'zh-CN': {
    libraryEyebrow: '规则库',
    libraryTitle: '系统如何识别 Token 浪费模式',
    libraryDescription: '这里展示每条规则在监控什么，以及它对会话、工具调用、模型和输出的关注点。规则定义属于平台能力，具体优化动作统一放在“诊断与优化”工作页。',
    principles: ['先看近期命中高、浪费大的规则。', '在这里理解规则边界，在“诊断与优化”里执行动作。', '只有团队有额外治理要求时，再新增自定义规则。'],
    stats: {
      total: '规则总数',
      enabled: '已启用',
      builtIn: '系统规则',
      custom: '自定义',
    },
    categoryTitle: '规则分组',
    categoryDescription: '按监控对象查看规则，不再把规则列表和优化建议混在一起。',
    technicalRule: '规则 ID',
    estimatedWaste: '累计浪费',
    hits: '命中',
    advancedTitle: '高级配置',
    advancedDescription: '这里保留规则启停、自定义规则和调试入口，适合管理员或高级用户。',
    advancedShow: '查看高级配置',
    advancedHide: '收起高级配置',
    customTitle: '自定义规则使用场景',
    customDescription: '适合预算管控、模型白名单、路径约束等团队级策略。日常使用建议优先依赖系统规则。',
    addCustomRuleHint: '新增自定义规则会改变检测口径，建议由管理员维护。',
    keepEnabled: '建议保持开启',
    builtInBadge: '系统规则',
    noHits: '尚未产生命中数据',
  },
  en: {
    libraryEyebrow: 'Rule library',
    libraryTitle: 'How the system detects token waste patterns',
    libraryDescription: 'This page explains what each rule monitors across sessions, tools, models, and outputs. Keep execution guidance inside the Diagnostics workspace and keep this page as the rule library.',
    principles: ['Start with rules that have recent hits and high waste.', 'Use this page to understand rule boundaries and the Diagnostics workspace to execute changes.', 'Create custom rules only for team-specific governance.'],
    stats: {
      total: 'total rules',
      enabled: 'enabled',
      builtIn: 'system rules',
      custom: 'custom',
    },
    categoryTitle: 'Rule groups',
    categoryDescription: 'Browse rules by what they monitor instead of mixing rule definitions with action plans.',
    technicalRule: 'Rule ID',
    estimatedWaste: 'waste',
    hits: 'hits',
    advancedTitle: 'Advanced configuration',
    advancedDescription: 'Keep toggles, custom rules, and rule debugging here for admins and power users.',
    advancedShow: 'Show advanced configuration',
    advancedHide: 'Hide advanced configuration',
    customTitle: 'When to create a custom rule',
    customDescription: 'Useful for budget controls, model allowlists, or path-specific governance. For routine use, rely on the system rules first.',
    addCustomRuleHint: 'Custom rules change the detection baseline and should usually be maintained by an admin.',
    keepEnabled: 'Usually keep enabled',
    builtInBadge: 'System rule',
    noHits: 'No hit data yet',
  },
};

function normalizeLanguage(language) {
  if (!language) return 'en';
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function getLocale(language) {
  return normalizeLanguage(language) === 'zh-CN' ? 'zh' : 'en';
}

function buildAliasMap() {
  const aliasMap = new Map();
  for (const [id, meta] of Object.entries(RULE_LIBRARY)) {
    aliasMap.set(id, id);
    for (const alias of meta.aliases || []) {
      aliasMap.set(alias, id);
    }
  }
  return aliasMap;
}

const ALIAS_MAP = buildAliasMap();

export function getTokenRuleGuideCopy(language) {
  return PAGE_COPY[normalizeLanguage(language)] || PAGE_COPY.en;
}

export function getTokenRuleGuideEntry(language, rule) {
  if (!rule) return null;

  const locale = getLocale(language);
  const canonicalId = ALIAS_MAP.get(rule.id || rule.ruleId) || rule.id || rule.ruleId;
  const meta = RULE_LIBRARY[canonicalId];
  if (!meta) return null;

  return {
    id: canonicalId,
    category: meta.category,
    categoryLabel: BASE_RULE_META[meta.category]?.[locale] || meta.category,
    title: meta[locale]?.title || rule.name || canonicalId,
    summary: meta[locale]?.summary || rule.description || '',
    actions: meta[locale]?.actions || [],
  };
}

export function getTokenRuleCategories(language) {
  const locale = getLocale(language);
  return Object.entries(BASE_RULE_META).map(([id, labels]) => ({ id, label: labels[locale] || id }));
}
