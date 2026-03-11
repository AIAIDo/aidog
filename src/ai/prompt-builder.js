/**
 * PromptBuilder - Builds system and user prompts for AI token optimization analysis.
 */
export class PromptBuilder {
  /**
   * Returns the system prompt for token optimization analysis (in Chinese).
   * @returns {string}
   */
  buildSystemPrompt() {
    return `你是一个 Claude Code token 消耗优化专家。
用户会提供一份结构化的使用分析报告（不含原始 prompt 内容）。

你的任务：
1. 解释每个问题的根本原因（用开发者能理解的语言）
2. 给出优先级排序（按节省 token 的潜力）
3. 给出具体可执行的操作步骤：
   - 立即可做的习惯改变
   - 配置文件的具体修改（输出可直接粘贴的配置）
   - 长期的工作流优化

要求：
- 输出结构化 JSON（符合 AnalysisReport schema），不要 markdown 包裹
- 建议必须具体可执行，不要泛泛而谈
- 如果某个问题有对应的 Claude Code 命令或配置，直接给出`;
  }

  /**
   * Builds the user prompt from sanitized analysis data.
   * @param {Object} analysisData - The sanitized analysis data
   * @returns {string}
   */
  buildUserPrompt(analysisData) {
    return `以下是我的 Claude Code 使用分析数据：

${JSON.stringify(analysisData, null, 2)}

请根据以上数据，分析 token 消耗情况并给出优化建议。输出 JSON 格式的 AnalysisReport。`;
  }

  /**
   * Adapter-specific prompt building.
   * @param {string} provider - One of: claude, openai, gemini, ollama
   * @param {Object} analysisData - The sanitized analysis data
   * @returns {{ systemPrompt: string, userPrompt: string }}
   */
  build(provider, analysisData) {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(analysisData);

    switch (provider) {
      case 'claude':
        return { systemPrompt, userPrompt };

      case 'openai':
      case 'compatible':
      case 'kimi':
      case 'glm':
      case 'minmax':
      case 'qoder':
        return {
          systemPrompt: systemPrompt + '\n\n注意：请严格输出合法的 JSON 对象，不要包含任何 markdown 代码块标记或其他非 JSON 内容。JSON schema 示例：{"issues": [{"id": "string", "category": "string", "severity": "high|medium|low", "title": "string", "explanation": "string", "impact": {"estimatedTokenSavings": 0, "percentage": 0}, "recommendations": [{"action": "string", "detail": "string", "config": "string (optional)"}]}], "summary": {"totalPotentialSavings": 0, "topPriority": "string"}}',
          userPrompt,
        };

      case 'gemini':
        return {
          systemPrompt: systemPrompt + '\n\n重要：直接输出 JSON 对象。不要使用 ```json 或其他格式包裹。确保 JSON 格式完整有效。',
          userPrompt: userPrompt + '\n\n请直接返回 JSON 对象，不要包含任何额外的文字说明。',
        };

      case 'ollama':
        return {
          systemPrompt: `你是 token 优化助手。分析用户的 Claude Code 使用数据，给出优化建议。
输出 JSON 格式，包含：
- issues: 问题列表，每个问题有 id, category, severity(high/medium/low), title, explanation, recommendations
- summary: 总结，包含 totalPotentialSavings 和 topPriority
直接输出 JSON，不要 markdown 包裹。`,
          userPrompt,
        };

      default:
        return { systemPrompt, userPrompt };
    }
  }
}
